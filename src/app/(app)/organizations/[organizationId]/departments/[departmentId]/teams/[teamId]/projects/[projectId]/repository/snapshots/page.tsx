import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepositoryContext, listSnapshots } from "@/server/repository-snapshots/queries";
import { STATUS_LABELS } from "@/server/repository-snapshots/schema";

export const metadata = { title: "Snapshots · OneForAll" };

function formatDate(iso: string) {
  return iso.replace("T", " ").slice(0, 16) + " UTC";
}

export default async function SnapshotsPage({
  params,
}: PageProps<"/organizations/[organizationId]/departments/[departmentId]/teams/[teamId]/projects/[projectId]/repository/snapshots">) {
  const { organizationId, departmentId, teamId, projectId } = await params;
  const context = await getRepositoryContext(organizationId, departmentId, teamId, projectId);
  // 404 for malformed, mismatched, cross-tenant, not-permitted or repository-less paths alike (no existence leak).
  if (!context) notFound();
  const { organization, department, team, project, repository, canManage } = context;

  const snapshots = await listSnapshots(repository.id);
  const projectPath = `/organizations/${organization.id}/departments/${department.id}/teams/${team.id}/projects/${project.id}`;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={projectPath} className="text-sm underline">
          {project.name}
        </Link>
        <h1 className="text-2xl font-semibold">Snapshots</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          {repository.owner} / {repository.name}
        </p>
      </div>
      {/* UI hint only. The database enforces who may actually create snapshots. */}
      {canManage && (
        <Link href={`${projectPath}/repository/snapshots/new`} className="text-sm underline">
          Create snapshot
        </Link>
      )}
      {snapshots.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">No snapshots available.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {snapshots.map((snapshot) => (
            <li key={snapshot.id} className="flex flex-col gap-0.5 text-sm">
              <span className="font-mono">{snapshot.commit_sha}</span>
              <span className="text-black/60 dark:text-white/60">
                {snapshot.branch} · {(STATUS_LABELS as Record<string, string>)[snapshot.status] ?? snapshot.status} ·{" "}
                {formatDate(snapshot.created_at)} · {snapshot.fileCount} {snapshot.fileCount === 1 ? "file" : "files"} recorded
              </span>
              {snapshot.error_message && <span className="text-red-600 dark:text-red-400">{snapshot.error_message}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
