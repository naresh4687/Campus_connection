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
import { ManualPlacementList } from "@/components/placements/manual-placement-list";
import { OfferRowActions } from "@/components/placements/offer-row-actions";
import { RecordOfferForm } from "@/components/placements/record-offer-form";
import { manualPlacements, recordableStudents } from "@/server/manual-placements/queries";

export const metadata = { title: "Company — CampusConnect" };

export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; recorded?: string; updated?: string }> }) {
  const s = await requireRole("PLACEMENT_OFFICER");
  const { id } = await params;
  const { created, recorded, updated } = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await getCompany(s, id);
  if (!data) notFound();
  const { company: c, events } = data;
  const drives = await drivesOfCompany(s, id);
  const active = c.status === "ACTIVE";
  const [students, offers] = await Promise.all([active ? recordableStudents(s) : Promise.resolve([]), manualPlacements(s, id)]);
  const live = offers.filter((o) => o.status !== "REJECTED"); const accepted = live.filter((o) => o.offer_status === "ACCEPTED");
  const ctcs = live.map((o) => Number(o.ctc_lpa));
  const UPDATED: Record<string, string> = { accepted: "Marked as accepted.", offered: "Marked as got offer (not accepted).", withdrawn: "Offer withdrawn." };
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/placement/companies" className="underline">← Companies</Link></p>
      {created ? <Alert kind="success">Company added.</Alert> : null}
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1><StatusBadge value={c.status} /></div>
      {recorded ? <Alert kind="success">Offer recorded.</Alert> : null}{updated && UPDATED[updated] ? <Alert kind="success">{UPDATED[updated]}</Alert> : null}
      <Card title="Student offers">
        <dl className="mb-5 grid grid-cols-2 gap-3 text-sm @3xl:grid-cols-4" aria-label="Offer summary">
          {([["Offers", live.length], ["Accepted", accepted.length], ["Highest LPA", ctcs.length ? Math.max(...ctcs).toFixed(2) : "–"], ["Average LPA", ctcs.length ? (ctcs.reduce((a, b) => a + b, 0) / ctcs.length).toFixed(2) : "–"]] as const).map(([k, v]) => (
            <div key={k} className="card p-3"><dt className="text-xs text-muted">{k}</dt><dd className="mt-1 text-xl font-bold tabular-nums" data-testid={`offer-${k}`}>{v}</dd></div>))}
        </dl>
        {active ? <RecordOfferForm company={id} students={students} officer /> : <p className="text-sm text-muted">Reactivate the company to add offers.</p>}
        <div className="mt-6"><ManualPlacementList rows={offers} showCompany={false} actions={(r) => (r.status === "REJECTED" ? null : <OfferRowActions id={r.id} company={id} offerStatus={r.offer_status} />)} /></div>
      </Card>
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
