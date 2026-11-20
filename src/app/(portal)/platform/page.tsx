import { Columns, Donut } from "@/components/charts/charts";
import { DashCard, Gauge, MiniStat, Pill } from "@/components/dashboard/kit";
import { PageHeader, PanelLink } from "@/components/ui/metrics";
import { NextSteps } from "@/components/ui/next-steps";
import { humanize } from "@/components/ui/status-badge";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { overview } from "@/server/platform/queries";

export const metadata = { title: "Platform overview — CampusConnect" };

export default async function PlatformOverview() {
  const s = await requireRole("PLATFORM_SUPER_ADMIN");
  const o = await overview(s);
  const todo = [
    ...(o.apps.submitted > 0 ? [{ text: `${o.apps.submitted} college application${o.apps.submitted === 1 ? "" : "s"} awaiting review.`, href: "/platform/applications?status=SUBMITTED" }] : []),
    ...(o.newInquiries > 0 ? [{ text: `${o.newInquiries} new inquir${o.newInquiries === 1 ? "y" : "ies"} from the contact form.`, href: "/platform/inquiries?status=NEW" }] : []),
  ];
  const decided = o.apps.approved + o.apps.rejected; const total = decided + o.apps.submitted + o.apps.under_review;
  const today = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  return (
    <div className="space-y-6">
      <PageHeader title="Platform overview" description="Colleges, applications and platform activity." actions={<><Pill>{today}</Pill><Pill href="/platform/applications">Applications</Pill></>} />
      <NextSteps items={todo} />

      <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 @3xl:grid-cols-2">
            <DashCard title="College applications" icon="file" id="apps" action={<PanelLink href="/platform/applications">All</PanelLink>}>
              <Donut ids title="Applications by status" unit="applications" slices={[
                { label: "Awaiting review", value: o.apps.submitted, tone: "amber" }, { label: "Under review", value: o.apps.under_review, tone: "grey" },
                { label: "Approved", value: o.apps.approved, tone: "ink" }, { label: "Rejected", value: o.apps.rejected, tone: "red" }]} />
            </DashCard>
            <DashCard title="College access" icon="building" id="cols" action={<PanelLink href="/platform/colleges">All colleges</PanelLink>}>
              <Donut ids title="Access to the platform" unit="colleges" slices={[{ label: "Access active", value: o.cols.active, tone: "ink" }, { label: "Access suspended", value: o.cols.suspended, tone: "red" }]} />
            </DashCard>
          </div>
          <DashCard title="Commercial status (manual record)" icon="chart" id="comm">
            <Columns title="Colleges by commercial status" items={[{ label: "Not started", value: o.cols.not_started }, { label: "Pending", value: o.cols.pending }, { label: "Active", value: o.cols.commercial_active }, { label: "Expired", value: o.cols.expired }, { label: "Suspended", value: o.cols.commercial_suspended }]} />
          </DashCard>
        </div>
        <div className="min-w-0 space-y-6">
          <DashCard title="Platform summary" icon="chart" id="over">
            <Gauge title="Applications decided" value={decided} of={total} caption="of all applications" link={<PanelLink href="/platform/applications">Open</PanelLink>} />
            <div className="mt-4 grid grid-cols-3 gap-2.5">
              <MiniStat icon="building" label="Colleges" value={o.cols.total} href="/platform/colleges" />
              <MiniStat icon="alert" label="No administrator" value={o.collegesWithoutAdmin} />
              <MiniStat icon="bell" label="New inquiries" value={o.newInquiries} href="/platform/inquiries?status=NEW" />
            </div>
          </DashCard>
          <DashCard title="Inbox" icon="bell" id="inbox" action={<PanelLink href="/platform/inquiries">All inquiries</PanelLink>}>
            <p className="text-sm text-muted">{o.newInquiries === 0 ? "No new inquiries." : `${o.newInquiries} new inquir${o.newInquiries === 1 ? "y" : "ies"} to answer.`}</p>
          </DashCard>
        </div>
      </div>

      <DashCard title="Recent platform activity" icon="list" id="act" action={<PanelLink href="/platform/audit">Full audit log</PanelLink>}>
        {o.recent.length === 0 ? <p className="text-sm text-muted">No activity yet.</p> : (
          <ul className="divide-y divide-border text-sm">
            {o.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 first:pt-0 last:pb-0">
                <span className="font-medium">{humanize(r.action)}</span>
                <span className="text-muted">{r.actor_email ?? "public"}, {fmtDateTime(r.occurred_at)}</span>
              </li>))}
          </ul>)}
      </DashCard>
      <p className="text-xs text-muted">Figures are live counts from the database. Student-level data is never shown here.</p>
    </div>
  );
}
