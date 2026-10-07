"use client";

import { useActionState } from "react";
import type { AnalysisActionState } from "@/server/repository-structure/schema";

type AnalyzeStructureAction = (prev: AnalysisActionState, formData: FormData) => Promise<AnalysisActionState>;

// `action` must arrive already bound to its route ids, bound in a Server Component (see DisconnectRepositoryForm).
export function AnalyzeStructureForm({ action, label }: { action: AnalyzeStructureAction; label: string }) {
  const [state, formAction, pending] = useActionState<AnalysisActionState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <button type="submit" disabled={pending} className="w-fit text-sm underline disabled:opacity-50">
        {pending ? "Analyzing…" : label}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}
