import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/format";
import { requireSession } from "@/server/auth/session";
import { pendingRequests } from "@/server/auth/password-requests-queries";
import { DecideButtons } from "./decide-buttons";

export const metadata = { title: "Password requests — CampusConnect" };
const ROLE: Record<string, string> = { STUDENT: "Student", COORDINATOR: "Coordinator", PLACEMENT_OFFICER: "Placement officer", COLLEGE_ADMIN: "College administrator" };

export default async function PasswordRequests({ searchParams }: { searchParams: Promise<{ decided?: string }> }) {
  const { decided } = await searchParams;
  const s = await requireSession();
  const rows = await pendingRequests(s);
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/account" className="underline">← Account</Link></p>
      <h1>Password requests</h1>
      {decided === "approve" ? <Alert kind="success">Approved. They were notified and can now choose a new password.</Alert> : null}
      {decided === "decline" ? <Alert kind="success">Declined. They were notified.</Alert> : null}
      <p className="text-sm text-muted">People below you ask for your approval before they can choose a new password. When you approve, they are notified and set the password themselves; you never see it.</p>
      <Card title="Waiting for your decision">
        {rows.length === 0 ? <p className="text-sm text-muted">Nothing is waiting.</p> : (
          <ul className="divide-y divide-border" aria-label="Requests">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                <span><span className="font-semibold">{r.full_name}</span> <span className="text-sm text-muted">· {ROLE[r.requester_role] ?? r.requester_role}{r.department_code ? ` · ${r.department_code}` : ""}</span>
                  <span className="block text-xs text-muted">{r.email} · asked {fmtDateTime(r.requested_at)}</span></span>
                <DecideButtons id={r.id} />
              </li>))}
          </ul>)}
      </Card>
    </div>
  );
}
