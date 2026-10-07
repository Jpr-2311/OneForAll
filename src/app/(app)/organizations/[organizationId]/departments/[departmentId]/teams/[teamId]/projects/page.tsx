import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeamContext, listProjects } from "@/server/projects/queries";

export const metadata = { title: "Projects · OneForAll" };

export default async function ProjectsPage({
  params,
}: PageProps<"/organizations/[organizationId]/departments/[departmentId]/teams/[teamId]/projects">) {
  const { organizationId, departmentId, teamId } = await params;
  const context = await getTeamContext(organizationId, departmentId, teamId);
  // 404 for malformed, mismatched, cross-tenant or not-permitted paths alike (no existence leak).
  if (!context || !context.canView) notFound();
  const { organization, department, team, canManage } = context;

  const projects = await listProjects(team.id);
  const base = `/organizations/${organization.id}/departments/${department.id}/teams/${team.id}/projects`;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/organizations/${organization.id}/departments/${department.id}/teams`} className="text-sm underline">
          {department.name} · Teams
        </Link>
        <h1 className="text-2xl font-semibold">{team.name} · Projects</h1>
      </div>
      {/* UI hint only. The database enforces who may actually create projects. */}
      {canManage && (
        <Link href={`${base}/new`} className="text-sm underline">
          New project
        </Link>
      )}
      {projects.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">No projects yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {projects.map((project) => (
            <li key={project.id} className="flex flex-col gap-0.5">
              <Link href={`${base}/${project.id}`} className="font-medium underline">
                {project.name}
              </Link>
              {project.description && (
                <span className="text-sm text-black/70 dark:text-white/70">{project.description}</span>
              )}
              <span className="text-sm text-black/60 dark:text-white/60">
                {project.project_type} · {project.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
