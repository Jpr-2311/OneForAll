"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { FormField } from "@/components/ui/form-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { signIn } from "@/server/auth/actions";
import type { AuthFormState } from "@/server/auth/schema";

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(signIn, {});

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <FormField label="Email" name="email" type="email" autoComplete="email" placeholder="you@company.com" required errors={state.fieldErrors?.email} />
      <FormField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        errors={state.fieldErrors?.password}
      />
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <div className="pt-1">
        <SubmitButton pending={pending} pendingLabel="Signing in…" full>
          Sign in
        </SubmitButton>
      </div>
    </form>
  );
}
