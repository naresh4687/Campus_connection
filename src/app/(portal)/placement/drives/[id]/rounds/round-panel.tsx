"use client";

import { useActionState } from "react";
import { deleteRoundAction, releaseRoundAction, setResultsAction } from "@/server/rounds/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { RESULT_LABEL, RESULT_TONE } from "@/lib/rounds";
import type { RosterRow } from "@/server/rounds/queries";

export function ResultsForm({ driveId, roundId, roster, released }: { driveId: string; roundId: string; roster: RosterRow[]; released: boolean }) {
  const [state, run, pending] = useActionState(setResultsAction, undefined);
  if (roster.length === 0) return <p className="text-sm text-muted">No candidates yet. Round 1 includes every registered student; later rounds include those selected in the previous round once it is released.</p>;
  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="driveId" value={driveId} /><input type="hidden" name="roundId" value={roundId} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <div tabIndex={0} className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-xs text-muted"><tr>{!released ? <th className="w-10 px-3 py-2"><span className="sr-only">Select</span></th> : null}<th className="px-3 py-2">Student</th><th className="px-3 py-2">Register no.</th><th className="px-3 py-2">Dept</th><th className="px-3 py-2">Decision</th></tr></thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.registration_id} className="border-t border-border">
                {!released ? <td className="px-3 py-2"><input type="checkbox" name="regs" value={r.registration_id} aria-label={`Select ${r.full_name}`} /></td> : null}
                <td className="px-3 py-2 font-medium">{r.full_name}</td><td className="px-3 py-2">{r.register_number}</td><td className="px-3 py-2">{r.department_code}</td>
                <td className="px-3 py-2"><StatusBadge value={RESULT_TONE[r.result]} label={RESULT_LABEL[r.result]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!released ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><label htmlFor={`res-${roundId}`} className="block text-sm font-medium">Mark ticked students as</label>
            <select id={`res-${roundId}`} name="result" defaultValue="" className="h-10 rounded-xl border border-border bg-surface px-3 text-sm"><option value="" disabled>Choose…</option><option value="SELECTED">Selected</option><option value="REJECTED">Not selected</option><option value="ABSENT">Absent</option><option value="PENDING">No decision yet</option></select></div>
          <div className="space-y-1"><label htmlFor={`note-${roundId}`} className="block text-sm font-medium">Remark (staff only)</label>
            <input id={`note-${roundId}`} name="note" maxLength={500} defaultValue={state?.values?.note ?? ""} className="h-10 w-64 max-w-full rounded-xl border border-border bg-surface px-3 text-sm" /></div>
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Apply"}</Button>
        </div>
      ) : null}
    </form>
  );
}

export function ReleaseForm({ driveId, roundId, name }: { driveId: string; roundId: string; name: string }) {
  const [state, run, pending] = useActionState(releaseRoundAction, undefined);
  return (
    <form action={run} className="space-y-2 rounded-xl border border-border p-3">
      <input type="hidden" name="driveId" value={driveId} /><input type="hidden" name="roundId" value={roundId} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" value="yes" className="mt-1" /><span>Release “{name}” results. Students will see their own result immediately and nothing in this round can be changed afterwards.</span></label>
      <Button type="submit" variant="primary" disabled={pending}>{pending ? "Releasing…" : "Release results"}</Button>
    </form>
  );
}

export function DeleteRoundForm({ driveId, roundId }: { driveId: string; roundId: string }) {
  const [state, run, pending] = useActionState(deleteRoundAction, undefined);
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="driveId" value={driveId} /><input type="hidden" name="id" value={roundId} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Button type="submit" variant="danger" disabled={pending}>{pending ? "Deleting…" : "Delete this round"}</Button>
    </form>
  );
}
