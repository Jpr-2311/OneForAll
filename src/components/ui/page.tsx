import Link from "next/link";
import { Fragment } from "react";
import { cx } from "@/lib/cx";
import { IconTile } from "./card";
import { IconChevronRight } from "./icons";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-[12.5px] text-fg-3">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              <li className="min-w-0">
                {item.href && !last ? (
                  <Link href={item.href} className="block max-w-[14rem] truncate rounded px-1 py-0.5 transition-colors hover:bg-surface-3 hover:text-fg">
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current={last ? "page" : undefined} className={cx("block max-w-[16rem] truncate px-1 py-0.5", last && "text-fg-2")}>
                    {item.label}
                  </span>
                )}
              </li>
              {!last && (
                <li aria-hidden="true" className="text-border-strong">
                  <IconChevronRight size={12} />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

// Page top: breadcrumbs, optional icon tile, title, description, badges and actions.
export function PageHeader({
  crumbs,
  title,
  description,
  icon,
  badges,
  actions,
  children,
}: {
  crumbs?: Crumb[];
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 pb-6">
      {crumbs && crumbs.length > 0 && <Breadcrumbs items={crumbs} />}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          {icon && (
            <IconTile tone="accent" className="mt-0.5 size-10 rounded-xl">
              {icon}
            </IconTile>
          )}
          <div className="min-w-0">
            <h1 className="t-h1 break-words text-fg">{title}</h1>
            {description && <p className="t-body mt-1 max-w-2xl text-fg-2">{description}</p>}
            {badges && <div className="mt-3 flex flex-wrap items-center gap-1.5">{badges}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="text-fg-3">{icon}</span>}
        <div className="min-w-0">
          <h2 className="t-h2 text-fg">{title}</h2>
          {description && <p className="t-small text-fg-3">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

// Width-constrained page body with the entry animation.
export function PageBody({ children, width = "wide" }: { children: React.ReactNode; width?: "wide" | "narrow" | "form" }) {
  const max = width === "form" ? "max-w-2xl" : width === "narrow" ? "max-w-4xl" : "max-w-6xl";
  return <div className={cx("mx-auto w-full animate-enter", max)}>{children}</div>;
}
