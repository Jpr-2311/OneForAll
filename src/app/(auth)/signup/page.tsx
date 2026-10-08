import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata = { title: "Create account · OneForAll" };

export default function SignupPage() {
  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="t-h1 text-fg">Create your account</h1>
        <p className="t-body mt-1.5 text-fg-2">Set up your OneForAll workspace in a minute.</p>
      </div>
      <SignupForm />
      <p className="t-small text-fg-3">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:text-fg">
          Sign in
        </Link>
      </p>
    </div>
  );
}
