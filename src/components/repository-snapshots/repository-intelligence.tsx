import Link from "next/link";
import { AnalyzeStructureForm } from "@/components/repository-structure/analyze-structure-form";
import { listSnapshots } from "@/server/repository-snapshots/queries";
import { STATUS_LABELS } from "@/server/repository-snapshots/schema";
import { analyzeStructure } from "@/server/repository-structure/actions";
import { getAnalysisForSnapshot } from "@/server/repository-structure/queries";
import { getAnalysisReadiness } from "@/server/repository-structure/readiness";
import { ANALYSIS_STATUS_LABELS } from "@/server/repository-structure/schema";

type Props = {
  organizationId: string;
  departmentId: string;
  teamId: string;
  projectId: string;
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

function analysisStatusLabel(status: string) {
  return (ANALYSIS_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

// Snapshot metadata plus the structure-analysis summary of the latest COMPLETED snapshot (counts only: no file
// tree, no code, no symbol browser). RLS limits what is returned to what this user may see.
export async function RepositoryIntelligence({
  organizationId,
  departmentId,
  teamId,
  projectId,
  repositoryId,
  repositoryPath,
  canManage,
}: Props) {
  const snapshots = await listSnapshots(repositoryId);
  const latest = snapshots[0];
  const analyzable = snapshots.find((snapshot) => snapshot.status === "COMPLETED");
  const analysis = analyzable ? await getAnalysisForSnapshot(analyzable.id) : null;
  // PENDING/FAILED analyses can be (re)run; PROCESSING and COMPLETED cannot.
  const canRun = canManage && analyzable && (!analysis || analysis.status === "PENDING" || analysis.status === "FAILED");
  // Never offer an action that is certain to fail (no repository source ingestion / persistence key yet).
  const readiness = getAnalysisReadiness();

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
      {analyzable && (
        <div className="flex flex-col gap-2 border-t border-black/10 pt-3 dark:border-white/15">
          <h3 className="text-base font-medium">Structure analysis</h3>
          <p className="text-sm text-black/60 dark:text-white/60">
            Snapshot <span className="font-mono">{analyzable.commit_sha.slice(0, 12)}</span>
          </p>
          {!analysis ? (
            <p className="text-sm text-black/60 dark:text-white/60">Not analysed yet.</p>
          ) : (
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
              <dt className="text-black/60 dark:text-white/60">Status</dt>
              <dd>{analysisStatusLabel(analysis.status)}</dd>
              {analysis.status === "COMPLETED" && (
                <>
                  <dt className="text-black/60 dark:text-white/60">Files analysed</dt>
                  <dd>
                    {analysis.files_analyzed} of {analysis.files_total}
                  </dd>
                  <dt className="text-black/60 dark:text-white/60">Unsupported</dt>
                  <dd>{analysis.files_unsupported}</dd>
                  <dt className="text-black/60 dark:text-white/60">Failed</dt>
                  <dd>{analysis.files_failed}</dd>
                  <dt className="text-black/60 dark:text-white/60">Symbols</dt>
                  <dd>{analysis.symbols_count}</dd>
                  <dt className="text-black/60 dark:text-white/60">Relationships</dt>
                  <dd>{analysis.relationships_count}</dd>
                </>
              )}
              {analysis.completed_at && (
                <>
                  <dt className="text-black/60 dark:text-white/60">Finished</dt>
                  <dd>{formatDate(analysis.completed_at)}</dd>
                </>
              )}
            </dl>
          )}
          {analysis?.status === "FAILED" && analysis.error_message && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {analysis.error_message}
            </p>
          )}
          {/* UI hint only. The database enforces who may actually run an analysis. */}
          {!readiness.ready && (!analysis || analysis.status === "PENDING" || analysis.status === "FAILED") && (
            <p className="text-sm text-black/60 dark:text-white/60">{readiness.message}</p>
          )}
          {canRun && readiness.ready && (
            <AnalyzeStructureForm
              action={analyzeStructure.bind(null, organizationId, departmentId, teamId, projectId, analyzable.id)}
              label={analysis?.status === "FAILED" ? "Retry Analysis" : "Analyze Structure"}
            />
          )}
        </div>
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
