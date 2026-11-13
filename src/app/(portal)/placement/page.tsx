import Link from "next/link";
import { Card } from "@/components/ui/card";
import { NextSteps } from "@/components/ui/next-steps";
import { fmtDate } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { companyStats } from "@/server/companies/queries";
import { StatTile } from "@/components/ui/stat";
import { FunnelView } from "@/components/offers/funnel";
import { closingSoon, driveStats } from "@/server/drives/queries";
import { funnel, listPlacements, unissuedCount } from "@/server/offers/queries";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Placement overview — CampusConnect" };

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="block rounded-2xl border border-border bg-surface p-4 hover:opacity-90"><p className="text-sm text-muted">{label}</p><p className="mt-1 text-3xl font-semibold tabular-nums" data-testid={`stat-${label}`}>{value}</p></Link>
  );
}

export default async function PlacementHome() {
  const s = await requireRole("PLACEMENT_OFFICER");
  const [c, ds, soon, f, pending, unissued] = await Promise.all([companyStats(s), driveStats(s), closingSoon(s), funnel(s), listPlacements(s, "PENDING_VERIFICATION"), unissuedCount(s)]);
  const todo: { text: string; href: string }[] = [];
  if (pending.length > 0) todo.push({ text: `${pending.length} joining record(s) are waiting for your verification.`, href: "/placement/placements" });
  if (unissued > 0) todo.push({ text: `${unissued} selected student(s) have no offer issued yet.`, href: "/placement/drives?status=CLOSED" });
  for (const d of soon) todo.push({ text: `“${d.job_title}” (${d.company_name}) closes for registration ${fmtDateTime(d.application_deadline)}.`, href: `/placement/drives/${d.id}` });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Placement overview</h1>
      <NextSteps items={todo} />
      <section aria-labelledby="dr" className="space-y-3">
        <h2 id="dr" className="text-lg font-semibold">Drives</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Draft drives" value={ds.draft} href="/placement/drives?status=DRAFT" />
          <StatTile label="Published drives" value={ds.published} href="/placement/drives?status=PUBLISHED" />
          <StatTile label="Closed drives" value={ds.closed} href="/placement/drives?status=CLOSED" />
          <StatTile label="Archived drives" value={ds.archived} href="/placement/drives?status=ARCHIVED" />
        </div>
      </section>
      <Card title="Placement funnel"><FunnelView f={f} /><p className="mt-2 text-xs text-muted">Only verified placements count as placements. <Link href="/placement/placements" className="underline">Open placements</Link>.</p></Card>
      <section aria-labelledby="co" className="space-y-3">
        <h2 id="co" className="text-lg font-semibold">Companies</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Companies" value={c.total} href="/placement/companies" />
          <Stat label="Active companies" value={c.active} href="/placement/companies?status=ACTIVE" />
          <Stat label="Inactive companies" value={c.inactive} href="/placement/companies?status=INACTIVE" />
        </div>
      </section>
      <Card title="Recently updated">
        {c.recent.length === 0 ? <p className="text-sm text-muted">No companies yet. <Link href="/placement/companies/new" className="underline">Add your first company</Link>.</p> : (
          <ul className="space-y-1 text-sm">{c.recent.map((r) => <li key={r.id}><Link href={`/placement/companies/${r.id}`} className="underline">{r.name}</Link> <span className="text-muted">· {fmtDate(r.updated_at)}</span></li>)}</ul>
        )}
      </Card>
    </div>
  );
}
