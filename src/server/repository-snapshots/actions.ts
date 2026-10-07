"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/session";
import { idSchema } from "@/server/departments/schema";
import { getMyRepository } from "@/server/repositories/queries";
import { GENERIC_MESSAGE, PERMISSION_MESSAGE } from "@/server/requirements/errors";
import {
  type SnapshotActionResult,
  type SnapshotFormState,
  createSnapshotSchema,
  failureMessageSchema,
  isAllowedSnapshotTransition,
  snapshotStatusPatch,
  snapshotStatusSchema,
} from "./schema";

// Every action verifies the session server-side, validates input, then lets the database (RLS, constraints
// and the lifecycle trigger) decide. Ids from the browser are only targets, never proof of authority.
// The repository is resolved from the verified project on the server (never taken from the client), and
// a new snapshot is always PENDING. Metadata only: no provider call, no cloning, no file content.

const projectIdsSchema = z.object({
  organizationId: idSchema,
  departmentId: idSchema,
  teamId: idSchema,
  projectId: idSchema,
});
const snapshotIdsSchema = projectIdsSchema.extend({ snapshotId: idSchema });

function repositoryPath(ids: z.infer<typeof projectIdsSchema>) {
  return `/organizations/${ids.organizationId}/departments/${ids.departmentId}/teams/${ids.teamId}/projects/${ids.projectId}/repository`;
}

function revalidateSnapshots(ids: z.infer<typeof projectIdsSchema>) {
  revalidatePath(repositoryPath(ids) + "/snapshots");
  revalidatePath(repositoryPath(ids).replace(/\/repository$/, ""));
}

function toErrorMessage(error: { code?: string; message: string }): string {
  switch (error.code) {
    case "42501":
      return PERMISSION_MESSAGE;
    case "23505":
      return "A completed snapshot of this commit already exists.";
    case "23514":
      return error.message.includes("status transition")
        ? "That status change is not allowed."
        : "Some of the submitted values are not valid.";
    default:
      return GENERIC_MESSAGE;
  }
}

export async function createSnapshot(
  organizationId: string,
  departmentId: string,
  teamId: string,
  projectId: string,
  _prev: SnapshotFormState,
  formData: FormData,
): Promise<SnapshotFormState> {
  await requireUser();

  const ids = projectIdsSchema.safeParse({ organizationId, departmentId, teamId, projectId });
  const fields = createSnapshotSchema.safeParse({
    commitSha: formData.get("commitSha") ?? "",
    branch: formData.get("branch") ?? "",
  });
  if (!ids.success) return { error: "Invalid project." };
  if (!fields.success) return { fieldErrors: z.flattenError(fields.error).fieldErrors };

  // The repository comes from the verified project; RLS returns nothing the caller cannot see.
  const repository = await getMyRepository(ids.data.projectId);
  if (!repository) return { error: "Connect a repository to this project first." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_repository_snapshot", {
    p_repository_id: repository.id,
    p_commit_sha: fields.data.commitSha,
    p_branch: fields.data.branch,
  });
  if (error) return { error: toErrorMessage(error) };

  revalidateSnapshots(ids.data);
  redirect(repositoryPath(ids.data) + "/snapshots");
}

export async function updateSnapshotStatus(
  organizationId: string,
  departmentId: string,
  teamId: string,
  projectId: string,
  snapshotId: string,
  status: string,
  failureMessage?: string,
): Promise<SnapshotActionResult> {
  await requireUser();

  const ids = snapshotIdsSchema.safeParse({ organizationId, departmentId, teamId, projectId, snapshotId });
  const next = snapshotStatusSchema.safeParse(status);
  const message = failureMessageSchema.safeParse(failureMessage ?? "");
  if (!ids.success) return { error: "Invalid snapshot." };
  if (!next.success) return { error: "Invalid status." };
  if (!message.success) return { error: "The failure message is too long." };

  // Scoped to the project's own repository, so a snapshot id from another project is simply not found.
  const repository = await getMyRepository(ids.data.projectId);
  if (!repository) return { error: PERMISSION_MESSAGE };

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("repository_snapshots")
    .select("status")
    .eq("id", ids.data.snapshotId)
    .eq("repository_id", repository.id)
    .maybeSingle();
  if (readError) return { error: toErrorMessage(readError) };
  if (!current) return { error: PERMISSION_MESSAGE };

  const from = snapshotStatusSchema.safeParse(current.status);
  if (!from.success) return { error: GENERIC_MESSAGE };
  if (from.data === next.data) return {};
  if (!isAllowedSnapshotTransition(from.data, next.data)) {
    return { error: `A ${from.data} snapshot cannot move to ${next.data}.` };
  }

  // `.eq("status", from)` makes the change a compare-and-set, so a concurrent change is not overwritten.
  const { data, error } = await supabase
    .from("repository_snapshots")
    .update(snapshotStatusPatch(next.data, new Date(), message.data))
    .eq("id", ids.data.snapshotId)
    .eq("repository_id", repository.id)
    .eq("status", from.data)
    .select("id");
  if (error) return { error: toErrorMessage(error) };
  if (data.length === 0) return { error: PERMISSION_MESSAGE };

  revalidateSnapshots(ids.data);
  return {};
}

// Removes the snapshot together with its file manifest (cascade). There is no soft delete.
export async function deleteSnapshot(
  organizationId: string,
  departmentId: string,
  teamId: string,
  projectId: string,
  snapshotId: string,
): Promise<SnapshotActionResult> {
  await requireUser();

  const ids = snapshotIdsSchema.safeParse({ organizationId, departmentId, teamId, projectId, snapshotId });
  if (!ids.success) return { error: "Invalid snapshot." };

  const repository = await getMyRepository(ids.data.projectId);
  if (!repository) return { error: PERMISSION_MESSAGE };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("repository_snapshots")
    .delete()
    .eq("id", ids.data.snapshotId)
    .eq("repository_id", repository.id)
    .select("id");
  if (error) return { error: toErrorMessage(error) };
  if (data.length === 0) return { error: PERMISSION_MESSAGE };

  revalidateSnapshots(ids.data);
  return {};
}
