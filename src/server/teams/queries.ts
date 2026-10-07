import "server-only";
import { createClient } from "@/lib/supabase/server";

// The department, only if it belongs to the given organization and the caller can see it.
// RLS hides other tenants, so a forged id is indistinguishable from a missing one.
export async function getMyDepartment(organizationId: string, departmentId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("departments")
    .select("id, name, organization_id")
    .eq("id", departmentId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load department: ${error.message}`);
  return data;
}

export async function listTeams(departmentId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("teams")
    .select("id, name, slug, description, team_members(count)")
    .eq("department_id", departmentId)
    .order("name");

  if (error) throw new Error(`Failed to load teams: ${error.message}`);
  return data.map(({ team_members, ...team }) => ({
    ...team,
    memberCount: team_members[0]?.count ?? 0,
  }));
}
