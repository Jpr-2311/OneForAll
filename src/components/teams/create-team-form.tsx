"use client";

import { useActionState } from "react";
import { FormField } from "@/components/ui/form-field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { TeamFormState } from "@/server/teams/schema";

type CreateTeamAction = (prev: TeamFormState, formData: FormData) => Promise<TeamFormState>;

// `action` must arrive already bound to the organization and department ids, bound in a
// Server Component. Never call `.bind()` here during client render: it creates a new server
// reference on every render and sends React's form-state check into an endless suspend/retry
// loop whenever the action returns an error state.
export function CreateTeamForm({ action }: { action: CreateTeamAction }) {
  const [state, formAction, pending] = useActionState<TeamFormState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormField label="Team name" name="name" required errors={state.fieldErrors?.name} />
      <FormField label="Description" name="description" errors={state.fieldErrors?.description} />
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <SubmitButton pending={pending}>Create team</SubmitButton>
    </form>
  );
}
