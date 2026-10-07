import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ConnectRepositoryForm } from "@/components/repositories/connect-repository-form";
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

  return (
    <div className="flex max-w-md flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={projectPath} className="text-sm underline">
          {project.name}
        </Link>
        <h1 className="text-2xl font-semibold">Connect a repository</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          This only records the repository details. Nothing is cloned or analysed, and no credentials are needed
          or stored. Never put a token in the URL.
        </p>
      </div>
      {/* Bound here, in the Server Component. Never `.bind()` inside the Client Component. */}
      <ConnectRepositoryForm action={createRepository.bind(null, organization.id, department.id, team.id, project.id)} />
    </div>
  );
}
