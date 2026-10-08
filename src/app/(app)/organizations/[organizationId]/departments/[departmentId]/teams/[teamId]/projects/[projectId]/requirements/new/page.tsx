import { notFound } from "next/navigation";
import { WorkItemForm } from "@/components/work-items/work-item-form";
import { Card, CardHeader } from "@/components/ui/card";
import { IconListChecks } from "@/components/ui/icons";
import { PageBody, PageHeader } from "@/components/ui/page";
import { createRequirement } from "@/server/requirements/actions";
import { getProjectContext } from "@/server/requirements/queries";

export const metadata = { title: "New requirement · OneForAll" };

export default async function NewRequirementPage({
  params,
}: PageProps<"/organizations/[organizationId]/departments/[departmentId]/teams/[teamId]/projects/[projectId]/requirements/new">) {
  const { organizationId, departmentId, teamId, projectId } = await params;
  const context = await getProjectContext(organizationId, departmentId, teamId, projectId);
  // Only OWNER/ADMIN may create requirements, so everyone else gets the same 404 as an invalid path.
  // This is a UI gate only; RLS rejects the insert regardless.
  if (!context || !context.canManage) notFound();
  const { organization, department, team, project } = context;
  const projectPath = `/organizations/${organization.id}/departments/${department.id}/teams/${team.id}/projects/${project.id}`;
  const listHref = `${projectPath}/requirements`;

  return (
    <PageBody width="form">
      <PageHeader
        crumbs={[
          { label: project.name, href: projectPath },
          { label: "Requirements", href: listHref },
          { label: "New" },
        ]}
        title="New requirement"
        description="New requirements start as a draft."
      />
      <Card>
        <CardHeader icon={<IconListChecks size={16} />} title="Requirement details" description={`For ${project.name}`} />
        <div className="px-5 py-5">
          {/* Bound here, in the Server Component. Never `.bind()` inside the Client Component. */}
          <WorkItemForm
            action={createRequirement.bind(null, organization.id, department.id, team.id, project.id)}
            submitLabel="Create requirement"
            kind="requirement"
            cancelHref={listHref}
          />
        </div>
      </Card>
    </PageBody>
  );
}
