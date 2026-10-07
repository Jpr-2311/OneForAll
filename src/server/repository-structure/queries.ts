import "server-only";
import { createClient } from "@/lib/supabase/server";

// The analysis of one snapshot, or null. RLS returns it only when the snapshot (and so the project) is visible to
// the caller (OWNER/ADMIN or team member), so another project's or tenant's analysis is never returned.
export async function getAnalysisForSnapshot(snapshotId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("repository_structure_analyses")
    .select(
      "id, snapshot_id, status, started_at, completed_at, error_message, files_total, files_analyzed, files_unsupported, files_failed, symbols_count, relationships_count",
    )
    .eq("snapshot_id", snapshotId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load structure analysis: ${error.message}`);
  return data;
}
