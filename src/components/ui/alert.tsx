import { cx } from "@/lib/cx";
import { IconAlert, IconCheckCircle, IconInfo } from "./icons";

type AlertTone = "danger" | "success" | "info" | "warning";

const STYLES: Record<AlertTone, string> = {
  danger: "border-danger/30 bg-danger/[0.07] text-danger",
  success: "border-success/25 bg-success/[0.07] text-success",
  info: "border-info/25 bg-info/[0.07] text-info",
  warning: "border-warning/25 bg-warning/[0.07] text-warning",
};

// Inline banner. `danger` announces itself to assistive tech (role=alert), `success` as a status update.
export function Alert({
  tone = "danger",
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === "success" ? IconCheckCircle : tone === "danger" || tone === "warning" ? IconAlert : IconInfo;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx("flex gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] leading-5 animate-enter", STYLES[tone], className)}
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cx(title ? "mt-0.5" : undefined, "text-fg-2")}>{children}</div>}
      </div>
    </div>
  );
}
