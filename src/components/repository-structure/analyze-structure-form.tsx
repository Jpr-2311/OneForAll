"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Spinner, buttonClass } from "@/components/ui/button";
import { IconSparkle } from "@/components/ui/icons";
import type { AnalysisActionState } from "@/server/repository-structure/schema";

type AnalyzeStructureAction = (prev: AnalysisActionState, formData: FormData) => Promise<AnalysisActionState>;

// `action` must arrive already bound to its route ids, bound in a Server Component (see DisconnectRepositoryForm).
export function AnalyzeStructureForm({ action, label }: { action: AnalyzeStructureAction; label: string }) {
  const [state, formAction, pending] = useActionState<AnalysisActionState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass("primary", "md", "w-fit")}>
        {pending ? <Spinner /> : <IconSparkle size={15} />}
        {pending ? "Analyzing…" : label}
      </button>
      {state.error && <Alert tone="danger">{state.error}</Alert>}
    </form>
  );
}
