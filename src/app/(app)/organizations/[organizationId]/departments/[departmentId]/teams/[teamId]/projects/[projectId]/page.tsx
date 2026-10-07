import Link from "next/link";
import { notFound } from "next/navigation";
import { idSchema } from "@/server/departments/schema";
import { DisconnectRepositoryForm } from "@/components/repositories/disconnect-repository-form";
import { RepositoryIntelligence } from "@/components/repository-snapshots/repository-intelligence";
import { getMyProject, getTeamContext } from "@/server/projects/queries";
import { disconnectRepository } from "@/server/repositories/actions";
import { getMyRepository } from "@/server/repositories/queries";
import { PROVIDER_LABELS, STATUS_LABELS, VISIBILITY_LABELS } from "@/server/repositories/schema";

export const metadata = { title: "Project · OneForAll" };

// Labels for values read from the database; falls back to the raw value for anything unexpected.
function label(labels: Record<string, string>, value: string) {
  return labels[value] ?? value;
}

export default async function ProjectPage({
  params,
}: PageProps<"/organizations/[organizationId]/departments/[departmentId]/teams/[teamId]/projects/[projectId]">) {
  const { organizationId, departmentId, teamId, projectId } = await params;
  if (!idSchema.safeParse(projectId).success) notFound();

  const context = await getTeamContext(organizationId, departmentId, teamId);
  if (!context || !context.canView) notFound();
  const { organization, department, team, canManage } = context;

  // Scoped to this team and RLS-filtered: a project from another team or tenant is simply not found.
  const project = await getMyProject(team.id, projectId);
  if (!project) notFound();

  // RLS returns the repository only when this project is visible to the caller.
  const repository = await getMyRepository(project.id);

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link
          href={`/organizations/${organization.id}/departments/${department.id}/teams/${team.id}/projects`}
          className="text-sm underline"
        >
          {team.name} · Projects
        </Link>
        <h1 className="text-2xl font-semibold">{project.name}</h1>
      </div>
      {project.description && <p className="text-sm">{project.description}</p>}
      <dl className="grid grid-cols-[6rem_1fr] gap-y-1 text-sm">
        <dt className="text-black/60 dark:text-white/60">Type</dt>
        <dd>{project.project_type}</dd>
        <dt className="text-black/60 dark:text-white/60">Status</dt>
        <dd>{project.status}</dd>
        <dt className="text-black/60 dark:text-white/60">Team</dt>
        <dd>{team.name}</dd>
      </dl>
      <Link
        href={`/organizations/${organization.id}/departments/${department.id}/teams/${team.id}/projects/${project.id}/requirements`}
        className="text-sm underline"
      >
        Requirements
      </Link>

      <section className="flex flex-col gap-3 border-t border-black/10 pt-4 dark:border-white/15">
        <h2 className="text-lg font-medium">Repository</h2>
        {repository ? (
          <>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
              <dt className="text-black/60 dark:text-white/60">Provider</dt>
              <dd>{label(PROVIDER_LABELS, repository.provider)}</dd>
              <dt className="text-black/60 dark:text-white/60">Repository</dt>
              <dd>
                {repository.owner} / {repository.name}
              </dd>
              <dt className="text-black/60 dark:text-white/60">URL</dt>
              <dd className="break-all">{repository.repository_url}</dd>
              <dt className="text-black/60 dark:text-white/60">Default branch</dt>
              <dd>{repository.default_branch}</dd>
              <dt className="text-black/60 dark:text-white/60">Visibility</dt>
              <dd>{label(VISIBILITY_LABELS, repository.visibility)}</dd>
              <dt className="text-black/60 dark:text-white/60">Status</dt>
              <dd>{label(STATUS_LABELS, repository.status)}</dd>
            </dl>
            {/* UI hint only. The database enforces who may actually disconnect. */}
            {canManage && (
              <DisconnectRepositoryForm
                action={disconnectRepository.bind(null, organization.id, department.id, team.id, project.id)}
              />
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-black/60 dark:text-white/60">No repository connected.</p>
            {canManage && (
              <Link
                href={`/organizations/${organization.id}/departments/${department.id}/teams/${team.id}/projects/${project.id}/repository/new`}
                className="text-sm underline"
              >
                Connect repository
              </Link>
            )}
          </>
        )}
      </section>

      {repository && (
        <RepositoryIntelligence
          repositoryId={repository.id}
          repositoryPath={`/organizations/${organization.id}/departments/${department.id}/teams/${team.id}/projects/${project.id}/repository`}
          canManage={canManage}
        />
      )}
    </div>
  );
}
