import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { FunnelView } from "@/components/offers/funnel";
import { PlacementList } from "@/components/offers/placement-list";
import { requireRole } from "@/server/auth/session";
import { funnel, listPlacements } from "@/server/offers/queries";
import { listDrives } from "@/server/drives/queries";
import { ManualPlacementList } from "@/components/placements/manual-placement-list";
import { manualPlacements } from "@/server/manual-placements/queries";
import { ReviewPlacementButtons } from "./review-buttons";
import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { DRIVE_STATUS_LABEL } from "@/lib/drives";

export const metadata = { title: "Placements — CampusConnect" };
const NOTICE: Record<string, string> = { verified: "Placement verified. It now counts as a placement.", rejected: "Joining record not verified. The student can see your reason and submit a correction." };

export default async function Placements({ searchParams }: { searchParams: Promise<{ notice?: string; reviewed?: string }> }) {
  const s = await requireRole("PLACEMENT_OFFICER");
  const { notice, reviewed } = await searchParams;
  const recorded = await manualPlacements(s, null);
  const [f, pending, verified, rejected, published, closed] = await Promise.all([funnel(s), listPlacements(s, "PENDING_VERIFICATION"), listPlacements(s, "VERIFIED"), listPlacements(s, "REJECTED"), listDrives(s, { status: "PUBLISHED", page: 1 }), listDrives(s, { status: "CLOSED", page: 1 })]);
  const drives = [...published.rows, ...closed.rows];
  return (
    <div className="space-y-6">
      {notice && NOTICE[notice] ? <Alert kind="success">{NOTICE[notice]}</Alert> : null}
      <h1 className="text-2xl font-semibold tracking-tight">Placements</h1>
      <Card title="Funnel"><FunnelView f={f} role="OFFICER" /><p className="mt-2 text-xs text-muted">Only verified placements count as placements. Accepted offers and recorded joinings are shown separately.</p></Card>
      <section id="manage-offers" className="scroll-mt-6"><Card title="Manage selections and offers">
        <p className="mb-3 text-sm text-muted">Pick a drive. On its page you select students from the final round, issue each offer with a letter and a response deadline, and record joining once the student has accepted.</p>
        {drives.length === 0 ? <p className="text-sm text-muted">No published or closed drives yet. Publish a drive and run its rounds first.</p> : (
          <ul className="divide-y divide-border" aria-label="Drives you can select from">
            {drives.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span><span className="font-medium">{d.job_title}</span> <span className="text-muted">· {d.company_name}</span> <StatusBadge value={d.status === "PUBLISHED" ? "APPROVED" : "NOT_STARTED"} label={DRIVE_STATUS_LABEL[d.status]} /></span>
                <span className="flex flex-wrap gap-3 text-sm"><Link className="rounded-full bg-primary px-4 py-1.5 font-semibold text-primary-foreground" href={`/placement/drives/${d.id}/offers`}>Selections and offers</Link></span>
              </li>))}
          </ul>)}
      </Card></section>
      {reviewed ? <Alert kind="success">{reviewed === "verified" ? "Placement verified." : "Placement rejected. The coordinator was told why."}</Alert> : null}
      <section id="coordinator-placements" className="scroll-mt-6"><Card title={`Placements recorded by coordinators (${recorded.filter((r) => r.status === "PENDING_VERIFICATION").length} waiting)`}>
        <ManualPlacementList rows={recorded} actions={(r) => (r.status === "PENDING_VERIFICATION" ? <ReviewPlacementButtons id={r.id} /> : null)} />
      </Card></section>
      <section id="awaiting-verification" className="scroll-mt-6"><Card title={`Awaiting verification (${pending.length})`}><PlacementList rows={pending} mode="officer" /></Card></section>
      <Card title={`Verified placements (${verified.length})`}><PlacementList rows={verified} mode="officer" /></Card>
      <Card title={`Not verified (${rejected.length})`}><PlacementList rows={rejected} mode="officer" /></Card>
    </div>
  );
}
