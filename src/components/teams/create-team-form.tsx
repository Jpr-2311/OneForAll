"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { FormField } from "@/components/ui/form-field";
import { FormActions, SubmitButton } from "@/components/ui/submit-button";
import type { TeamFormState } from "@/server/teams/schema";

type CreateTeamAction = (prev: TeamFormState, formData: FormData) => Promise<TeamFormState>;

// `action` must arrive already bound to the organization and department ids, bound in a
// Server Component. Never call `.bind()` here during client render: it creates a new server
// reference on every render and sends React's form-state check into an endless suspend/retry
// loop whenever the action returns an error state.
export function CreateTeamForm({ action, cancelHref }: { action: CreateTeamAction; cancelHref?: string }) {
  const [state, formAction, pending] = useActionState<TeamFormState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormField
        label="Team name"
        name="name"
        placeholder="Platform Team"
        hint="Must be unique within the department."
        required
        errors={state.fieldErrors?.name}
      />
      <FormField
        label="Description"
        name="description"
        placeholder="Platform infrastructure and developer tooling"
        hint="What this team is responsible for."
        optional
        multiline
        errors={state.fieldErrors?.description}
      />
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <FormActions cancelHref={cancelHref}>
        <SubmitButton pending={pending} pendingLabel="Creating…">
          Create team
        </SubmitButton>
      </FormActions>
    </form>
  );
}
