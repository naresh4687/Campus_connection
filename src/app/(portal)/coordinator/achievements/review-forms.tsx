"use client";

import { useActionState } from "react";
import { rejectAchievementAction, verifyAchievementAction } from "@/server/achievements/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function AchievementReview({ id }: { id: string }) {
  const [vState, verify, verifying] = useActionState(verifyAchievementAction, undefined);
  const [rState, reject, rejecting] = useActionState(rejectAchievementAction, undefined);
  const done = vState?.ok ?? rState?.ok;
  if (done) return <Alert kind="success">{done}</Alert>;
  return (
    <div className="grid gap-3 @3xl:grid-cols-2">
      <form action={verify} className="space-y-2 rounded-xl border border-border p-3">
        {vState?.error ? <Alert kind="error">{vState.error}</Alert> : null}
        <input type="hidden" name="id" value={id} />
        <Field id={`note-${id}`} name="note" label="Note (optional)" maxLength={500} />
        <Button type="submit" disabled={verifying || rejecting}>{verifying ? "Verifying…" : "Verify"}</Button>
      </form>
      <form action={reject} className="space-y-2 rounded-xl border border-border p-3">
        {rState?.error ? <Alert kind="error">{rState.error}</Alert> : null}
        <input type="hidden" name="id" value={id} />
        <Field id={`reason-${id}`} name="reason" label="Reason (shown to the student)" maxLength={500} defaultValue={rState?.values?.reason} />
        <Button type="submit" variant="danger" disabled={verifying || rejecting}>{rejecting ? "Returning…" : "Return with this reason"}</Button>
      </form>
    </div>
  );
}
