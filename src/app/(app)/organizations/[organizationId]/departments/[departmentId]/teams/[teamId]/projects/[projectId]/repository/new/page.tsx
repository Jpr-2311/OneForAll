import { notFound, redirect } from "next/navigation";
import { ConnectRepositoryForm } from "@/components/repositories/connect-repository-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardHeader } from "@/components/ui/card";
import { IconBranch } from "@/components/ui/icons";
import { PageBody, PageHeader } from "@/components/ui/page";
import { getProjectContext } from "@/server/requirements/queries";
import { createRepository } from "@/server/repositories/actions";
import { getMyRepository } from "@/server/repositories/queries";

export const metadata = { title: "Connect repository · OneForAll" };

export default async function ConnectRepositoryPage({
  params,
}: PageProps<"/organizations/[organizationId]/departments/[departmentId]/teams/[teamId]/projects/[projectId]/repository/new">) {
  const { organizationId, departmentId, teamId, projectId } = await params;
  const context = await getProjectContext(organizationId, departmentId, teamId, projectId);
  // Only OWNER/ADMIN may connect a repository, so everyone else gets the same 404 as an invalid path.
  // This is a UI gate only; RLS rejects the insert regardless.
  if (!context || !context.canManage) notFound();
  const { organization, department, team, project } = context;
  const projectPath = `/organizations/${organization.id}/departments/${department.id}/teams/${team.id}/projects/${project.id}`;

  // A project has at most one primary repository: disconnect it before connecting another.
  if (await getMyRepository(project.id)) redirect(projectPath);

  const teamsHref = `/organizations/${organization.id}/departments/${department.id}/teams`;

  return (
    <PageBody width="form">
      <PageHeader
        crumbs={[
          { label: department.name, href: teamsHref },
          { label: team.name, href: `${teamsHref}/${team.id}/projects` },
          { label: project.name, href: projectPath },
          { label: "Connect repository" },
        ]}
        title="Connect a repository"
        description="Record the primary repository for this project."
      />
      <div className="flex flex-col gap-4">
        <Alert tone="info" title="Metadata only">
          This only records the repository details. Nothing is cloned or analysed, and no credentials are needed or stored.
          Never put a token in the URL.
        </Alert>
        <Card>
          <CardHeader icon={<IconBranch size={16} />} title="Repository details" description={`For ${project.name}`} />
          <div className="px-5 py-5">
            {/* Bound here, in the Server Component. Never `.bind()` inside the Client Component. */}
            <ConnectRepositoryForm
              action={createRepository.bind(null, organization.id, department.id, team.id, project.id)}
              cancelHref={projectPath}
            />
          </div>
        </Card>
      </div>
    </PageBody>
  );
}
