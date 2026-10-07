import Link from "next/link";
import { notFound } from "next/navigation";
import { CreateDepartmentForm } from "@/components/departments/create-department-form";
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

  return (
    <div className="flex max-w-md flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/organizations/${organization.id}/departments`} className="text-sm underline">
          {organization.name} · Departments
        </Link>
        <h1 className="text-2xl font-semibold">Create a department</h1>
      </div>
      <CreateDepartmentForm action={createDepartment.bind(null, organization.id)} />
    </div>
  );
}
