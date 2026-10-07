"use client";

import { useActionState } from "react";
import { FormField } from "@/components/ui/form-field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ProjectFormState } from "@/server/projects/schema";

type CreateProjectAction = (prev: ProjectFormState, formData: FormData) => Promise<ProjectFormState>;

// `action` must arrive already bound to the organization, department and team ids, bound in a
// Server Component. Never call `.bind()` here during client render: it creates a new server
// reference on every render and sends React's form-state check into an endless suspend/retry
// loop whenever the action returns an error state.
export function CreateProjectForm({ action }: { action: CreateProjectAction }) {
  const [state, formAction, pending] = useActionState<ProjectFormState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormField label="Project name" name="name" required errors={state.fieldErrors?.name} />
      <FormField label="Description" name="description" errors={state.fieldErrors?.description} />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">Project type</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="projectType" value="GREENFIELD" defaultChecked /> Greenfield (new system)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="projectType" value="BROWNFIELD" /> Brownfield (existing system)
        </label>
        {state.fieldErrors?.projectType && (
          <p className="text-sm text-red-600 dark:text-red-400">{state.fieldErrors.projectType.join(" ")}</p>
        )}
      </fieldset>
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <SubmitButton pending={pending}>Create project</SubmitButton>
    </form>
  );
}
