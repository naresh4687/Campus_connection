import Link from "next/link";
import { Card } from "@/components/ui/card";
import { humanize } from "@/components/ui/status-badge";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { overview } from "@/server/platform/queries";

export const metadata = { title: "Platform overview — CampusConnect" };

function Stat({ label, value, href, hint }: { label: string; value: number; href?: string; hint?: string }) {
  const body = (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums" data-testid={`stat-${label}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

export default async function PlatformOverview() {
  const s = await requireRole("PLATFORM_SUPER_ADMIN");
  const o = await overview(s);
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Platform overview</h1>

      <section aria-labelledby="apps" className="space-y-3">
        <h2 id="apps" className="text-lg font-semibold">College applications</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Awaiting review" value={o.apps.submitted} href="/platform/applications?status=SUBMITTED" />
          <Stat label="Under review" value={o.apps.under_review} href="/platform/applications?status=UNDER_REVIEW" />
          <Stat label="Approved" value={o.apps.approved} href="/platform/applications?status=APPROVED" />
          <Stat label="Rejected" value={o.apps.rejected} href="/platform/applications?status=REJECTED" />
        </div>
      </section>

      <section aria-labelledby="cols" className="space-y-3">
        <h2 id="cols" className="text-lg font-semibold">Colleges</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Colleges" value={o.cols.total} href="/platform/colleges" />
          <Stat label="Access active" value={o.cols.active} href="/platform/colleges?access=ACTIVE" />
          <Stat label="Access suspended" value={o.cols.suspended} href="/platform/colleges?access=SUSPENDED" />
          <Stat label="Without an administrator" value={o.collegesWithoutAdmin} hint="Active colleges whose administrator has not accepted an invitation" />
        </div>
        <Card title="Commercial status (manual record)">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-5">
            {([["NOT_STARTED", o.cols.not_started], ["PENDING", o.cols.pending], ["ACTIVE", o.cols.commercial_active], ["EXPIRED", o.cols.expired], ["SUSPENDED", o.cols.commercial_suspended]] as const).map(([k, n]) => (
              <div key={k}><dt className="text-muted">{humanize(k)}</dt><dd className="text-lg font-semibold tabular-nums">{n}</dd></div>
            ))}
          </dl>
        </Card>
      </section>

      <section aria-labelledby="inbox" className="grid gap-4 sm:grid-cols-2">
        <h2 id="inbox" className="sr-only">Inbox and activity</h2>
        <Stat label="New inquiries" value={o.newInquiries} href="/platform/inquiries?status=NEW" />
        <Card title="Recent platform activity">
          {o.recent.length === 0 ? <p className="text-sm text-muted">No activity yet.</p> : (
            <ul className="space-y-1 text-sm">
              {o.recent.map((r) => <li key={r.id}><span className="font-medium">{humanize(r.action)}</span> <span className="text-muted">· {r.actor_email ?? "public"} · {fmtDateTime(r.occurred_at)}</span></li>)}
            </ul>
          )}
          <p className="mt-3 text-sm"><Link href="/platform/audit" className="underline">Full audit log</Link></p>
        </Card>
      </section>
      <p className="text-xs text-muted">Figures are live counts from the database. Student-level data is never shown here.</p>
    </div>
  );
}
