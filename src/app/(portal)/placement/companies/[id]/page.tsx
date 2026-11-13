import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { CompanyHistory } from "@/components/ui/company-history";
import { StatusBadge } from "@/components/ui/status-badge";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { getCompany } from "@/server/companies/queries";
import { drivesOfCompany } from "@/server/drives/queries";
import { DRIVE_STATUS_LABEL } from "@/lib/drives";
import { CompanyForm } from "../company-form";
import { StatusButton } from "./status-button";

export const metadata = { title: "Company — CampusConnect" };

export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const s = await requireRole("PLACEMENT_OFFICER");
  const { id } = await params;
  const { created } = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await getCompany(s, id);
  if (!data) notFound();
  const { company: c, events } = data;
  const drives = await drivesOfCompany(s, id);
  const active = c.status === "ACTIVE";
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/placement/companies" className="underline">← Companies</Link></p>
      {created ? <Alert kind="success">Company added.</Alert> : null}
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1><StatusBadge value={c.status} /></div>
      <Card title="Details">
        <CompanyForm id={c.id} initial={{ name: c.name, website: c.website ?? "", industry: c.industry ?? "", description: c.description ?? "", contactPerson: c.contact_person ?? "", contactEmail: c.contact_email ?? "", contactPhone: c.contact_phone ?? "", location: c.location ?? "" }} />
      </Card>
      <Card title="Status">
        <p className="mb-3 text-sm text-muted">{active ? "Deactivating keeps the company and its history but stops it being used for new placement drives. It can be reactivated." : "This company is inactive and cannot be used for new drives."}</p>
        <StatusButton id={c.id} active={active} />
      </Card>
      <Card title="Placement drives">
        {drives.length === 0 ? <p className="text-sm text-muted">No drives for this company yet.</p> : (
          <ul className="divide-y divide-border" aria-label="Company drives">{drives.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-3 py-2 text-sm"><Link href={`/placement/drives/${x.id}`} className="font-medium underline">{x.job_title}</Link><span className="text-muted">{DRIVE_STATUS_LABEL[x.status]}</span></li>)}</ul>
        )}
        {c.status === "ACTIVE" ? <p className="mt-3 text-sm"><Link href={`/placement/drives/new?company=${id}`} className="underline">Create a drive for this company</Link></p> : <p className="mt-3 text-xs text-muted">Reactivate this company to create new drives.</p>}
      </Card>
      <Card title="History"><CompanyHistory events={events} /></Card>
    </div>
  );
}
