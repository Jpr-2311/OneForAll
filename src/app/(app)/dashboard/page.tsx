import { requireUser } from "@/server/auth/session";
import { getProfile } from "@/server/profiles/queries";

export const metadata = { title: "Dashboard · OneForAll" };

export default async function DashboardPage() {
  const user = await requireUser();
  const profile = await getProfile(user.id);

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Welcome, {profile?.display_name ?? profile?.email ?? "there"}</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        Organizations and projects arrive in the next foundation step.
      </p>
    </div>
  );
}
