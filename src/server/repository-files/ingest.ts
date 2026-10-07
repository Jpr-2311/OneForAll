import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/server/auth/session";
import { idSchema } from "@/server/departments/schema";
import { type ManifestInput, prepareManifest } from "./manifest";

// Internal ingestion entry point for a FUTURE server-side adapter (and for server-side test fixtures).
// It is deliberately NOT a Server Action ("use server"): the browser can never call it, never supplies a
// manifest or a filesystem path, and cannot read any file through it. It records metadata only:
// authorization is whatever RLS allows the signed-in user to insert (OWNER/ADMIN, snapshot still
// PENDING or PROCESSING), and nothing is stored but path, language, size and hash.

export const MAX_FILES_PER_INGEST = 5000;

export type IngestResult =
  | { ok: true; inserted: number; skipped: { path: string; reason: string }[] }
  | { ok: false; error: string; rejected?: { path: string; error: string }[] };

export async function ingestManifest(snapshotId: string, inputs: readonly ManifestInput[]): Promise<IngestResult> {
  await requireUser();

  if (!idSchema.safeParse(snapshotId).success) return { ok: false, error: "Invalid snapshot." };
  if (inputs.length > MAX_FILES_PER_INGEST) return { ok: false, error: `At most ${MAX_FILES_PER_INGEST} files per ingest.` };

  const { entries, skipped, rejected } = prepareManifest(inputs);
  // Fail closed: one unsafe or malformed entry rejects the whole batch.
  if (rejected.length > 0) return { ok: false, error: "The manifest contains invalid entries.", rejected };
  if (entries.length === 0) return { ok: true, inserted: 0, skipped };

  // A single INSERT statement is atomic: either every row is recorded or none is.
  const supabase = await createClient();
  const { error } = await supabase.from("repository_files").insert(
    entries.map((entry) => ({
      snapshot_id: snapshotId,
      path: entry.path,
      language: entry.language,
      size_bytes: entry.sizeBytes,
      content_hash: entry.contentHash,
    })),
  );
  if (error) {
    if (error.code === "42501") return { ok: false, error: "You cannot add files to this snapshot." };
    if (error.code === "23505") return { ok: false, error: "A path in the manifest already exists in this snapshot." };
    return { ok: false, error: "Could not record the manifest." };
  }
  return { ok: true, inserted: entries.length, skipped };
}
