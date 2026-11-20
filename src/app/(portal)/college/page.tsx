import { Donut } from "@/components/charts/charts";
import { AttentionTiles, DashCard, Gauge, LineChart, MiniStat, Pill, Pipeline, ProgressRows } from "@/components/dashboard/kit";
import { PageHeader, PanelLink } from "@/components/ui/metrics";
import { NextSteps } from "@/components/ui/next-steps";
import { humanize } from "@/components/ui/status-badge";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { dashboard, studentsByDepartment } from "@/server/college/queries";
import { pendingJoinCount } from "@/server/join/queries";
import { driveStats } from "@/server/drives/queries";
import { funnel } from "@/server/offers/queries";
import { registrationsPerDay } from "@/server/registrations/queries";

export const metadata = { title: "College dashboard — CampusConnect" };

export default async function CollegeDashboard() {
  const s = await requireRole("COLLEGE_ADMIN");
  const [d, ds, f, joinPending, byDept, perDay] = await Promise.all([dashboard(s), driveStats(s), funnel(s), pendingJoinCount(s), studentsByDepartment(s), registrationsPerDay(s)]);
  const todo: { text: string; href: string }[] = [];
  if (joinPending > 0) todo.push({ text: `${joinPending} student sign-up request(s) are waiting for approval.`, href: "/college/students/requests" });
  if (d.dep.active === 0) todo.push({ text: "Create your first department.", href: "/college/departments" });
  if (d.dep.without_coordinator > 0) todo.push({ text: `${d.dep.without_coordinator} active department(s) have no coordinator assigned.`, href: "/college/departments" });
  if (d.staff.unassigned > 0) todo.push({ text: `${d.staff.unassigned} coordinator(s) are not assigned to any department.`, href: "/college/staff?role=COORDINATOR" });
  if (d.stu.total === 0 && d.dep.active > 0) todo.push({ text: "Add students or import them from a CSV file.", href: "/college/students" });
  if (d.staff.officers + d.staff.officers_disabled === 0 && d.pending === 0) todo.push({ text: "Invite a placement officer.", href: "/college/staff" });
  const today = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  return (
    <div className="space-y-6">
      <PageHeader title="College dashboard" description={d.college?.name} actions={<><Pill>{today}</Pill><Pill href="/college/reports">Reports</Pill></>} />
      <NextSteps items={todo} />

      <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-6">
          <DashCard title="Placement pipeline" icon="briefcase" id="pipe" action={<PanelLink href="/college/placements">Open placements</PanelLink>}>
            <Pipeline ids label="Placement funnel" footnote="Only verified placements count as placements." stages={[
              { label: "Selected", value: f.selected, icon: "users" }, { label: "Offers issued", value: f.offers_issued, icon: "file" }, { label: "Offers accepted", value: f.offers_accepted, icon: "check" },
              { label: "Joining recorded", value: f.joining_recorded, icon: "building" }, { label: "Verified placements", value: f.placements_verified, icon: "shield" }]} />
          </DashCard>
          <DashCard title="Students by department" icon="grad" id="bydept" action={<PanelLink href="/college/students">All students</PanelLink>}>
            <ProgressRows title="Verified academic records by department" rows={byDept.map((r) => ({ label: r.code, value: r.verified, of: r.total, note: "verified" }))} empty="No departments with students yet." />
            <p className="mt-3 text-xs text-muted">Each bar is the share of that department’s students whose academic record is verified.</p>
          </DashCard>
        </div>
        <div className="min-w-0 space-y-6">
          <DashCard title="College overview" icon="chart" id="over">
            <Gauge title="Verified academic records" value={d.ac.verified} of={d.stu.total} caption="of all students" link={<PanelLink href="/college/academics">Academics</PanelLink>} />
            <div className="mt-4 grid grid-cols-3 gap-2.5">
              <MiniStat icon="users" label="Students" value={d.stu.total} href="/college/students" />
              <MiniStat icon="building" label="Departments" value={d.dep.active} href="/college/departments" />
              <MiniStat icon="briefcase" label="Staff" value={d.staff.officers + d.staff.coordinators} href="/college/staff" />
            </div>
          </DashCard>
          <DashCard title="Registrations" icon="calendar" id="trend"><LineChart title="Completed registrations, last 14 days" unit="registrations" points={perDay.map((p) => ({ label: p.day, value: p.n }))} empty="No registrations in the last 14 days." /></DashCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 @3xl:grid-cols-2 @6xl:grid-cols-4">
        <DashCard title="Academic verification" icon="shield" id="acad">
          <Donut ids title="Verification status" unit="students" slices={[
            { label: "Verified records", value: d.ac.verified, tone: "ink" }, { label: "Awaiting review", value: d.ac.pending, tone: "amber" },
            { label: "Needs correction", value: d.ac.rejected, tone: "red" }, { label: "Not yet submitted", value: d.ac.not_submitted, tone: "grey" }]} />
        </DashCard>
        <DashCard title="Student accounts" icon="users" id="acct">
          <Donut ids title="Sign-in status" unit="students" slices={[
            { label: "Active accounts", value: d.stu.active, tone: "ink" }, { label: "Invited", value: d.stu.invited, tone: "amber" },
            { label: "Not yet invited", value: d.stu.not_invited, tone: "grey" }, { label: "Disabled", value: d.stu.disabled, tone: "red" }]} />
        </DashCard>
        <DashCard title="Placement drives" icon="briefcase" id="plc" action={<PanelLink href="/college/drives">All</PanelLink>}>
          <Donut ids title="Drives by status" unit="drives" slices={[
            { label: "Published drives", value: ds.published, tone: "ink" }, { label: "Closed drives", value: ds.closed, tone: "grey" }, { label: "Draft drives", value: ds.draft, tone: "amber" }]} />
        </DashCard>
        <DashCard title="Needs attention" icon="alert" id="attn" tone="attention">
          <AttentionTiles items={[
            { label: "Sign-up requests", value: joinPending, href: "/college/students/requests", icon: "users" },
            { label: "Departments without a coordinator", value: d.dep.without_coordinator, href: "/college/departments", icon: "building" },
            { label: "Coordinators without a department", value: d.staff.unassigned, href: "/college/staff?role=COORDINATOR", icon: "alert" }]} />
        </DashCard>
      </div>

      <DashCard title="Recent activity" icon="list" id="recent" action={<PanelLink href="/college/audit">Full audit log</PanelLink>}>
        {d.recent.length === 0 ? <p className="text-sm text-muted">No activity yet.</p> : (
          <ul className="divide-y divide-border text-sm">
            {d.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 first:pt-0 last:pb-0">
                <span className="font-medium">{humanize(r.action)}</span>
                <span className="text-muted">{r.actor_email ?? "System"} · {fmtDateTime(r.occurred_at)}</span>
              </li>))}
          </ul>)}
      </DashCard>
    </div>
  );
}
