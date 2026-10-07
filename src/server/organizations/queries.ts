import "server-only";
import { createClient } from "@/lib/supabase/server";

// Organizations the current user belongs to. RLS limits rows to the caller's memberships.
export async function listMyOrganizations() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organizations(id, name, slug)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to load organizations: ${error.message}`);
  return data.flatMap(({ role, organizations }) => (organizations ? [{ ...organizations, role }] : []));
}

// The organization plus the caller's role, or null when the caller is not a member
// (RLS hides other tenants, so a forged id is indistinguishable from a missing one).
export async function getMyOrganization(organizationId: string, userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organizations(id, name, slug)")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load organization: ${error.message}`);
  if (!data?.organizations) return null;
  return { ...data.organizations, role: data.role };
}
