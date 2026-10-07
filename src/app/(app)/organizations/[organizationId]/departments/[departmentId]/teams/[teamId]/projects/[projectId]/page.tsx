import Link from "next/link";
import { notFound } from "next/navigation";
import { idSchema } from "@/server/departments/schema";
import { getMyProject, getTeamContext } from "@/server/projects/queries";

export const metadata = { title: "Project · OneForAll" };

export default async function ProjectPage({
  params,
}: PageProps<"/organizations/[organizationId]/departments/[departmentId]/teams/[teamId]/projects/[projectId]">) {
  const { organizationId, departmentId, teamId, projectId } = await params;
  if (!idSchema.safeParse(projectId).success) notFound();

  const context = await getTeamContext(organizationId, departmentId, teamId);
  if (!context || !context.canView) notFound();
  const { organization, department, team } = context;

  // Scoped to this team and RLS-filtered: a project from another team or tenant is simply not found.
  const project = await getMyProject(team.id, projectId);
  if (!project) notFound();

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link
          href={`/organizations/${organization.id}/departments/${department.id}/teams/${team.id}/projects`}
          className="text-sm underline"
        >
          {team.name} · Projects
        </Link>
        <h1 className="text-2xl font-semibold">{project.name}</h1>
      </div>
      {project.description && <p className="text-sm">{project.description}</p>}
      <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
        <dt className="text-black/60 dark:text-white/60">Type</dt>
        <dd>{project.project_type}</dd>
        <dt className="text-black/60 dark:text-white/60">Status</dt>
        <dd>{project.status}</dd>
        <dt className="text-black/60 dark:text-white/60">Team</dt>
        <dd>{team.name}</dd>
      </dl>
    </div>
  );
}
