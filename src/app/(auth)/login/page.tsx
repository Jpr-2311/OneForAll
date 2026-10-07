import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { safeRedirectPath } from "@/server/auth/schema";

export const metadata = { title: "Sign in · OneForAll" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeRedirectPath(params.next);
  const callbackFailed = params.error === "auth_callback_failed";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Sign in to OneForAll</h1>
      {callbackFailed && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          That sign-in link is invalid or has expired. Please sign in again.
        </p>
      )}
      <LoginForm next={next} />
      <p className="text-sm">
        No account?{" "}
        <Link href="/signup" className="underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
