import Link from "next/link";
import { notFound } from "next/navigation";
import { CreateTeamForm } from "@/components/teams/create-team-form";
import { requireUser } from "@/server/auth/session";
import { idSchema } from "@/server/departments/schema";
import { getMyOrganization } from "@/server/organizations/queries";
import { createTeam } from "@/server/teams/actions";
import { getMyDepartment } from "@/server/teams/queries";

export const metadata = { title: "New team · OneForAll" };

export default async function NewTeamPage({
  params,
}: PageProps<"/organizations/[organizationId]/departments/[departmentId]/teams/new">) {
  const { organizationId, departmentId } = await params;
  if (!idSchema.safeParse(organizationId).success || !idSchema.safeParse(departmentId).success) notFound();

  const user = await requireUser();
  const organization = await getMyOrganization(organizationId, user.id);
  if (!organization) notFound();
  const department = await getMyDepartment(organization.id, departmentId);
  if (!department) notFound();

  return (
    <div className="flex max-w-md flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/organizations/${organization.id}/departments/${department.id}/teams`}
          className="text-sm underline"
        >
          {department.name} · Teams
        </Link>
        <h1 className="text-2xl font-semibold">Create a team</h1>
      </div>
      {/* Bound here, in the Server Component. Never `.bind()` inside the Client Component. */}
      <CreateTeamForm action={createTeam.bind(null, organization.id, department.id)} />
    </div>
  );
}
