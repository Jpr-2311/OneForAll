"use client";

import { useActionState } from "react";
import { FormField } from "@/components/ui/form-field";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  PROVIDERS,
  PROVIDER_LABELS,
  type RepositoryFormState,
  VISIBILITIES,
  VISIBILITY_LABELS,
} from "@/server/repositories/schema";

type ConnectRepositoryAction = (prev: RepositoryFormState, formData: FormData) => Promise<RepositoryFormState>;

const SELECT_CLASS = "rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20";

// `action` must arrive already bound to the organization, department, team and project ids, bound in a
// Server Component. Never call `.bind()` here during client render: it creates a new server reference on
// every render and sends React's form-state check into an endless suspend/retry loop whenever the action
// returns an error state.
export function ConnectRepositoryForm({ action }: { action: ConnectRepositoryAction }) {
  const [state, formAction, pending] = useActionState<RepositoryFormState, FormData>(action, {});
  const errors = state.fieldErrors;

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="provider" className="text-sm font-medium">
          Provider
        </label>
        <select id="provider" name="provider" defaultValue="GITHUB" className={SELECT_CLASS}>
          {PROVIDERS.map((provider) => (
            <option key={provider} value={provider} className="text-black">
              {PROVIDER_LABELS[provider]}
            </option>
          ))}
        </select>
        {errors?.provider && <p className="text-sm text-red-600 dark:text-red-400">{errors.provider.join(" ")}</p>}
      </div>
      <FormField label="Repository URL (https)" name="repositoryUrl" type="url" required errors={errors?.repositoryUrl} />
      <FormField label="Owner (optional, taken from the URL)" name="owner" errors={errors?.owner} />
      <FormField label="Repository name (optional, taken from the URL)" name="name" errors={errors?.name} />
      <FormField label="Default branch" name="defaultBranch" required errors={errors?.defaultBranch} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="visibility" className="text-sm font-medium">
          Visibility
        </label>
        <select id="visibility" name="visibility" defaultValue="UNKNOWN" className={SELECT_CLASS}>
          {VISIBILITIES.map((visibility) => (
            <option key={visibility} value={visibility} className="text-black">
              {VISIBILITY_LABELS[visibility]}
            </option>
          ))}
        </select>
        {errors?.visibility && <p className="text-sm text-red-600 dark:text-red-400">{errors.visibility.join(" ")}</p>}
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <SubmitButton pending={pending}>Connect repository</SubmitButton>
    </form>
  );
}
