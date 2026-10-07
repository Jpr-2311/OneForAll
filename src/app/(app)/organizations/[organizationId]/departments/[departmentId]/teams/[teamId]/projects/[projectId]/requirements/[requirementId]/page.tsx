import Link from "next/link";
import { notFound } from "next/navigation";
import { getMyRequirement, getProjectContext } from "@/server/requirements/queries";
import { listTasks } from "@/server/tasks/queries";

export const metadata = { title: "Requirement · OneForAll" };

export default async function RequirementPage({
  params,
}: PageProps<"/organizations/[organizationId]/departments/[departmentId]/teams/[teamId]/projects/[projectId]/requirements/[requirementId]">) {
  const { organizationId, departmentId, teamId, projectId, requirementId } = await params;
  const context = await getProjectContext(organizationId, departmentId, teamId, projectId);
  if (!context) notFound();
  const { organization, department, team, project, canManage } = context;

  // Scoped to this project and RLS-filtered: a requirement from another project or tenant is simply not found.
  const requirement = await getMyRequirement(project.id, requirementId);
  if (!requirement) notFound();

  const tasks = await listTasks(requirement.id);
  const base = `/organizations/${organization.id}/departments/${department.id}/teams/${team.id}/projects/${project.id}/requirements`;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={base} className="text-sm underline">
          {project.name} · Requirements
        </Link>
        <h1 className="text-2xl font-semibold">{requirement.title}</h1>
      </div>
      {requirement.description && <p className="text-sm">{requirement.description}</p>}
      <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
        <dt className="text-black/60 dark:text-white/60">Status</dt>
        <dd>{requirement.status}</dd>
        <dt className="text-black/60 dark:text-white/60">Priority</dt>
        <dd>{requirement.priority}</dd>
      </dl>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Tasks</h2>
        {/* UI hint only. The database enforces who may actually create tasks. */}
        {canManage && (
          <Link href={`${base}/${requirement.id}/tasks/new`} className="text-sm underline">
            New task
          </Link>
        )}
        {tasks.length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">No tasks yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {tasks.map((task) => (
              <li key={task.id} className="flex flex-col gap-0.5">
                <span className="font-medium">{task.title}</span>
                <span className="text-sm text-black/60 dark:text-white/60">
                  {task.status} · {task.priority}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
