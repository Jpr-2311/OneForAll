"use client";

import { useActionState } from "react";
import { FormField } from "@/components/ui/form-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { PRIORITIES, type WorkItemFormState } from "@/server/requirements/schema";

type WorkItemAction = (prev: WorkItemFormState, formData: FormData) => Promise<WorkItemFormState>;

// Shared by the "new requirement" and "new task" pages.
// `action` must arrive already bound to its route ids, bound in a Server Component. Never call
// `.bind()` here during client render: it creates a new server reference on every render and sends
// React's form-state check into an endless suspend/retry loop whenever the action returns an error state.
export function WorkItemForm({ action, submitLabel }: { action: WorkItemAction; submitLabel: string }) {
  const [state, formAction, pending] = useActionState<WorkItemFormState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormField label="Title" name="title" required errors={state.fieldErrors?.title} />
      <FormField label="Description" name="description" errors={state.fieldErrors?.description} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="priority" className="text-sm font-medium">
          Priority
        </label>
        <select
          id="priority"
          name="priority"
          defaultValue="MEDIUM"
          className="rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
        >
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority} className="text-black">
              {priority}
            </option>
          ))}
        </select>
        {state.fieldErrors?.priority && (
          <p className="text-sm text-red-600 dark:text-red-400">{state.fieldErrors.priority.join(" ")}</p>
        )}
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <SubmitButton pending={pending}>{submitLabel}</SubmitButton>
    </form>
  );
}
