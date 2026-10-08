import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { Alert } from "@/components/ui/alert";
import { safeRedirectPath } from "@/server/auth/schema";

export const metadata = { title: "Sign in · OneForAll" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeRedirectPath(params.next);
  const callbackFailed = params.error === "auth_callback_failed";

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="t-h1 text-fg">Sign in to OneForAll</h1>
        <p className="t-body mt-1.5 text-fg-2">Welcome back. Enter your work email to continue.</p>
      </div>
      {callbackFailed && <Alert tone="danger">That sign-in link is invalid or has expired. Please sign in again.</Alert>}
      <LoginForm next={next} />
      <p className="t-small text-fg-3">
        No account?{" "}
        <Link href="/signup" className="font-medium text-accent hover:text-fg">
          Create one
        </Link>
      </p>
    </div>
  );
}
