import { notFound } from "next/navigation";
import { CreateProjectForm } from "@/components/projects/create-project-form";
import { Card, CardHeader } from "@/components/ui/card";
import { IconFolder } from "@/components/ui/icons";
import { PageBody, PageHeader } from "@/components/ui/page";
import { createProject } from "@/server/projects/actions";
import { getTeamContext } from "@/server/projects/queries";

export const metadata = { title: "New project · OneForAll" };

export default async function NewProjectPage({
  params,
}: PageProps<"/organizations/[organizationId]/departments/[departmentId]/teams/[teamId]/projects/new">) {
  const { organizationId, departmentId, teamId } = await params;
  const context = await getTeamContext(organizationId, departmentId, teamId);
  // Only OWNER/ADMIN may create projects, so everyone else gets the same 404 as an invalid path.
  // This is a UI gate only; RLS rejects the insert regardless.
  if (!context || !context.canManage) notFound();
  const { organization, department, team } = context;
  const deptsHref = `/organizations/${organization.id}/departments`;
  const teamsHref = `${deptsHref}/${department.id}/teams`;
  const projectsHref = `${teamsHref}/${team.id}/projects`;

  return (
    <PageBody width="form">
      <PageHeader
        crumbs={[
          { label: organization.name, href: deptsHref },
          { label: department.name, href: teamsHref },
          { label: team.name, href: projectsHref },
          { label: "New project" },
        ]}
        title="Create a project"
        description="New projects start as a draft. You can connect a repository and add requirements afterwards."
      />
      <Card>
        <CardHeader icon={<IconFolder size={16} />} title="Project details" description={`Owned by ${team.name}`} />
        <div className="px-5 py-5">
          {/* Bound here, in the Server Component. Never `.bind()` inside the Client Component. */}
          <CreateProjectForm action={createProject.bind(null, organization.id, department.id, team.id)} cancelHref={projectsHref} />
        </div>
      </Card>
    </PageBody>
  );
}
