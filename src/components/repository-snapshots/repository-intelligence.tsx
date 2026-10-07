import Link from "next/link";
import { listSnapshots } from "@/server/repository-snapshots/queries";
import { STATUS_LABELS } from "@/server/repository-snapshots/schema";

type Props = {
  repositoryId: string;
  repositoryPath: string; // .../projects/[projectId]/repository
  canManage: boolean;
};

const PREVIEW_COUNT = 5;

function formatDate(iso: string) {
  return iso.replace("T", " ").slice(0, 16) + " UTC";
}

function statusLabel(status: string) {
  return (STATUS_LABELS as Record<string, string>)[status] ?? status;
}

// Metadata only: commit, branch, status and date. No file tree, no code, no search, no analysis.
// RLS limits what listSnapshots returns to the snapshots this user may see.
export async function RepositoryIntelligence({ repositoryId, repositoryPath, canManage }: Props) {
  const snapshots = await listSnapshots(repositoryId);
  const latest = snapshots[0];

  return (
    <section className="flex flex-col gap-3 border-t border-black/10 pt-4 dark:border-white/15">
      <h2 className="text-lg font-medium">Repository Intelligence</h2>
      {!latest ? (
        <p className="text-sm text-black/60 dark:text-white/60">No snapshots available.</p>
      ) : (
        <>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt className="text-black/60 dark:text-white/60">Latest snapshot</dt>
            <dd className="font-mono">{latest.commit_sha}</dd>
            <dt className="text-black/60 dark:text-white/60">Branch</dt>
            <dd>{latest.branch}</dd>
            <dt className="text-black/60 dark:text-white/60">Status</dt>
            <dd>{statusLabel(latest.status)}</dd>
            <dt className="text-black/60 dark:text-white/60">Created</dt>
            <dd>{formatDate(latest.created_at)}</dd>
            <dt className="text-black/60 dark:text-white/60">Files recorded</dt>
            <dd>{latest.fileCount}</dd>
          </dl>
          <ul className="flex flex-col gap-1 text-sm">
            {snapshots.slice(0, PREVIEW_COUNT).map((snapshot) => (
              <li key={snapshot.id}>
                <span className="font-mono">{snapshot.commit_sha.slice(0, 12)}</span> · {snapshot.branch} ·{" "}
                {statusLabel(snapshot.status)} · {formatDate(snapshot.created_at)}
              </li>
            ))}
          </ul>
        </>
      )}
      {/* UI hint only. The database enforces who may actually create snapshots. */}
      {canManage && (
        <Link href={`${repositoryPath}/snapshots/new`} className="text-sm underline">
          Create snapshot
        </Link>
      )}
      {latest && (
        <Link href={`${repositoryPath}/snapshots`} className="text-sm underline">
          {snapshots.length > PREVIEW_COUNT ? `View all ${snapshots.length} snapshots` : "Snapshot list"}
        </Link>
      )}
    </section>
  );
}
