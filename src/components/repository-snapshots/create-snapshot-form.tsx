"use client";

import { useActionState } from "react";
import { FormField } from "@/components/ui/form-field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { SnapshotFormState } from "@/server/repository-snapshots/schema";

type CreateSnapshotAction = (prev: SnapshotFormState, formData: FormData) => Promise<SnapshotFormState>;

// `action` must arrive already bound to the organization, department, team and project ids, bound in a
// Server Component. Never call `.bind()` here during client render: it creates a new server reference on
// every render and sends React's form-state check into an endless suspend/retry loop whenever the action
// returns an error state.
export function CreateSnapshotForm({ action }: { action: CreateSnapshotAction }) {
  const [state, formAction, pending] = useActionState<SnapshotFormState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormField label="Commit SHA (full 40 or 64 hex characters)" name="commitSha" required errors={state.fieldErrors?.commitSha} />
      <FormField label="Branch" name="branch" required errors={state.fieldErrors?.branch} />
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <SubmitButton pending={pending}>Create snapshot</SubmitButton>
    </form>
  );
}
