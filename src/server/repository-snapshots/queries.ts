import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getProjectContext } from "@/server/requirements/queries";
import { getMyRepository } from "@/server/repositories/queries";

// Verifies the whole chain from the database, never from the URL:
// organization -> department -> team -> project -> repository. Returns null for malformed ids, other
// tenants, mismatched paths, projects the caller cannot see, and projects with no repository alike,
// so callers 404 without revealing which link failed. `canManage` is a UI hint; RLS decides.
export async function getRepositoryContext(
  organizationId: string,
  departmentId: string,
  teamId: string,
  projectId: string,
) {
  const context = await getProjectContext(organizationId, departmentId, teamId, projectId);
  if (!context) return null;
  const repository = await getMyRepository(context.project.id);
  if (!repository) return null;
  return { ...context, repository };
}

// Snapshots of one repository, newest first, with their manifest size. RLS returns them only when the
// parent repository (and so the project) is visible to the caller.
export async function listSnapshots(repositoryId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("repository_snapshots")
    .select("id, commit_sha, branch, status, started_at, completed_at, error_message, created_at, repository_files(count)")
    .eq("repository_id", repositoryId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to load snapshots: ${error.message}`);
  return data.map(({ repository_files, ...snapshot }) => ({
    ...snapshot,
    fileCount: repository_files[0]?.count ?? 0,
  }));
}
