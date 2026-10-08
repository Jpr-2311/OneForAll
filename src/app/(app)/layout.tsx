import { AppShell } from "@/components/shell/app-shell";
import { listMyWorkspaces } from "@/lib/workspaces";
import { signOut } from "@/server/auth/actions";
import { requireUser } from "@/server/auth/session";
import { getProfile } from "@/server/profiles/queries";

// Every route in (app) requires a verified user, independent of proxy.ts.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Read-only, existing queries: the profile for the account menu, the caller's organizations for the
  // workspace selector (RLS returns only organizations the user belongs to).
  const [profile, organizations] = await Promise.all([getProfile(user.id), listMyWorkspaces(user.id)]);
  const email = user.email ?? profile?.email ?? "";

  return (
    <AppShell
      user={{ name: profile?.display_name || email || "Account", email }}
      organizations={organizations.map(({ id, name, role }) => ({ id, name, role }))}
      signOutAction={signOut}
    >
      {children}
    </AppShell>
  );
}
