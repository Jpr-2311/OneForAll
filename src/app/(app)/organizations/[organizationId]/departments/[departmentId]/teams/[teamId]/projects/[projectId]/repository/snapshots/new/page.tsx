import Link from "next/link";
import { notFound } from "next/navigation";
import { CreateSnapshotForm } from "@/components/repository-snapshots/create-snapshot-form";
import { createSnapshot } from "@/server/repository-snapshots/actions";
import { getRepositoryContext } from "@/server/repository-snapshots/queries";

export const metadata = { title: "Create snapshot · OneForAll" };

export default async function NewSnapshotPage({
  params,
}: PageProps<"/organizations/[organizationId]/departments/[departmentId]/teams/[teamId]/projects/[projectId]/repository/snapshots/new">) {
  const { organizationId, departmentId, teamId, projectId } = await params;
  const context = await getRepositoryContext(organizationId, departmentId, teamId, projectId);
  // Only OWNER/ADMIN may create snapshots, so everyone else gets the same 404 as an invalid path.
  // This is a UI gate only; RLS rejects the insert regardless.
  if (!context || !context.canManage) notFound();
  const { organization, department, team, project } = context;

  return (
    <div className="flex max-w-md flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/organizations/${organization.id}/departments/${department.id}/teams/${team.id}/projects/${project.id}/repository/snapshots`}
          className="text-sm underline"
        >
          Snapshots
        </Link>
        <h1 className="text-2xl font-semibold">Create a snapshot</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          This records a snapshot of the repository at a commit. It starts as pending; nothing is cloned or
          analysed yet.
        </p>
      </div>
      {/* Bound here, in the Server Component. Never `.bind()` inside the Client Component. */}
      <CreateSnapshotForm action={createSnapshot.bind(null, organization.id, department.id, team.id, project.id)} />
    </div>
  );
}
