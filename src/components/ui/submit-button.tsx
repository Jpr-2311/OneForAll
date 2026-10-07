type SubmitButtonProps = {
  children: React.ReactNode;
  pending?: boolean;
};

export function SubmitButton({ children, pending }: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-50"
    >
      {pending ? "Please wait…" : children}
    </button>
  );
}
