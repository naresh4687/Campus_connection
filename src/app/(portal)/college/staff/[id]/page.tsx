import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ui/action-button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { fmtDateTime } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { MfaResetCard } from "@/components/mfa-reset-card";
import { canResetMfa } from "@/server/auth/mfa-queries";
import { issueResetLinkAction, setStaffStatusAction, unassignCoordinatorAction } from "@/server/college/actions";
import { getStaff } from "@/server/college/queries";
import { AssignDepartmentForm } from "./assign-form";

export const metadata = { title: "Staff member — CampusConnect" };

const ROLE_LABEL: Record<string, string> = { COLLEGE_ADMIN: "College administrator", PLACEMENT_OFFICER: "Placement officer", COORDINATOR: "Department coordinator" };

export default async function StaffMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRole("COLLEGE_ADMIN");
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await getStaff(s, id);
  if (!data) notFound();
  const { user: u, assigned, assignable } = data;
  const manageable = u.role !== "COLLEGE_ADMIN" && u.id !== s.userId;
  const disabled = u.status === "DISABLED";
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/college/staff" className="underline">← Staff</Link></p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{u.full_name}</h1>
        <StatusBadge value={u.status} />
      </div>

      <Card title="Account">
        <dl className="grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Email</dt><dd>{u.email}</dd>
          <dt className="text-muted">Role</dt><dd>{ROLE_LABEL[u.role]}</dd>
          <dt className="text-muted">Added</dt><dd>{fmtDateTime(u.created_at)}</dd>
          <dt className="text-muted">Last sign-in</dt><dd>{fmtDateTime(u.last_login_at)}</dd>
        </dl>
      </Card>

      {u.role === "COORDINATOR" ? (
        <Card title="Departments">
          {assigned.length === 0 ? <p className="text-sm text-muted">Not assigned to any department. A coordinator sees only the departments assigned to them.</p> : (
            <ul className="divide-y divide-border">
              {assigned.map((a) => (
                <li key={a.department_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <span><Link href={`/college/departments/${a.department_id}`} className="font-medium underline">{a.name}</Link> <span className="font-mono text-muted">{a.code}</span> {a.status === "INACTIVE" ? <StatusBadge value="INACTIVE" /> : null}</span>
                  <ActionButton action={unassignCoordinatorAction} fields={{ departmentId: a.department_id, userId: u.id }} label="Remove" pendingLabel="Removing…" small />
                </li>
              ))}
            </ul>
          )}
          {u.status === "ACTIVE" ? (
            <div className="mt-5 border-t border-border pt-4">
              <AssignDepartmentForm userId={u.id} options={assignable.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` }))} />
            </div>
          ) : <p className="mt-4 text-sm text-muted">Enable this account to assign departments.</p>}
        </Card>
      ) : null}

      {(await canResetMfa(s, u.id)) ? <MfaResetCard userId={u.id} /> : null}

      {manageable ? (
        <>
          <Card title="Access">
            <p className="mb-3 text-sm text-muted">{disabled ? "This account is disabled and cannot sign in." : "Disabling signs this person out immediately and blocks sign-in. It can be reversed."}</p>
            <ActionButton action={setStaffStatusAction} fields={{ id: u.id, status: disabled ? "ACTIVE" : "DISABLED" }} label={disabled ? "Enable account" : "Disable account"} variant={disabled ? "primary" : "danger"} pendingLabel="Saving…" />
          </Card>
          {!disabled ? (
            <Card title="Password reset">
              <p className="mb-3 text-sm text-muted">Create a one-time link that lets this person choose a new password. Send it to them yourself. It signs them out of all sessions when used.</p>
              <ActionButton action={issueResetLinkAction} fields={{ id: u.id, email: u.email }} label="Create password reset link" pendingLabel="Creating…" linkTitle="One-time password reset link" />
            </Card>
          ) : null}
        </>
      ) : <p className="text-sm text-muted">{u.id === s.userId ? "This is your own account. Manage your password from Account." : "College administrator accounts are managed by the platform team."}</p>}
    </div>
  );
}
