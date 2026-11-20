"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { allowLateEvidenceAction, reviewEvidenceAction } from "@/server/registrations/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Verify / reject / ask for a new screenshot. A reason is mandatory for the last two; the decision is made by the database, which checks this reviewer may see this student. */
export function ReviewControls({ evidenceId, status }: { evidenceId: string; status: string }) {
  const [state, run, pending] = useActionState(reviewEvidenceAction, undefined);
  const [note, setNote] = useState("");
  if (status !== "SUBMITTED_PENDING_REVIEW") return null;
  const send = (decision: string) => (ev: FormEvent) => { ev.preventDefault(); const fd = new FormData(); fd.set("evidence", evidenceId); fd.set("decision", decision); fd.set("note", note); startTransition(() => run(fd)); };
  return (
    <div className="space-y-2">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <label className="block text-xs font-semibold" htmlFor={`note-${evidenceId}`}>Reason (required to reject or ask for a new screenshot)</label>
      <input id={`note-${evidenceId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={send("VERIFIED")} disabled={pending}>Mark verified</Button>
        <Button type="button" variant="secondary" onClick={send("RESUBMISSION_REQUIRED")} disabled={pending}>Ask for a new screenshot</Button>
        <Button type="button" variant="danger" onClick={send("REJECTED")} disabled={pending}>Reject</Button>
      </div>
    </div>
  );
}

export function LateControls({ registrationId }: { registrationId: string }) {
  const [state, run, pending] = useActionState(allowLateEvidenceAction, undefined);
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="registration" value={registrationId} /><input type="hidden" name="hours" value="24" />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}{state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <input name="note" required minLength={5} maxLength={500} placeholder="Why a late screenshot is allowed" aria-label="Reason for the exception" className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
      <Button type="submit" variant="secondary" disabled={pending}>Allow a late screenshot (24 hours)</Button>
    </form>
  );
}
