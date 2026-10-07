import "server-only";
import { createClient } from "@/lib/supabase/server";

// RLS returns tasks only when the parent requirement (and therefore its project) is visible.
export async function listTasks(requirementId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, status, priority")
    .eq("requirement_id", requirementId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to load tasks: ${error.message}`);
  return data;
}
