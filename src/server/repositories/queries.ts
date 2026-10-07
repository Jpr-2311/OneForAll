import "server-only";
import { createClient } from "@/lib/supabase/server";

// The project's primary repository, or null. RLS returns it only when the parent project is visible
// to the caller (OWNER/ADMIN or team member), so a repository of another project or tenant is never returned.
export async function getMyRepository(projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("repositories")
    .select("id, provider, repository_url, owner, name, default_branch, visibility, status")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load repository: ${error.message}`);
  return data;
}
