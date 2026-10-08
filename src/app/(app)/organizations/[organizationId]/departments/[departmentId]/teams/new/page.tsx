import { notFound } from "next/navigation";
import { CreateTeamForm } from "@/components/teams/create-team-form";
import { Card, CardHeader } from "@/components/ui/card";
import { IconUsers } from "@/components/ui/icons";
import { PageBody, PageHeader } from "@/components/ui/page";
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
  const deptsHref = `/organizations/${organization.id}/departments`;
  const teamsHref = `${deptsHref}/${department.id}/teams`;

  return (
    <PageBody width="form">
      <PageHeader
        crumbs={[
          { label: organization.name, href: deptsHref },
          { label: department.name, href: teamsHref },
          { label: "Teams", href: teamsHref },
          { label: "New" },
        ]}
        title="Create a team"
        description="Teams own projects, requirements and repositories."
      />
      <Card>
        <CardHeader icon={<IconUsers size={16} />} title="Team details" description={`In ${department.name}`} />
        <div className="px-5 py-5">
          {/* Bound here, in the Server Component. Never `.bind()` inside the Client Component. */}
          <CreateTeamForm action={createTeam.bind(null, organization.id, department.id)} cancelHref={teamsHref} />
        </div>
      </Card>
    </PageBody>
  );
}
