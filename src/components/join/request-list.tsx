"use client";

import { useActionState } from "react";
import { decideJoinAction } from "@/server/join/actions";
import type { JoinRequestRow } from "@/server/join/queries";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { fmtDateTime } from "@/lib/format";

function Decide({ id }: { id: string }) {
  const [state, run, pending] = useActionState(decideJoinAction, undefined);
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <div className="flex flex-wrap items-end gap-3">
        <Button type="submit" name="decision" value="approve" disabled={pending}>Approve</Button>
        <div className="space-y-1"><label htmlFor={`why-${id}`} className="block text-xs font-medium">Reason (needed to reject)</label>
          <input id={`why-${id}`} name="reason" maxLength={500} defaultValue={state?.values?.reason ?? ""} className="h-10 w-56 max-w-full rounded-xl border border-border bg-surface px-3 text-sm" /></div>
        <Button type="submit" name="decision" value="reject" variant="danger" disabled={pending}>Reject</Button>
      </div>
    </form>
  );
}

export function RequestList({ rows }: { rows: JoinRequestRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">No sign-up requests yet.</p>;
  return (
    <ul className="space-y-4" aria-label="Sign-up requests">
      {rows.map((r) => (
        <li key={r.id} className="rounded-xl border border-border p-4">
          <p className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{r.full_name}</span><span className="text-muted">{r.register_number} · {r.dept_code} · {r.degree} {r.admission_year}–{r.passing_year}</span>
            <StatusBadge value={r.status === "APPROVED" ? "APPROVED" : r.status === "REJECTED" ? "REJECTED" : "PENDING"} label={r.status === "PENDING" ? "Waiting" : r.status === "APPROVED" ? "Approved" : "Rejected"} /></p>
          <p className="mt-1 text-sm">{r.college_email} · {r.phone}{r.personal_email ? ` · ${r.personal_email}` : ""}</p>
          <p className="text-xs text-muted">Asked {fmtDateTime(r.created_at)}{r.decided_at ? ` · decided by ${r.decided_by_name}, ${fmtDateTime(r.decided_at)}` : ""}{r.decision_reason ? ` — “${r.decision_reason}”` : ""}</p>
          {r.status === "PENDING" ? <div className="mt-3"><Decide id={r.id} /></div> : null}
        </li>
      ))}
    </ul>
  );
}
