import { BrandMark } from "@/components/shell/brand";
import { ButtonLink } from "@/components/ui/button";
import { IconArrowRight, IconBranch, IconListChecks, IconNetwork } from "@/components/ui/icons";
import { getCurrentUser } from "@/server/auth/session";

const PILLARS = [
  { icon: IconListChecks, title: "Requirements & tasks", text: "A shared backlog per project, from draft requirement to completed task." },
  { icon: IconBranch, title: "Repository snapshots", text: "Record repositories and the exact commits your teams ship." },
  { icon: IconNetwork, title: "Structure intelligence", text: "Symbols and relationships extracted from your code, per snapshot." },
];

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgb(255_255_255/0.03)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.03)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_50%_0%,black_10%,transparent_65%)]"
      />
      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <BrandMark />
        {!user && (
          <ButtonLink href="/login" variant="ghost" size="sm">
            Sign in
          </ButtonLink>
        )}
      </header>
      <section className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-16 text-center animate-enter">
        <span className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface px-3 py-1 text-[12px] text-fg-2">
          <span className="size-1.5 rounded-full bg-accent" />
          Enterprise software engineering platform
        </span>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
          Shared engineering intelligence,
          <br className="hidden sm:block" /> from requirement to repository.
        </h1>
        <p className="t-body mt-5 max-w-xl text-fg-2 sm:text-base">
          OneForAll connects your organization, teams, projects and code so every engineer works from the same source of truth.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {user ? (
            <ButtonLink href="/dashboard" variant="primary">
              Go to dashboard
              <IconArrowRight size={15} />
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href="/login" variant="primary">
                Sign in
                <IconArrowRight size={15} />
              </ButtonLink>
              <ButtonLink href="/signup" variant="secondary">
                Create account
              </ButtonLink>
            </>
          )}
        </div>
      </section>
      <section className="relative mx-auto grid w-full max-w-5xl gap-3 px-6 pb-16 sm:grid-cols-3">
        {PILLARS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-xl border border-border bg-surface/80 p-5 shadow-1 backdrop-blur">
            <span className="inline-flex size-8 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-accent">
              <Icon size={16} />
            </span>
            <h2 className="t-h3 mt-4 text-fg">{title}</h2>
            <p className="t-small mt-1 text-fg-3">{text}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
