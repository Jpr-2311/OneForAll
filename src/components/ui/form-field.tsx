import { cx } from "@/lib/cx";
import { IconChevronDown } from "./icons";

// Form primitives. They only change how fields look: names, types, autocomplete, required flags and the error
// arrays coming back from the Server Actions are passed through untouched.

const CONTROL =
  "w-full rounded-md border border-border-strong bg-bg-subtle px-3 text-sm text-fg placeholder:text-fg-3 shadow-[inset_0_1px_2px_rgb(0_0_0/0.25)] outline-none transition-[border-color,box-shadow] duration-150 hover:border-[#3a3f48] focus:border-accent/70 focus:shadow-[0_0_0_3px_rgb(123_140_255/0.18)] aria-invalid:border-danger/70 aria-invalid:focus:shadow-[0_0_0_3px_rgb(240_90_95/0.18)]";

type FieldShellProps = {
  id: string;
  label: string;
  hint?: React.ReactNode;
  optional?: boolean;
  errors?: string[];
  children: React.ReactNode;
};

export function FieldShell({ id, label, hint, optional, errors, children }: FieldShellProps) {
  const hasError = Boolean(errors?.length);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-[13px] font-medium text-fg">
        {label}
        {optional && <span className="text-[11.5px] font-normal text-fg-3">Optional</span>}
      </label>
      {children}
      {hasError ? (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-[12.5px] text-danger">
          {errors!.join(" ")}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-[12.5px] leading-[18px] text-fg-3">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

type FormFieldProps = {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  errors?: string[];
  hint?: React.ReactNode;
  placeholder?: string;
  optional?: boolean;
  multiline?: boolean;
  rows?: number;
  mono?: boolean;
  autoFocus?: boolean;
};

export function FormField({
  label,
  name,
  type = "text",
  autoComplete,
  required,
  errors,
  hint,
  placeholder,
  optional,
  multiline,
  rows = 3,
  mono,
  autoFocus,
}: FormFieldProps) {
  const hasError = Boolean(errors?.length);
  const describedBy = hasError ? `${name}-error` : hint ? `${name}-hint` : undefined;
  const common = {
    id: name,
    name,
    required,
    placeholder,
    autoFocus,
    "aria-invalid": hasError,
    "aria-describedby": describedBy,
  };

  return (
    <FieldShell id={name} label={label} hint={hint} optional={optional} errors={errors}>
      {multiline ? (
        <textarea {...common} rows={rows} className={cx(CONTROL, "min-h-[84px] resize-y py-2 leading-relaxed")} />
      ) : (
        <input {...common} type={type} autoComplete={autoComplete} className={cx(CONTROL, "h-9", mono && "font-mono text-[13px]")} />
      )}
    </FieldShell>
  );
}

type SelectFieldProps = {
  label: string;
  name: string;
  defaultValue: string;
  options: readonly { value: string; label: string }[];
  errors?: string[];
  hint?: React.ReactNode;
};

// A styled native <select>: keyboard, screen-reader and no-JavaScript form posts keep working.
export function SelectField({ label, name, defaultValue, options, errors, hint }: SelectFieldProps) {
  const hasError = Boolean(errors?.length);
  return (
    <FieldShell id={name} label={label} hint={hint} errors={errors}>
      <div className="relative">
        <select
          id={name}
          name={name}
          defaultValue={defaultValue}
          aria-invalid={hasError}
          aria-describedby={hasError ? `${name}-error` : hint ? `${name}-hint` : undefined}
          className={cx(CONTROL, "h-9 cursor-pointer appearance-none pr-9")}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} className="bg-surface-2 text-fg">
              {option.label}
            </option>
          ))}
        </select>
        <IconChevronDown size={14} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-fg-3" />
      </div>
    </FieldShell>
  );
}

type RadioCardsProps = {
  legend: string;
  name: string;
  defaultValue: string;
  options: readonly { value: string; label: string; description: string; icon?: React.ReactNode }[];
  errors?: string[];
};

// Selectable cards backed by real radio inputs (visually hidden, still focusable and submitted with the form).
export function RadioCards({ legend, name, defaultValue, options, errors }: RadioCardsProps) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-[13px] font-medium text-fg">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="group relative flex cursor-pointer gap-3 rounded-lg border border-border-strong bg-bg-subtle p-3 transition-colors hover:border-[#3a3f48] has-[:checked]:border-accent/60 has-[:checked]:bg-accent/[0.06] has-[:focus-visible]:shadow-[0_0_0_3px_rgb(123_140_255/0.25)]"
          >
            <input type="radio" name={name} value={option.value} defaultChecked={option.value === defaultValue} className="peer sr-only" />
            {option.icon && (
              <span className="mt-0.5 text-fg-3 transition-colors group-has-[:checked]:text-accent">{option.icon}</span>
            )}
            <span className="flex min-w-0 flex-col">
              <span className="text-[13px] font-medium text-fg">{option.label}</span>
              <span className="text-[12.5px] leading-[18px] text-fg-3">{option.description}</span>
            </span>
            <span className="ml-auto mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border-strong transition-colors group-has-[:checked]:border-accent">
              <span className="size-2 scale-0 rounded-full bg-accent transition-transform group-has-[:checked]:scale-100" />
            </span>
          </label>
        ))}
      </div>
      {errors?.length ? <p className="text-[12.5px] text-danger">{errors.join(" ")}</p> : null}
    </fieldset>
  );
}

// Groups fields into a titled section inside a form card.
export function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="t-h3 text-fg">{title}</h3>
        {description && <p className="t-small mt-0.5 text-fg-3">{description}</p>}
      </div>
      {children}
    </div>
  );
}
