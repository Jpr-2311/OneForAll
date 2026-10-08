"use client";

import { useActionState } from "react";
import { Spinner, buttonClass } from "@/components/ui/button";
import { IconUnlink } from "@/components/ui/icons";
import type { RepositoryActionResult } from "@/server/repositories/schema";

type DisconnectRepositoryAction = (prev: RepositoryActionResult, formData: FormData) => Promise<RepositoryActionResult>;

// `action` must arrive already bound to its route ids, bound in a Server Component (see ConnectRepositoryForm).
export function DisconnectRepositoryForm({ action }: { action: DisconnectRepositoryAction }) {
  const [state, formAction, pending] = useActionState<RepositoryActionResult, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass("danger", "sm")}>
        {pending ? <Spinner /> : <IconUnlink size={14} />}
        {pending ? "Disconnecting…" : "Disconnect"}
      </button>
      {state.error && (
        <p role="alert" className="text-[12.5px] text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
