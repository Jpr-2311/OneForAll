import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/data";
import { IconChevronRight, IconListChecks, IconPlus } from "@/components/ui/icons";
import { PageBody, PageHeader } from "@/components/ui/page";
import { PriorityBadge, StatusBadge, humanize } from "@/components/ui/status";
import { getProjectContext, listRequirements } from "@/server/requirements/queries";
import { REQUIREMENT_STATUSES } from "@/server/requirements/schema";

export const metadata = { title: "Requirements · OneForAll" };

export default async function RequirementsPage({
  params,
}: PageProps<"/organizations/[organizationId]/departments/[departmentId]/teams/[teamId]/projects/[projectId]/requirements">) {
  const { organizationId, departmentId, teamId, projectId } = await params;
  const context = await getProjectContext(organizationId, departmentId, teamId, projectId);
  // 404 for malformed, mismatched, cross-tenant or not-permitted paths alike (no existence leak).
  if (!context) notFound();
  const { organization, department, team, project, canManage } = context;

  const requirements = await listRequirements(project.id);
  const projectPath = `/organizations/${organization.id}/departments/${department.id}/teams/${team.id}/projects/${project.id}`;
  const teamsHref = `/organizations/${organization.id}/departments/${department.id}/teams`;
  const counts = REQUIREMENT_STATUSES.map((status) => ({ status, count: requirements.filter((r) => r.status === status).length }));

  return (
    <PageBody>
      <PageHeader
        crumbs={[
          { label: team.name, href: `${teamsHref}/${team.id}/projects` },
          { label: project.name, href: projectPath },
          { label: "Requirements" },
        ]}
        icon={<IconListChecks size={18} />}
        title="Requirements"
        description={`The engineering backlog for ${project.name}. Each requirement breaks down into tasks.`}
        actions={
          /* UI hint only. The database enforces who may actually create requirements. */
          canManage && (
            <ButtonLink href={`${projectPath}/requirements/new`} variant="primary">
              <IconPlus size={15} />
              New requirement
            </ButtonLink>
          )
        }
      />

      {requirements.length === 0 ? (
        <EmptyState
          icon={<IconListChecks size={20} />}
          title="No requirements yet"
          description="Requirements describe what this project must deliver. Add the first one to start planning tasks."
          action={
            canManage && (
              <ButtonLink href={`${projectPath}/requirements/new`} variant="primary">
                <IconPlus size={15} />
                Create requirement
              </ButtonLink>
            )
          }
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-fg-3">
            <span>
              <span className="tabular-nums text-fg">{requirements.length}</span> total
            </span>
            {counts
              .filter((c) => c.count > 0)
              .map(({ status, count }) => (
                <span key={status} className="inline-flex items-center gap-1.5">
                  <StatusBadge kind="requirement" value={status} label={`${humanize(status)} · ${count}`} />
                </span>
              ))}
          </div>
          <Card className="overflow-hidden">
            <div className="hidden grid-cols-[minmax(0,1fr)_130px_120px_24px] gap-4 border-b border-border bg-surface-2/50 px-5 py-2.5 sm:grid">
              <span className="t-caption text-fg-3">Requirement</span>
              <span className="t-caption text-fg-3">Status</span>
              <span className="t-caption text-fg-3">Priority</span>
              <span />
            </div>
            <ul className="divide-y divide-border">
              {requirements.map((requirement) => (
                <li key={requirement.id}>
                  <Link
                    href={`${projectPath}/requirements/${requirement.id}`}
                    className="group grid grid-cols-1 gap-2 px-5 py-3.5 transition-colors hover:bg-surface-2/60 sm:grid-cols-[minmax(0,1fr)_130px_120px_24px] sm:items-center sm:gap-4"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <IconListChecks size={15} className="shrink-0 text-fg-3" />
                      <span className="truncate text-[13.5px] font-medium text-fg group-hover:text-accent">{requirement.title}</span>
                    </span>
                    <span className="flex gap-1.5 sm:block">
                      <StatusBadge kind="requirement" value={requirement.status} />
                      <span className="sm:hidden">
                        <PriorityBadge value={requirement.priority} />
                      </span>
                    </span>
                    <span className="hidden sm:block">
                      <PriorityBadge value={requirement.priority} />
                    </span>
                    <IconChevronRight size={15} className="hidden text-fg-3 transition-transform group-hover:translate-x-0.5 group-hover:text-fg sm:block" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </PageBody>
  );
}
