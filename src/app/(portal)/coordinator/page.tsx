import Link from "next/link";
import { AttentionTiles, DashCard, Gauge, LineChart, MiniStat, Pill, PersonList, ProgressRows } from "@/components/dashboard/kit";
import { PageHeader, PanelLink } from "@/components/ui/metrics";
import { NextSteps } from "@/components/ui/next-steps";
import { StatusBadge } from "@/components/ui/status-badge";
import { fmtDate } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { myDepartments, studentsByDepartment } from "@/server/college/queries";
import { pendingCount } from "@/server/academics/queries";
import { deptParticipation, recentRegistrations, registrationsPerDay } from "@/server/registrations/queries";
import { pendingJoinCount } from "@/server/join/queries";

export const metadata = { title: "Department dashboard — CampusConnect" };

export default async function CoordinatorHome() {
  const session = await requireRole("COORDINATOR");
  // No WHERE clause on purpose: the database (row-level security) returns only the departments assigned to this coordinator.
  const depts = await myDepartments(session);
  const [pending, part, joinPending, byDept, perDay, recent] = await Promise.all([pendingCount(session), deptParticipation(session), pendingJoinCount(session), studentsByDepartment(session), registrationsPerDay(session), recentRegistrations(session, 5)]);
  const todo = [
    ...(pending > 0 ? [{ text: `${pending} academic submission${pending === 1 ? "" : "s"} awaiting your review.`, href: "/coordinator/verification" }] : []),
    ...(joinPending > 0 ? [{ text: `${joinPending} student sign-up request${joinPending === 1 ? "" : "s"} waiting for your approval.`, href: "/coordinator/requests" }] : []),
  ];
  const total = byDept.reduce((a, r) => a + r.total, 0); const verified = byDept.reduce((a, r) => a + r.verified, 0);
  const today = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  return (
    <div className="space-y-6">
      <PageHeader title="Department dashboard" description="Students in the departments assigned to you." actions={<><Pill>{today}</Pill><Pill href="/coordinator/drives">Drives</Pill></>} />
      <NextSteps items={todo} />

      <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-6">
          <DashCard title="Academic verification by department" icon="shield" id="acv" action={<Link href="/coordinator/verification" className="underline" data-testid="pending-link">{pending} submission{pending === 1 ? "" : "s"} awaiting your review</Link>}>
            <ProgressRows title="Verified academic records by department" rows={byDept.map((r) => ({ label: r.code, value: r.verified, of: r.total, note: "verified" }))} empty="No students in your departments yet." />
          </DashCard>
          <DashCard title="Your departments" icon="grad" id="deps">
            {depts.length === 0 ? (
              <p className="text-sm text-muted">You are not assigned to any department yet. Ask your college administrator to assign you; you will see only the departments assigned to you.</p>
            ) : (
              <ul className="divide-y divide-border" aria-label="Your departments">
                {depts.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 text-sm first:pt-0 last:pb-0">
                    <span className="rounded-md bg-tint px-2 py-0.5 text-xs font-semibold">{d.code}</span><span className="font-medium">{d.name}</span>
                    {d.status === "INACTIVE" ? <StatusBadge value="INACTIVE" /> : null}
                    <Link href={`/coordinator/students?dept=${d.id}`} className="ml-auto font-medium underline decoration-border underline-offset-4 hover:decoration-foreground" data-testid={`students-${d.code}`}>{d.students} student{d.students === 1 ? "" : "s"}</Link>
                  </li>))}
              </ul>)}
          </DashCard>
        </div>
        <div className="min-w-0 space-y-6">
          <DashCard title="Department overview" icon="chart" id="over">
            <Gauge title="Verified academic records" value={verified} of={total} caption="of your students" link={<PanelLink href="/coordinator/students">Students</PanelLink>} />
            <div className="mt-4 grid grid-cols-3 gap-2.5" role="group" aria-label="Drive participation in your departments">
              <MiniStat id icon="check" label="Active registrations" value={part.registrations} />
              <MiniStat id icon="users" label="Students registered" value={part.students} />
              <MiniStat id icon="briefcase" label="Drives with your students" value={part.drives} href="/coordinator/drives" />
            </div>
          </DashCard>
          <DashCard title="Registrations" icon="calendar" id="trend"><LineChart title="Completed registrations by your students, last 14 days" unit="registrations" points={perDay.map((p) => ({ label: p.day, value: p.n }))} empty="No registrations in the last 14 days." /></DashCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 @3xl:grid-cols-2">
        <DashCard title="Recent registrations" icon="users" id="recent" action={<PanelLink href="/coordinator/drives">Drives</PanelLink>}>
          <PersonList empty="None of your students has registered yet." rows={recent.map((r, i) => ({ key: `${i}-${r.name}`, name: r.name, sub: `${r.dept} · ${r.job}, ${r.company}`, meta: fmtDate(r.at), right: <StatusBadge value="APPROVED" label="Registered" /> }))} />
          <p className="mt-3 text-xs text-muted">Counts cover only students in the departments assigned to you. Offers and placements are managed by the placement office.</p>
        </DashCard>
        <DashCard title="Needs attention" icon="alert" id="attn" tone="attention">
          <AttentionTiles items={[
            { label: "Submissions to review", value: pending, href: "/coordinator/verification", icon: "file" },
            { label: "Sign-up requests", value: joinPending, href: "/coordinator/requests", icon: "users" },
            { label: "Drives to follow up", value: part.drives, href: "/coordinator/drives", icon: "briefcase" }]} />
        </DashCard>
      </div>
    </div>
  );
}
