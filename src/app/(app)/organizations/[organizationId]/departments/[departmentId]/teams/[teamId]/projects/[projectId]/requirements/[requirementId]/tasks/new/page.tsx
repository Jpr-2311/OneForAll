import { notFound } from "next/navigation";
import { WorkItemForm } from "@/components/work-items/work-item-form";
import { Card, CardHeader } from "@/components/ui/card";
import { IconTask } from "@/components/ui/icons";
import { PageBody, PageHeader } from "@/components/ui/page";
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
  const projectPath = `/organizations/${organization.id}/departments/${department.id}/teams/${team.id}/projects/${project.id}`;
  const requirementHref = `${projectPath}/requirements/${requirement.id}`;

  return (
    <PageBody width="form">
      <PageHeader
        crumbs={[
          { label: project.name, href: projectPath },
          { label: "Requirements", href: `${projectPath}/requirements` },
          { label: requirement.title, href: requirementHref },
          { label: "New task" },
        ]}
        title="New task"
        description="New tasks start as to-do."
      />
      <Card>
        <CardHeader icon={<IconTask size={16} />} title="Task details" description={`Part of “${requirement.title}”`} />
        <div className="px-5 py-5">
          {/* Bound here, in the Server Component. Never `.bind()` inside the Client Component. */}
          <WorkItemForm
            action={createTask.bind(null, organization.id, department.id, team.id, project.id, requirement.id)}
            submitLabel="Create task"
            kind="task"
            cancelHref={requirementHref}
          />
        </div>
      </Card>
    </PageBody>
  );
}
