"use client";

import { useActionState } from "react";
import type { RepositoryActionResult } from "@/server/repositories/schema";

type DisconnectRepositoryAction = (prev: RepositoryActionResult, formData: FormData) => Promise<RepositoryActionResult>;

// `action` must arrive already bound to its route ids, bound in a Server Component (see ConnectRepositoryForm).
export function DisconnectRepositoryForm({ action }: { action: DisconnectRepositoryAction }) {
  const [state, formAction, pending] = useActionState<RepositoryActionResult, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <button type="submit" disabled={pending} className="w-fit text-sm underline disabled:opacity-50">
        {pending ? "Disconnecting…" : "Disconnect"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}
