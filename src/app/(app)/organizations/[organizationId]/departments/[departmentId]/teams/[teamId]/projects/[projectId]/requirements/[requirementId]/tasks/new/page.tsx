import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkItemForm } from "@/components/work-items/work-item-form";
import { getMyRequirement, getProjectContext } from "@/server/requirements/queries";
import { createTask } from "@/server/tasks/actions";

export const metadata = { title: "New task · OneForAll" };

export default async function NewTaskPage({
  params,
}: PageProps<"/organizations/[organizationId]/departments/[departmentId]/teams/[teamId]/projects/[projectId]/requirements/[requirementId]/tasks/new">) {
  const { organizationId, departmentId, teamId, projectId, requirementId } = await params;
  const context = await getProjectContext(organizationId, departmentId, teamId, projectId);
  // Only OWNER/ADMIN may create tasks, so everyone else gets the same 404 as an invalid path.
  // This is a UI gate only; RLS rejects the insert regardless.
  if (!context || !context.canManage) notFound();
  const { organization, department, team, project } = context;

  // A task always belongs to a requirement of this project.
  const requirement = await getMyRequirement(project.id, requirementId);
  if (!requirement) notFound();

  return (
    <div className="flex max-w-md flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/organizations/${organization.id}/departments/${department.id}/teams/${team.id}/projects/${project.id}/requirements/${requirement.id}`}
          className="text-sm underline"
        >
          {requirement.title}
        </Link>
        <h1 className="text-2xl font-semibold">New task</h1>
        <p className="text-sm text-black/60 dark:text-white/60">New tasks start as to-do.</p>
      </div>
      {/* Bound here, in the Server Component. Never `.bind()` inside the Client Component. */}
      <WorkItemForm
        action={createTask.bind(null, organization.id, department.id, team.id, project.id, requirement.id)}
        submitLabel="Create task"
      />
    </div>
  );
}
