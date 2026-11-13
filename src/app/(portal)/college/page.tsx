import Link from "next/link";
import { Card } from "@/components/ui/card";
import { NextSteps } from "@/components/ui/next-steps";
import { humanize } from "@/components/ui/status-badge";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { dashboard } from "@/server/college/queries";
import { pendingJoinCount } from "@/server/join/queries";
import { driveStats } from "@/server/drives/queries";
import { funnel } from "@/server/offers/queries";
import { FunnelView } from "@/components/offers/funnel";

export const metadata = { title: "College dashboard — CampusConnect" };

function Stat({ label, value, href, hint }: { label: string; value: number; href?: string; hint?: string }) {
  const body = (
    <div className="h-full rounded-2xl border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums" data-testid={`stat-${label}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

export default async function CollegeDashboard() {
  const s = await requireRole("COLLEGE_ADMIN");
  const [d, ds, f, joinPending] = await Promise.all([dashboard(s), driveStats(s), funnel(s), pendingJoinCount(s)]);
  const todo: { text: string; href: string }[] = [];
  if (joinPending > 0) todo.push({ text: `${joinPending} student sign-up request(s) are waiting for approval.`, href: "/college/students/requests" });
  if (d.dep.active === 0) todo.push({ text: "Create your first department.", href: "/college/departments" });
  if (d.dep.without_coordinator > 0) todo.push({ text: `${d.dep.without_coordinator} active department(s) have no coordinator assigned.`, href: "/college/departments" });
  if (d.staff.unassigned > 0) todo.push({ text: `${d.staff.unassigned} coordinator(s) are not assigned to any department.`, href: "/college/staff?role=COORDINATOR" });
  if (d.stu.total === 0 && d.dep.active > 0) todo.push({ text: "Add students or import them from a CSV file.", href: "/college/students" });
  if (d.staff.officers + d.staff.officers_disabled === 0 && d.pending === 0) todo.push({ text: "Invite a placement officer.", href: "/college/staff" });
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">College dashboard</h1>
        <p className="text-sm text-muted">{d.college?.name}</p>
      </div>

      <NextSteps items={todo} />

      <section aria-labelledby="dep" className="space-y-3">
        <h2 id="dep" className="text-lg font-semibold">Departments</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Active departments" value={d.dep.active} href="/college/departments" />
          <Stat label="Inactive departments" value={d.dep.inactive} href="/college/departments" />
          <Stat label="Departments without a coordinator" value={d.dep.without_coordinator} />
        </div>
      </section>

      <section aria-labelledby="stu" className="space-y-3">
        <h2 id="stu" className="text-lg font-semibold">Students</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Students" value={d.stu.total} href="/college/students" />
          <Stat label="Not yet invited" value={d.stu.not_invited} href="/college/students?account=NOT_INVITED" />
          <Stat label="Invited" value={d.stu.invited} href="/college/students?account=INVITED" />
          <Stat label="Active accounts" value={d.stu.active} href="/college/students?account=ACTIVE" hint={d.stu.disabled ? `${d.stu.disabled} disabled` : undefined} />
        </div>
      </section>

      <section aria-labelledby="acad" className="space-y-3">
        <h2 id="acad" className="text-lg font-semibold">Academic verification</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Verified records" value={d.ac.verified} href="/college/students?academics=VERIFIED" />
          <Stat label="Awaiting review" value={d.ac.pending} href="/college/students?academics=PENDING" />
          <Stat label="Needs correction" value={d.ac.rejected} href="/college/students?academics=REJECTED" />
          <Stat label="Not yet submitted" value={d.ac.not_submitted} href="/college/students?academics=NOT_SUBMITTED" />
        </div>
      </section>

      <section aria-labelledby="plc" className="space-y-3">
        <h2 id="plc" className="text-lg font-semibold">Placement</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Published drives" value={ds.published} href="/college/drives?status=PUBLISHED" />
          <Stat label="Closed drives" value={ds.closed} href="/college/drives?status=CLOSED" />
          <Stat label="Draft drives" value={ds.draft} href="/college/drives?status=DRAFT" />
        </div>
        <FunnelView f={f} />
        <p className="text-xs text-muted">Only verified placements count as placements. <Link href="/college/placements" className="underline">Open placements</Link>.</p>
      </section>

      <section aria-labelledby="staff" className="space-y-3">
        <h2 id="staff" className="text-lg font-semibold">Staff</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Placement officers" value={d.staff.officers} href="/college/staff?role=PLACEMENT_OFFICER" hint={d.staff.officers_disabled ? `${d.staff.officers_disabled} disabled` : undefined} />
          <Stat label="Coordinators" value={d.staff.coordinators} href="/college/staff?role=COORDINATOR" hint={d.staff.coordinators_disabled ? `${d.staff.coordinators_disabled} disabled` : undefined} />
          <Stat label="Coordinators without a department" value={d.staff.unassigned} />
          <Stat label="Pending invitations" value={d.pending} href="/college/staff" />
        </div>
      </section>

      <Card title="Recent activity">
        {d.recent.length === 0 ? <p className="text-sm text-muted">No activity yet.</p> : (
          <ul className="space-y-1 text-sm">{d.recent.map((r) => <li key={r.id}><span className="font-medium">{humanize(r.action)}</span> <span className="text-muted">· {r.actor_email ?? "system"} · {fmtDateTime(r.occurred_at)}</span></li>)}</ul>
        )}
        <p className="mt-3 text-sm"><Link href="/college/audit" className="underline">Full audit log</Link></p>
      </Card>
      <p className="text-xs text-muted">Live counts from the database.</p>
    </div>
  );
}
