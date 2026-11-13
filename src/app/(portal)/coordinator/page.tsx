import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireRole } from "@/server/auth/session";
import { myDepartments } from "@/server/college/queries";
import { pendingCount } from "@/server/academics/queries";
import { deptParticipation } from "@/server/registrations/queries";
import { StatTile } from "@/components/ui/stat";
import { pendingJoinCount } from "@/server/join/queries";

export const metadata = { title: "Department dashboard — CampusConnect" };

export default async function CoordinatorHome() {
  const session = await requireRole("COORDINATOR");
  // No WHERE clause on purpose: the database (row-level security) returns only the departments assigned to this coordinator.
  const depts = await myDepartments(session);
  const [pending, part, joinPending] = await Promise.all([pendingCount(session), deptParticipation(session), pendingJoinCount(session)]);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Department dashboard</h1>
      {joinPending > 0 ? <Card title="Student sign-ups"><p className="text-sm"><Link href="/coordinator/requests" className="font-medium underline">{joinPending} sign-up request{joinPending === 1 ? "" : "s"} waiting for your approval</Link></p></Card> : null}
      <Card title="Academic verification">
        <p className="text-sm"><Link href="/coordinator/verification" className="font-medium underline" data-testid="pending-link">{pending} submission{pending === 1 ? "" : "s"} awaiting your review</Link></p>
      </Card>
      <section aria-labelledby="part" className="space-y-3">
        <h2 id="part" className="text-lg font-semibold">Drive participation in your departments</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Active registrations" value={part.registrations} />
          <StatTile label="Students registered" value={part.students} />
          <StatTile label="Drives with your students" value={part.drives} />
        </div>
        <p className="text-xs text-muted">Counts cover only students in the departments assigned to you. Offers and placements are managed by the placement office.</p>
      </section>
      <Card title="Your departments">
        {depts.length === 0 ? (
          <p className="text-sm text-muted">You are not assigned to any department yet. Ask your college administrator to assign you; you will see only the departments assigned to you.</p>
        ) : (
          <ul className="divide-y divide-border" aria-label="Your departments">
            {depts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="font-mono text-muted">{d.code}</span><span className="font-medium">{d.name}</span>
                {d.status === "INACTIVE" ? <StatusBadge value="INACTIVE" /> : null}
                <Link href={`/coordinator/students?dept=${d.id}`} className="ml-auto underline" data-testid={`students-${d.code}`}>{d.students} student{d.students === 1 ? "" : "s"}</Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
