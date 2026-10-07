"use client";

import { useActionState } from "react";
import { FormField } from "@/components/ui/form-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { signUp } from "@/server/auth/actions";
import type { AuthFormState } from "@/server/auth/schema";

export function SignupForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(signUp, {});

  if (state.message) {
    return (
      <p role="status" className="text-sm">
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormField label="Name" name="displayName" autoComplete="name" required errors={state.fieldErrors?.displayName} />
      <FormField label="Email" name="email" type="email" autoComplete="email" required errors={state.fieldErrors?.email} />
      <FormField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.password}
      />
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <SubmitButton pending={pending}>Create account</SubmitButton>
    </form>
  );
}
