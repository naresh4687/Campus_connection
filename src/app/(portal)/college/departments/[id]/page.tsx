import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ui/action-button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { fmtDate } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { setDepartmentStatusAction, unassignCoordinatorAction } from "@/server/college/actions";
import { getDepartment } from "@/server/college/queries";
import { DepartmentForm } from "../department-forms";
import { AssignCoordinatorForm } from "./department-actions";

export const metadata = { title: "Department — CampusConnect" };

export default async function DepartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRole("COLLEGE_ADMIN");
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await getDepartment(s, id);
  if (!data) notFound();
  const { dept, assigned, assignable } = data;
  const active = dept.status === "ACTIVE";
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/college/departments" className="underline">← Departments</Link></p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{dept.name}</h1>
        <span className="font-mono text-sm text-muted">{dept.code}</span>
        <StatusBadge value={dept.status} />
      </div>

      <Card title="Details"><DepartmentForm id={dept.id} initial={dept} /></Card>

      <Card title="Coordinators">
        {assigned.length === 0 ? <p className="text-sm text-muted">No coordinator is assigned to this department.</p> : (
          <ul className="divide-y divide-border">
            {assigned.map((a) => (
              <li key={a.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <span><Link href={`/college/staff/${a.user_id}`} className="font-medium underline">{a.full_name}</Link> <span className="text-muted">· {a.email} · since {fmtDate(a.assigned_at)}</span>{a.status === "DISABLED" ? <> <StatusBadge value="DISABLED" /></> : null}</span>
                <ActionButton action={unassignCoordinatorAction} fields={{ departmentId: dept.id, userId: a.user_id }} label="Remove" pendingLabel="Removing…" small />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 border-t border-border pt-4">
          {active ? <AssignCoordinatorForm departmentId={dept.id} options={assignable.map((u) => ({ id: u.id, label: `${u.full_name} (${u.email})` }))} /> : <p className="text-sm text-muted">Reactivate this department to assign coordinators.</p>}
        </div>
      </Card>

      <Card title="Status">
        <p className="mb-3 text-sm text-muted">{active ? "Deactivating hides the department from new activity. Existing records are kept and it can be reactivated." : "This department is inactive. Reactivate it to use it again."}</p>
        <ActionButton action={setDepartmentStatusAction} fields={{ id: dept.id, status: active ? "INACTIVE" : "ACTIVE" }} label={active ? "Deactivate department" : "Reactivate department"} variant={active ? "danger" : "primary"} pendingLabel="Saving…" />
      </Card>
    </div>
  );
}
