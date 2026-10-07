import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { idSchema } from "@/server/departments/schema";
import { listDepartments } from "@/server/departments/queries";
import { getMyOrganization } from "@/server/organizations/queries";

export const metadata = { title: "Departments · OneForAll" };

const CAN_MANAGE = ["OWNER", "ADMIN"];

export default async function DepartmentsPage({ params }: PageProps<"/organizations/[organizationId]/departments">) {
  const { organizationId } = await params;
  if (!idSchema.safeParse(organizationId).success) notFound();

  const user = await requireUser();
  const organization = await getMyOrganization(organizationId, user.id);
  if (!organization) notFound();

  const departments = await listDepartments(organization.id);
  // UI hint only. The database enforces who may actually create departments.
  const canManage = CAN_MANAGE.includes(organization.role);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/organizations/new" className="text-sm underline">
          Organizations
        </Link>
        <h1 className="text-2xl font-semibold">{organization.name} · Departments</h1>
      </div>
      {canManage && (
        <Link href={`/organizations/${organization.id}/departments/new`} className="text-sm underline">
          New department
        </Link>
      )}
      {departments.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">No departments yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {departments.map((department) => (
            <li key={department.id} className="flex flex-col gap-0.5">
              <span className="font-medium">{department.name}</span>
              {department.description && (
                <span className="text-sm text-black/70 dark:text-white/70">{department.description}</span>
              )}
              <span className="text-sm text-black/60 dark:text-white/60">
                {department.memberCount} {department.memberCount === 1 ? "member" : "members"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
