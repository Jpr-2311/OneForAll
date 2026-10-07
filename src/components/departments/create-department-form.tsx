"use client";

import { useActionState } from "react";
import { FormField } from "@/components/ui/form-field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { DepartmentFormState } from "@/server/departments/schema";

type CreateDepartmentAction = (prev: DepartmentFormState, formData: FormData) => Promise<DepartmentFormState>;

// `action` must arrive already bound to the organization id, bound in a Server Component.
// Calling `.bind()` here, during client render, makes a new server reference on every render,
// which sends React's server-side form-state check into an endless suspend/retry loop whenever
// the action returns an error state (see the page for the bind).
export function CreateDepartmentForm({ action }: { action: CreateDepartmentAction }) {
  const [state, formAction, pending] = useActionState<DepartmentFormState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormField label="Name" name="name" required errors={state.fieldErrors?.name} />
      <FormField label="Description" name="description" errors={state.fieldErrors?.description} />
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <SubmitButton pending={pending}>Create department</SubmitButton>
    </form>
  );
}
