import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkItemForm } from "@/components/work-items/work-item-form";
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

  return (
    <div className="flex max-w-md flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/organizations/${organization.id}/departments/${department.id}/teams/${team.id}/projects/${project.id}/requirements`}
          className="text-sm underline"
        >
          {project.name} · Requirements
        </Link>
        <h1 className="text-2xl font-semibold">New requirement</h1>
        <p className="text-sm text-black/60 dark:text-white/60">New requirements start as a draft.</p>
      </div>
      {/* Bound here, in the Server Component. Never `.bind()` inside the Client Component. */}
      <WorkItemForm
        action={createRequirement.bind(null, organization.id, department.id, team.id, project.id)}
        submitLabel="Create requirement"
      />
    </div>
  );
}
