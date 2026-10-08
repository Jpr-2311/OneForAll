import { notFound } from "next/navigation";
import { CreateDepartmentForm } from "@/components/departments/create-department-form";
import { Card, CardHeader } from "@/components/ui/card";
import { IconLayers } from "@/components/ui/icons";
import { PageBody, PageHeader } from "@/components/ui/page";
import { requireUser } from "@/server/auth/session";
import { createDepartment } from "@/server/departments/actions";
import { idSchema } from "@/server/departments/schema";
import { getMyOrganization } from "@/server/organizations/queries";

export const metadata = { title: "New department · OneForAll" };

export default async function NewDepartmentPage({
  params,
}: PageProps<"/organizations/[organizationId]/departments/new">) {
  const { organizationId } = await params;
  if (!idSchema.safeParse(organizationId).success) notFound();

  const user = await requireUser();
  const organization = await getMyOrganization(organizationId, user.id);
  if (!organization) notFound();
  const listHref = `/organizations/${organization.id}/departments`;

  return (
    <PageBody width="form">
      <PageHeader
        crumbs={[
          { label: "Organizations", href: "/organizations/new" },
          { label: organization.name, href: listHref },
          { label: "Departments", href: listHref },
          { label: "New" },
        ]}
        title="Create a department"
        description="Departments group teams by area of ownership."
      />
      <Card>
        <CardHeader icon={<IconLayers size={16} />} title="Department details" description={`In ${organization.name}`} />
        <div className="px-5 py-5">
          <CreateDepartmentForm action={createDepartment.bind(null, organization.id)} cancelHref={listHref} />
        </div>
      </Card>
    </PageBody>
  );
}
