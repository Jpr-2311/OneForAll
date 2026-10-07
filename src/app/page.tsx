import Link from "next/link";
import { getCurrentUser } from "@/server/auth/session";

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-4xl font-semibold">OneForAll</h1>
      <p className="max-w-md text-black/60 dark:text-white/60">
        Shared engineering intelligence across the software development lifecycle.
      </p>
      <div className="flex gap-3">
        {user ? (
          <Link href="/dashboard" className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
            Go to dashboard
          </Link>
        ) : (
          <>
            <Link href="/login" className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
              Sign in
            </Link>
            <Link href="/signup" className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20">
              Create account
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
