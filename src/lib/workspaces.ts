import "server-only";
import { getMyOrganization, listMyOrganizations } from "@/server/organizations/queries";

export type Workspace = { id: string; name: string; slug: string; role: string };

// Presentation helper over two EXISTING, unchanged queries.
// listMyOrganizations() returns one row per membership the caller can see (every member of their organizations),
// so the same organization can appear several times with other members' roles. For display we de-duplicate by
// organization id and take the caller's own role from getMyOrganization(id, userId), which filters by user.
export async function listMyWorkspaces(userId: string): Promise<Workspace[]> {
  const rows = await listMyOrganizations();
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  const resolved = await Promise.all(unique.map((org) => getMyOrganization(org.id, userId)));
  return resolved.flatMap((org) => (org ? [{ id: org.id, name: org.name, slug: org.slug, role: org.role }] : []));
}
