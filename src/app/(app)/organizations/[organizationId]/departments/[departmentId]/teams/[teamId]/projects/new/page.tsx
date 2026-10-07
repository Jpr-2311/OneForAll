import Link from "next/link";
import { notFound } from "next/navigation";
import { CreateProjectForm } from "@/components/projects/create-project-form";
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

  return (
    <div className="flex max-w-md flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/organizations/${organization.id}/departments/${department.id}/teams/${team.id}/projects`}
          className="text-sm underline"
        >
          {team.name} · Projects
        </Link>
        <h1 className="text-2xl font-semibold">Create a project</h1>
        <p className="text-sm text-black/60 dark:text-white/60">New projects start as a draft.</p>
      </div>
      {/* Bound here, in the Server Component. Never `.bind()` inside the Client Component. */}
      <CreateProjectForm action={createProject.bind(null, organization.id, department.id, team.id)} />
    </div>
  );
}
