import { cx } from "@/lib/cx";
import { IconTile } from "./card";

// Data-display primitives: empty states, metrics, key/value lists, avatars, skeletons.

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
}: {
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        "relative flex flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-border-strong bg-surface/60 text-center",
        compact ? "px-6 py-8" : "px-6 py-14",
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(rgb(255_255_255/0.05)_1px,transparent_1px)] [background-size:16px_16px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]"
      />
      <div className="relative flex flex-col items-center">
        <span className="mb-4 inline-flex size-11 items-center justify-center rounded-xl border border-border-strong bg-surface-2 text-fg-2 shadow-2">
          {icon}
        </span>
        <h3 className="t-h2 text-fg">{title}</h3>
        <p className="t-small mt-1 max-w-sm text-fg-3">{description}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  icon,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const valueColor = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-fg";
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 shadow-1">
      <div className="flex items-center justify-between gap-2">
        <span className="t-caption text-fg-3">{label}</span>
        {icon && <span className="text-fg-3">{icon}</span>}
      </div>
      <div className={cx("text-[22px] font-semibold leading-none tracking-tight tabular-nums", valueColor)}>{value}</div>
      {hint && <div className="t-small -mt-1 text-fg-3">{hint}</div>}
    </div>
  );
}

export function KeyValueList({ items, className }: { items: { label: string; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cx("divide-y divide-border", className)}>
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <dt className="t-small shrink-0 text-fg-3">{item.label}</dt>
          <dd className="t-small min-w-0 truncate text-right text-fg">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const AVATAR_TONES = ["from-[#7b8cff] to-[#5464e8]", "from-[#3ccf8e] to-[#1f9d68]", "from-[#f1a73b] to-[#d07c12]", "from-[#4ea5ff] to-[#2a76d4]", "from-[#c084fc] to-[#8b5cf6]", "from-[#f472b6] to-[#db2777]"];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic gradient avatar from initials; no images, no external requests.
export function Avatar({ name, size = "md", square }: { name: string; size?: "sm" | "md" | "lg"; square?: boolean }) {
  const hash = [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const dims = size === "sm" ? "size-6 text-[10px]" : size === "lg" ? "size-10 text-[13px]" : "size-8 text-[11px]";
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex shrink-0 items-center justify-center bg-gradient-to-br font-semibold text-white/95 shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]",
        square ? "rounded-lg" : "rounded-full",
        dims,
        AVATAR_TONES[hash % AVATAR_TONES.length],
      )}
    >
      {initials(name)}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("skeleton", className)} />;
}

export function formatDateTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16) + " UTC";
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

// Small stat pill used inside cards ("8 members", "3 projects").
export function Stat({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-3">
      {icon}
      {children}
    </span>
  );
}

export { IconTile };
