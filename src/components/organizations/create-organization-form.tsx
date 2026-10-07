"use client";

import { useActionState } from "react";
import { FormField } from "@/components/ui/form-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { createOrganization } from "@/server/organizations/actions";
import type { CreateOrganizationState } from "@/server/organizations/schema";

export function CreateOrganizationForm() {
  const [state, formAction, pending] = useActionState<CreateOrganizationState, FormData>(createOrganization, {});

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <FormField label="Organization name" name="name" required errors={state.fieldErrors?.name} />
        {state.error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}
        <SubmitButton pending={pending}>Create organization</SubmitButton>
      </form>
      {state.organization && (
        <p role="status" className="text-sm">
          Created <strong>{state.organization.name}</strong> ({state.organization.slug}). Your role:{" "}
          <strong>{state.organization.role}</strong>.
        </p>
      )}
    </div>
  );
}
