import { ButtonLink } from "@/components/ui/button";
import { Card, CardLink } from "@/components/ui/card";
import { Avatar, EmptyState, MetricCard } from "@/components/ui/data";
import {
  IconArrowRight,
  IconBranch,
  IconBuilding,
  IconFolder,
  IconLayers,
  IconListChecks,
  IconNetwork,
  IconPlus,
  IconUsers,
} from "@/components/ui/icons";
import { PageBody, PageHeader, SectionHeader } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { listMyWorkspaces } from "@/lib/workspaces";
import { requireUser } from "@/server/auth/session";
import { getProfile } from "@/server/profiles/queries";

export const metadata = { title: "Dashboard · OneForAll" };

const HIERARCHY = [
  { icon: IconBuilding, label: "Organization", text: "Your company workspace and its members." },
  { icon: IconLayers, label: "Departments", text: "Group teams by area of ownership." },
  { icon: IconUsers, label: "Teams", text: "The people who build and own projects." },
  { icon: IconFolder, label: "Projects", text: "Requirements, tasks and a repository." },
  { icon: IconNetwork, label: "Intelligence", text: "Snapshots and code structure analysis." },
];

export default async function DashboardPage() {
  const user = await requireUser();
  const [profile, organizations] = await Promise.all([getProfile(user.id), listMyWorkspaces(user.id)]);
  const name = profile?.display_name ?? profile?.email ?? "there";
  const managed = organizations.filter((org) => org.role === "OWNER" || org.role === "ADMIN").length;

  return (
    <PageBody>
      <PageHeader
        crumbs={[{ label: "Dashboard" }]}
        title={`Welcome back, ${name}`}
        description="Your engineering workspaces at a glance."
        actions={
          <ButtonLink href="/organizations/new" variant="primary">
            <IconPlus size={15} />
            New organization
          </ButtonLink>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Organizations" value={organizations.length} icon={<IconBuilding size={15} />} hint="Workspaces you belong to" />
        <MetricCard label="Administered" value={managed} icon={<IconUsers size={15} />} hint="Where you are owner or admin" />
        <MetricCard label="Member only" value={organizations.length - managed} icon={<IconLayers size={15} />} hint="Read access through teams" />
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <SectionHeader title="Your organizations" description="Open a workspace to manage departments, teams and projects." />
          {organizations.length === 0 ? (
            <EmptyState
              icon={<IconBuilding size={20} />}
              title="No organizations yet"
              description="Create your first organization to start organizing departments, teams and engineering projects."
              action={
                <ButtonLink href="/organizations/new" variant="primary">
                  <IconPlus size={15} />
                  Create organization
                </ButtonLink>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {organizations.map((org) => (
                <CardLink key={org.id} href={`/organizations/${org.id}/departments`} className="p-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={org.name} size="lg" square />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-fg">{org.name}</p>
                      <p className="truncate font-mono text-[12px] text-fg-3">{org.slug}</p>
                    </div>
                    <StatusBadge kind="role" value={org.role} />
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[12.5px] text-fg-3">
                    <span>Departments & teams</span>
                    <span className="inline-flex items-center gap-1 text-fg-2 transition-colors group-hover:text-accent">
                      Open <IconArrowRight size={13} />
                    </span>
                  </div>
                </CardLink>
              ))}
            </div>
          )}
        </section>

        <aside>
          <SectionHeader title="How OneForAll is organized" />
          <Card className="p-2">
            <ol className="relative">
              {HIERARCHY.map(({ icon: Icon, label, text }, index) => (
                <li key={label} className="relative flex gap-3 rounded-lg p-3">
                  {index < HIERARCHY.length - 1 && (
                    <span aria-hidden="true" className="absolute top-11 bottom-[-6px] left-[27px] w-px bg-border-strong" />
                  )}
                  <span className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-surface-2 text-fg-2">
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="t-h3 block text-fg">{label}</span>
                    <span className="t-small text-fg-3">{text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
          <Card className="mt-3 flex items-start gap-3 p-4">
            <span className="mt-0.5 text-accent">
              <IconListChecks size={16} />
            </span>
            <p className="t-small text-fg-2">
              Inside a project you’ll find its <span className="text-fg">requirements</span>, their{" "}
              <span className="text-fg">tasks</span> and the connected <span className="text-fg">repository</span>{" "}
              <IconBranch size={12} className="inline text-fg-3" />.
            </p>
          </Card>
        </aside>
      </div>
    </PageBody>
  );
}
