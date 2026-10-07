import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { idSchema } from "@/server/departments/schema";
import { getMyOrganization } from "@/server/organizations/queries";
import { getMyDepartment, listTeams } from "@/server/teams/queries";

export const metadata = { title: "Teams · OneForAll" };

const CAN_MANAGE = ["OWNER", "ADMIN"];

export default async function TeamsPage({
  params,
}: PageProps<"/organizations/[organizationId]/departments/[departmentId]/teams">) {
  const { organizationId, departmentId } = await params;
  if (!idSchema.safeParse(organizationId).success || !idSchema.safeParse(departmentId).success) notFound();

  const user = await requireUser();
  const organization = await getMyOrganization(organizationId, user.id);
  if (!organization) notFound();
  // Also proves the department belongs to this organization, not just to some tenant the caller can see.
  const department = await getMyDepartment(organization.id, departmentId);
  if (!department) notFound();

  const teams = await listTeams(department.id);
  // UI hint only. The database enforces who may actually create teams.
  const canManage = CAN_MANAGE.includes(organization.role);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/organizations/${organization.id}/departments`} className="text-sm underline">
          {organization.name} · Departments
        </Link>
        <h1 className="text-2xl font-semibold">{department.name} · Teams</h1>
      </div>
      {canManage && (
        <Link
          href={`/organizations/${organization.id}/departments/${department.id}/teams/new`}
          className="text-sm underline"
        >
          New team
        </Link>
      )}
      {teams.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">No teams yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {teams.map((team) => (
            <li key={team.id} className="flex flex-col gap-0.5">
              <span className="font-medium">{team.name}</span>
              {team.description && <span className="text-sm text-black/70 dark:text-white/70">{team.description}</span>}
              <span className="text-sm text-black/60 dark:text-white/60">
                {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
