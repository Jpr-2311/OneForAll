import { BrandMark } from "@/components/shell/brand";
import { IconBranch, IconListChecks, IconNetwork } from "@/components/ui/icons";

const POINTS = [
  { icon: IconListChecks, title: "Requirements to tasks", text: "One backlog from intent to delivery, owned by real teams." },
  { icon: IconBranch, title: "Repository intelligence", text: "Snapshots and structure analysis of the code you ship." },
  { icon: IconNetwork, title: "Enterprise hierarchy", text: "Organizations, departments, teams and projects with strict access control." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <section className="relative hidden overflow-hidden border-r border-border bg-bg-subtle lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.035)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_30%_20%,black_10%,transparent_70%)]"
        />
        <div aria-hidden="true" className="pointer-events-none absolute -top-40 -left-24 size-[520px] rounded-full bg-accent/10 blur-3xl" />
        <div className="relative">
          <BrandMark />
        </div>
        <div className="relative max-w-md">
          <p className="t-caption text-accent">Engineering workspace</p>
          <h2 className="t-display mt-3 text-fg">Shared engineering intelligence across the software lifecycle.</h2>
          <ul className="mt-10 flex flex-col gap-5">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3.5">
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-surface text-fg-2">
                  <Icon size={16} />
                </span>
                <span>
                  <span className="t-h3 block text-fg">{title}</span>
                  <span className="t-small text-fg-3">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative t-small text-fg-3">© OneForAll</p>
      </section>
      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-[380px] animate-enter">
          <div className="mb-8 lg:hidden">
            <BrandMark />
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
