import Link from "next/link";
import { Donut } from "@/components/charts/charts";
import { AttentionTiles, DashCard, Gauge, LineChart, MiniStat, Pill, Pipeline, PersonList, ProgressRows } from "@/components/dashboard/kit";
import { PageHeader, PanelLink } from "@/components/ui/metrics";
import { ButtonLink } from "@/components/ui/button";
import { NextSteps } from "@/components/ui/next-steps";
import { StatusBadge } from "@/components/ui/status-badge";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { companyStats } from "@/server/companies/queries";
import { closingSoon, driveStats, openDriveRegistrations } from "@/server/drives/queries";
import { funnel, listPlacements, unissuedCount } from "@/server/offers/queries";
import { recentRegistrations, registrationsPerDay } from "@/server/registrations/queries";

export const metadata = { title: "Placement overview — CampusConnect" };

export default async function PlacementHome() {
  const s = await requireRole("PLACEMENT_OFFICER");
  const [c, ds, soon, f, pending, unissued, open, perDay, recent] = await Promise.all([companyStats(s), driveStats(s), closingSoon(s), funnel(s), listPlacements(s, "PENDING_VERIFICATION"), unissuedCount(s), openDriveRegistrations(s), registrationsPerDay(s), recentRegistrations(s, 5)]);
  const todo: { text: string; href: string }[] = [];
  if (pending.length > 0) todo.push({ text: `${pending.length} joining record(s) are waiting for your verification.`, href: "/placement/placements" });
  if (unissued > 0) todo.push({ text: `${unissued} selected student(s) have no offer issued yet.`, href: "/placement/placements#manage-offers" });
  for (const d of soon) todo.push({ text: `“${d.job_title}” (${d.company_name}) closes for registration ${fmtDateTime(d.application_deadline)}.`, href: `/placement/drives/${d.id}/participation` });
  const today = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const registeredNow = open.reduce((a, d) => a + d.registered, 0);
  const now = new Date();
  const days = (iso: Date) => Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86400_000));
  return (
    <div className="space-y-6">
      <PageHeader title="Placement overview" description="Your college's drives, companies and placements." actions={<><Pill>{today}</Pill><ButtonLink href="/placement/companies/new" variant="secondary">Add company</ButtonLink><ButtonLink href="/placement/drives/new">New drive</ButtonLink></>} />
      <NextSteps items={todo} />

      <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-6">
          <DashCard title="Placement pipeline" icon="briefcase" id="pipe" action={<PanelLink href="/placement/placements">Open placements</PanelLink>}>
            <Pipeline ids label="Placement funnel" footnote="Only verified placements count as placements." stages={[
              { label: "Selected", value: f.selected, icon: "users" }, { label: "Offers issued", value: f.offers_issued, icon: "file" }, { label: "Offers accepted", value: f.offers_accepted, icon: "check" },
              { label: "Joining recorded", value: f.joining_recorded, icon: "building" }, { label: "Verified placements", value: f.placements_verified, icon: "shield" }]} />
          </DashCard>
          <DashCard title="Registrations for open drives" icon="calendar" id="regs" action={<PanelLink href="/placement/drives?status=PUBLISHED">Open drives</PanelLink>}>
            <ProgressRows title="Registered students against openings" rows={open.map((d) => ({ label: d.company_name, value: d.registered, of: d.openings ?? 0, href: `/placement/drives/${d.id}/participation`, note: d.started ? `${d.started} started` : undefined }))} empty="No drive is open for registration." />
            <p className="mt-3 text-xs text-muted">Registered students against each drive’s openings. Open a drive to see who has and has not registered, remind students and download the list.</p>
          </DashCard>
        </div>
        <div className="min-w-0 space-y-6">
          <DashCard title="Placement office" icon="chart" id="over">
            <Gauge title="Offers accepted" value={f.offers_accepted} of={f.offers_issued} caption="of offers issued" link={<PanelLink href="/placement/placements">Placements</PanelLink>} />
            <div className="mt-4 grid grid-cols-3 gap-2.5">
              <MiniStat icon="briefcase" label="Open drives" value={ds.published} href="/placement/drives?status=PUBLISHED" />
              <MiniStat icon="building" label="Companies" value={c.total} href="/placement/companies" />
              <MiniStat icon="users" label="Registered" value={registeredNow} hint="open drives" />
            </div>
          </DashCard>
          <DashCard title="Registrations" icon="calendar" id="trend"><LineChart title="Completed registrations, last 14 days" unit="registrations" points={perDay.map((p) => ({ label: p.day, value: p.n }))} empty="No registrations in the last 14 days." /></DashCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 @3xl:grid-cols-2 @6xl:grid-cols-4">
        <DashCard title="Drives" icon="briefcase" id="dr" action={<PanelLink href="/placement/drives">All</PanelLink>}>
          <Donut ids title="Drives by status" unit="drives" slices={[
            { label: "Published drives", value: ds.published, tone: "ink" }, { label: "Closed drives", value: ds.closed, tone: "grey" },
            { label: "Draft drives", value: ds.draft, tone: "amber" }, { label: "Archived drives", value: ds.archived, tone: "red" }]} />
        </DashCard>
        <DashCard title="Recent registrations" icon="users" id="recent">
          <PersonList empty="No registrations yet." rows={recent.map((r, i) => ({ key: `${i}-${r.name}`, name: r.name, sub: `${r.dept} · ${r.job}, ${r.company}`, meta: fmtDate(r.at),
            right: r.method === "EXTERNAL" ? <StatusBadge value={r.evidence_status === "VERIFIED" ? "APPROVED" : "PENDING"} label={r.evidence_status === "VERIFIED" ? "Verified" : "Evidence pending"} /> : <StatusBadge value="APPROVED" label="Registered" /> }))} />
        </DashCard>
        <DashCard title="Closing soon" icon="calendar" id="soon">
          <PersonList empty="No drive closes in the next 7 days." rows={soon.map((d) => ({ key: d.id, name: d.company_name, sub: d.job_title, meta: fmtDate(d.application_deadline), right: <StatusBadge value="PENDING" label={`${days(d.application_deadline)} day${days(d.application_deadline) === 1 ? "" : "s"} left`} /> }))} />
        </DashCard>
        <DashCard title="Needs attention" icon="alert" id="attn" tone="attention">
          <AttentionTiles items={[
            { label: "Joinings to verify", value: pending.length, href: "/placement/placements#awaiting-verification", icon: "shield" },
            { label: "Selected without an offer", value: unissued, href: "/placement/placements#manage-offers", icon: "file" }]} />
        </DashCard>
      </div>

      <DashCard title="Recently updated companies" icon="building" id="ru" action={<PanelLink href="/placement/companies">All companies ({c.total})</PanelLink>}>
        {c.recent.length === 0 ? <p className="text-sm text-muted">No companies yet. <PanelLink href="/placement/companies/new">Add your first company</PanelLink>.</p> : (
          <ul className="divide-y divide-border text-sm">
            {c.recent.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                <Link href={`/placement/companies/${r.id}`} className="font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">{r.name}</Link>
                <span className="shrink-0 text-muted">{fmtDate(r.updated_at)}</span>
              </li>))}
          </ul>)}
      </DashCard>
    </div>
  );
}
