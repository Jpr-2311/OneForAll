import Link from "next/link";
import { CreateOrganizationForm } from "@/components/organizations/create-organization-form";
import { Card, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/data";
import { IconArrowRight, IconBuilding } from "@/components/ui/icons";
import { PageBody, PageHeader } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { listMyWorkspaces } from "@/lib/workspaces";
import { requireUser } from "@/server/auth/session";

export const metadata = { title: "New organization · OneForAll" };

export default async function NewOrganizationPage() {
  const user = await requireUser();
  const organizations = await listMyWorkspaces(user.id);

  return (
    <PageBody>
      <PageHeader
        crumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Organizations" }]}
        icon={<IconBuilding size={18} />}
        title="Organizations"
        description="Switch between workspaces or create a new one for your company."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <section aria-labelledby="your-orgs">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="your-orgs" className="t-h2 text-fg">
              Your organizations
            </h2>
            <span className="t-small text-fg-3">{organizations.length} total</span>
          </div>
          {organizations.length === 0 ? (
            <Card className="flex flex-col items-center px-6 py-12 text-center">
              <span className="inline-flex size-11 items-center justify-center rounded-xl border border-border-strong bg-surface-2 text-fg-2">
                <IconBuilding size={20} />
              </span>
              <p className="t-h2 mt-4 text-fg">No organizations yet</p>
              <p className="t-small mt-1 max-w-xs text-fg-3">Create your first organization with the form. You’ll become its owner.</p>
            </Card>
          ) : (
            <Card className="divide-y divide-border overflow-hidden">
              {organizations.map((org) => (
                <CardLinkRow key={org.id} id={org.id} name={org.name} slug={org.slug} role={org.role} />
              ))}
            </Card>
          )}
        </section>
        <Card className="h-fit">
          <CardHeader icon={<IconBuilding size={16} />} title="Create an organization" description="A workspace for your company’s departments, teams and projects." />
          <div className="px-5 py-5">
            <CreateOrganizationForm />
          </div>
        </Card>
      </div>
    </PageBody>
  );
}

function CardLinkRow({ id, name, slug, role }: { id: string; name: string; slug: string; role: string }) {
  return (
    <Link
      href={`/organizations/${id}/departments`}
      className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2"
    >
      <Avatar name={name} square />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-fg">{name}</p>
        <p className="truncate font-mono text-[12px] text-fg-3">{slug}</p>
      </div>
      <StatusBadge kind="role" value={role} />
      <IconArrowRight size={14} className="text-fg-3 transition-colors group-hover:text-accent" />
    </Link>
  );
}
