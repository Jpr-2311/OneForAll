import { cx } from "@/lib/cx";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "muted";

const TONES: Record<Tone, string> = {
  neutral: "border-border-strong bg-surface-2 text-fg-2",
  muted: "border-border bg-transparent text-fg-3",
  accent: "border-accent/30 bg-accent/10 text-accent",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
  info: "border-info/25 bg-info/10 text-info",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-fg-3",
  muted: "bg-fg-3",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function Badge({
  tone = "neutral",
  dot = false,
  pulse = false,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-[22px] items-center gap-1.5 rounded-md border px-2 text-[11.5px] font-medium leading-none whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {dot && (
        <span className="relative flex size-1.5">
          {pulse && <span className={cx("absolute inset-0 animate-ping rounded-full opacity-60", DOTS[tone])} />}
          <span className={cx("relative size-1.5 rounded-full", DOTS[tone])} />
        </span>
      )}
      {children}
    </span>
  );
}
