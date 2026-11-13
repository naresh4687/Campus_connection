import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { CompanyHistory } from "@/components/ui/company-history";
import { CompanyView } from "@/components/ui/company-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { getCompany } from "@/server/companies/queries";
import { drivesOfCompany } from "@/server/drives/queries";
import { DRIVE_STATUS_LABEL } from "@/lib/drives";

export const metadata = { title: "Company — CampusConnect" };

export default async function AdminCompany({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRole("COLLEGE_ADMIN");
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await getCompany(s, id);
  if (!data) notFound();
  const drives = await drivesOfCompany(s, id);
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/college/companies" className="underline">← Companies</Link></p>
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{data.company.name}</h1><StatusBadge value={data.company.status} /></div>
      <Card title="Details"><CompanyView c={data.company} /></Card>
      <Card title="Placement drives">
        {drives.length === 0 ? <p className="text-sm text-muted">No drives for this company yet.</p> : (
          <ul className="divide-y divide-border" aria-label="Company drives">{drives.map((x) => <li key={x.id} className="flex flex-wrap items-center gap-3 py-2 text-sm"><Link href={`/college/drives/${x.id}`} className="font-medium underline">{x.job_title}</Link><span className="text-muted">{DRIVE_STATUS_LABEL[x.status]}</span></li>)}</ul>
        )}
      </Card>
      <Card title="History"><CompanyHistory events={data.events} /></Card>
    </div>
  );
}
