type FormFieldProps = {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  errors?: string[];
};

export function FormField({ label, name, type = "text", autoComplete, required, errors }: FormFieldProps) {
  const errorId = `${name}-error`;
  const hasError = Boolean(errors?.length);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        aria-invalid={hasError}
        aria-describedby={hasError ? errorId : undefined}
        className="rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 aria-invalid:border-red-500 dark:border-white/20 dark:focus:border-white/50"
      />
      {hasError && (
        <p id={errorId} className="text-sm text-red-600 dark:text-red-400">
          {errors!.join(" ")}
        </p>
      )}
    </div>
  );
}
