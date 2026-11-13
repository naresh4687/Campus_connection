"use client";

import { useActionState } from "react";
import { rejectAcademicsAction, verifyAcademicsAction } from "@/server/academics/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export function ReviewForms({ id, pending }: { id: string; pending: boolean }) {
  const [vState, verify, verifying] = useActionState(verifyAcademicsAction, undefined);
  const [rState, reject, rejecting] = useActionState(rejectAcademicsAction, undefined);
  // The outcome message must survive the re-render that follows a decision, so it is driven by action state.
  const done = vState?.ok ?? rState?.ok;
  return (
    <div className="space-y-4">
      {done ? <Alert kind="success">{done}</Alert> : null}
      {pending && !done ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <form action={verify} className="space-y-3 rounded-md border border-border p-4">
            <h3 className="font-medium">Verify</h3>
            {vState?.error ? <Alert kind="error">{vState.error}</Alert> : null}
            <input type="hidden" name="id" value={id} />
            <Field id="note" label="Note (optional)" maxLength={500} defaultValue={vState?.values?.note} hint="Only the student and administrators can see it." />
            <p className="text-xs text-muted">Verify only after checking every value against the college’s records. You cannot edit the values; if something is wrong, reject with a reason.</p>
            <Button type="submit" disabled={verifying || rejecting}>{verifying ? "Verifying…" : "Verify these values"}</Button>
          </form>
          <form action={reject} className="space-y-3 rounded-md border border-border p-4">
            <h3 className="font-medium">Reject</h3>
            {rState?.error ? <Alert kind="error">{rState.error}</Alert> : null}
            <input type="hidden" name="id" value={id} />
            <Textarea id="reason" label="Reason (shown to the student)" rows={3} maxLength={500} required defaultValue={rState?.values?.reason} />
            <Button type="submit" variant="danger" disabled={verifying || rejecting}>{rejecting ? "Rejecting…" : "Reject with this reason"}</Button>
          </form>
        </div>
      ) : null}
      {!pending && !done ? <p className="text-sm text-muted">This submission has already been decided or withdrawn, so no further action is possible.</p> : null}
    </div>
  );
}
