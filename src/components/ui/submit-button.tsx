import Link from "next/link";
import { Spinner, buttonClass } from "./button";

type SubmitButtonProps = {
  children: React.ReactNode;
  pending?: boolean;
  pendingLabel?: string;
  full?: boolean;
};

export function SubmitButton({ children, pending, pendingLabel = "Please wait…", full }: SubmitButtonProps) {
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass("primary", "md", full ? "w-full" : undefined)}>
      {pending && <Spinner />}
      {pending ? pendingLabel : children}
    </button>
  );
}

// The footer row of every form: optional Cancel link on the left of the primary action.
export function FormActions({ cancelHref, children }: { cancelHref?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border pt-5">
      {cancelHref && (
        <Link href={cancelHref} className={buttonClass("ghost", "md")}>
          Cancel
        </Link>
      )}
      {children}
    </div>
  );
}
