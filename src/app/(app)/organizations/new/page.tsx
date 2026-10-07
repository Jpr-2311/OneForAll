import { CreateOrganizationForm } from "@/components/organizations/create-organization-form";
import { listMyOrganizations } from "@/server/organizations/queries";

export const metadata = { title: "New organization · OneForAll" };

export default async function NewOrganizationPage() {
  const organizations = await listMyOrganizations();

  return (
    <div className="flex max-w-md flex-col gap-8">
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Create an organization</h1>
        <CreateOrganizationForm />
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Your organizations</h2>
        {organizations.length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {organizations.map((org) => (
              <li key={org.id}>
                {org.name} <span className="text-black/60 dark:text-white/60">({org.role})</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
