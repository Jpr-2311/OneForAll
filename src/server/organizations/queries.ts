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
