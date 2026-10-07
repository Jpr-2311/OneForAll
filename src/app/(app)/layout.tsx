import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { signOut } from "@/server/auth/actions";

// Every route in (app) requires a verified user, independent of proxy.ts.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-black/10 px-6 py-3 dark:border-white/15">
        <Link href="/dashboard" className="font-semibold">
          OneForAll
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-black/60 dark:text-white/60">{user.email}</span>
          <form action={signOut}>
            <button type="submit" className="underline">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
