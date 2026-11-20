import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { requireRole } from "@/server/auth/session";
import { academicsByDepartment } from "@/server/academics/queries";

export const metadata = { title: "Academic verification — CampusConnect" };

export default async function CollegeAcademics() {
  const s = await requireRole("COLLEGE_ADMIN");
  const { rows, pendingNoCoordinator } = await academicsByDepartment(s);
  const sum = (k: "students" | "verified" | "pending" | "rejected" | "not_submitted") => rows.reduce((a, r) => a + r[k], 0);
  const f = (id: string, st: string) => `/college/students?dept=${id}&academics=${st}`;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Academic verification</h1>
      <p className="text-sm text-muted">Progress of academic verification by department. Verification is done by each department’s coordinator; administrators have read-only oversight.</p>

      {pendingNoCoordinator.length > 0 ? (
        <Alert kind="error">Submissions are waiting in departments with no active coordinator: {pendingNoCoordinator.map((p) => `${p.code} (${p.pending})`).join(", ")}. <Link href="/college/departments" className="underline">Assign a coordinator</Link> so they can be reviewed.</Alert>
      ) : null}

      <div className="grid gap-4 @xl:grid-cols-2 @3xl:grid-cols-5">
        {([["Students", sum("students"), "/college/students"], ["Verified", sum("verified"), "/college/students?academics=VERIFIED"], ["Awaiting review", sum("pending"), "/college/students?academics=PENDING"], ["Needs correction", sum("rejected"), "/college/students?academics=REJECTED"], ["Not submitted", sum("not_submitted"), "/college/students?academics=NOT_SUBMITTED"]] as const).map(([label, n, href]) => (
          <Link key={label} href={href} className="block card p-4 hover:opacity-90"><p className="text-sm text-muted">{label}</p><p className="mt-1 text-3xl font-semibold tabular-nums" data-testid={`acad-${label}`}>{n}</p></Link>
        ))}
      </div>

      <Card title="By department">
        <Table head={["Department", "Students", "Verified", "Awaiting review", "Needs correction", "Not submitted"]} empty={rows.length === 0 ? <EmptyState title="No departments yet" /> : undefined}>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td><Link href={`/college/departments/${r.id}`} className="font-medium underline">{r.code}</Link> <span className="text-muted">{r.name}</span> {r.status === "INACTIVE" ? <StatusBadge value="INACTIVE" /> : null}</Td>
              <Td>{r.students}</Td>
              <Td><Link href={f(r.id, "VERIFIED")} className="underline" data-testid={`dept-${r.code}-verified`}>{r.verified}</Link></Td>
              <Td><Link href={f(r.id, "PENDING")} className="underline" data-testid={`dept-${r.code}-pending`}>{r.pending}</Link>{r.updates_pending ? <span className="text-xs text-muted"> ({r.updates_pending} update{r.updates_pending === 1 ? "" : "s"})</span> : null}</Td>
              <Td><Link href={f(r.id, "REJECTED")} className="underline" data-testid={`dept-${r.code}-rejected`}>{r.rejected}</Link></Td>
              <Td><Link href={f(r.id, "NOT_SUBMITTED")} className="underline" data-testid={`dept-${r.code}-notsubmitted`}>{r.not_submitted}</Link></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
