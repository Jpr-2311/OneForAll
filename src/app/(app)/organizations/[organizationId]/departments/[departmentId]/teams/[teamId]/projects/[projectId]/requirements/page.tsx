import Link from "next/link";
import { notFound } from "next/navigation";
import { getProjectContext, listRequirements } from "@/server/requirements/queries";

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

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={projectPath} className="text-sm underline">
          {project.name}
        </Link>
        <h1 className="text-2xl font-semibold">Requirements</h1>
      </div>
      {/* UI hint only. The database enforces who may actually create requirements. */}
      {canManage && (
        <Link href={`${projectPath}/requirements/new`} className="text-sm underline">
          New requirement
        </Link>
      )}
      {requirements.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">No requirements yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {requirements.map((requirement) => (
            <li key={requirement.id} className="flex flex-col gap-0.5">
              <Link href={`${projectPath}/requirements/${requirement.id}`} className="font-medium underline">
                {requirement.title}
              </Link>
              <span className="text-sm text-black/60 dark:text-white/60">
                {requirement.status} · {requirement.priority}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
