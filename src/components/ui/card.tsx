import Link from "next/link";
import type { ComponentProps } from "react";
import { cx } from "@/lib/cx";

const SURFACE = "rounded-xl border border-border bg-surface shadow-1";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx(SURFACE, className)} {...props} />;
}

// A whole-card link with a restrained hover lift. Use for navigable entities (department, team, project...).
export function CardLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cx(
        SURFACE,
        "group block transition-[border-color,background-color,transform] duration-150 hover:-translate-y-px hover:border-border-strong hover:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  icon,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-start justify-between gap-3 border-b border-border px-5 py-4", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <IconTile>{icon}</IconTile>}
        <div className="min-w-0">
          <h2 className="t-h3 text-fg">{title}</h2>
          {description && <p className="t-small mt-0.5 text-fg-3">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("flex items-center justify-between gap-3 border-t border-border px-5 py-3", className)} {...props} />;
}

// Square icon holder used across cards, empty states and metrics.
export function IconTile({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "accent"; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border",
        tone === "accent" ? "border-accent/25 bg-accent/10 text-accent" : "border-border-strong bg-surface-2 text-fg-2",
        className,
      )}
    >
      {children}
    </span>
  );
}
