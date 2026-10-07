import "server-only";
import { createClient } from "@/lib/supabase/server";

// Departments of an organization the caller belongs to. RLS returns nothing for other tenants.
export async function listDepartments(organizationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("departments")
    .select("id, name, slug, description, department_members(count)")
    .eq("organization_id", organizationId)
    .order("name");

  if (error) throw new Error(`Failed to load departments: ${error.message}`);
  return data.map(({ department_members, ...department }) => ({
    ...department,
    memberCount: department_members[0]?.count ?? 0,
  }));
}
