import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { CardLink, IconTile } from "@/components/ui/card";
import { EmptyState, MetricCard } from "@/components/ui/data";
import { IconArrowRight, IconFolder, IconPlus, IconUsers } from "@/components/ui/icons";
import { PageBody, PageHeader } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { getTeamContext, listProjects } from "@/server/projects/queries";
import { listTeams } from "@/server/teams/queries";

export const metadata = { title: "Projects · OneForAll" };

export default async function ProjectsPage({
  params,
}: PageProps<"/organizations/[organizationId]/departments/[departmentId]/teams/[teamId]/projects">) {
  const { organizationId, departmentId, teamId } = await params;
  const context = await getTeamContext(organizationId, departmentId, teamId);
  // 404 for malformed, mismatched, cross-tenant or not-permitted paths alike (no existence leak).
  if (!context || !context.canView) notFound();
  const { organization, department, team, canManage } = context;

  const [projects, teams] = await Promise.all([listProjects(team.id), listTeams(department.id)]);
  // Presentation only: the team's description and member count from the existing list query.
  const details = teams.find((t) => t.id === team.id);
  const deptsHref = `/organizations/${organization.id}/departments`;
  const teamsHref = `${deptsHref}/${department.id}/teams`;
  const base = `${teamsHref}/${team.id}/projects`;
  const active = projects.filter((p) => p.status === "ACTIVE").length;
  const draft = projects.filter((p) => p.status === "DRAFT").length;

  return (
    <PageBody>
      <PageHeader
        crumbs={[
          { label: organization.name, href: deptsHref },
          { label: department.name, href: teamsHref },
          { label: team.name },
          { label: "Projects" },
        ]}
        icon={<IconUsers size={18} />}
        title={team.name}
        description={details?.description || `A team in ${department.name}.`}
        actions={
          /* UI hint only. The database enforces who may actually create projects. */
          canManage && (
            <ButtonLink href={`${base}/new`} variant="primary">
              <IconPlus size={15} />
              New project
            </ButtonLink>
          )
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Projects" value={projects.length} icon={<IconFolder size={15} />} />
        <MetricCard label="Active" value={active} tone={active > 0 ? "success" : "default"} />
        <MetricCard label="Draft" value={draft} />
        {details && <MetricCard label="Members" value={details.memberCount} icon={<IconUsers size={15} />} />}
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={<IconFolder size={20} />}
          title="No projects yet"
          description="Projects hold requirements, tasks and a connected repository. Create one to start planning work."
          action={
            canManage ? (
              <ButtonLink href={`${base}/new`} variant="primary">
                <IconPlus size={15} />
                Create project
              </ButtonLink>
            ) : (
              <p className="t-small text-fg-3">An owner or admin can create the first project.</p>
            )
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <CardLink key={project.id} href={`${base}/${project.id}`} className="flex flex-col p-5">
              <div className="flex items-start gap-3">
                <IconTile>
                  <IconFolder size={16} />
                </IconTile>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-fg">{project.name}</p>
                  <p className="truncate font-mono text-[11.5px] text-fg-3">{project.slug}</p>
                </div>
              </div>
              <p className="t-small mt-3 line-clamp-2 min-h-10 text-fg-2">
                {project.description || <span className="text-fg-3">No description</span>}
              </p>
              <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
                <div className="flex flex-wrap gap-1.5">
                  <StatusBadge kind="projectType" value={project.project_type} />
                  <StatusBadge kind="project" value={project.status} />
                </div>
                <IconArrowRight size={14} className="shrink-0 text-fg-3 transition-colors group-hover:text-accent" />
              </div>
            </CardLink>
          ))}
        </div>
      )}
    </PageBody>
  );
}
