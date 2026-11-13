"use client";

import { useActionState } from "react";
import { reviewDocumentAction } from "@/server/documents/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Verify / reject one pending document. The outcome message is kept in action state so it survives the re-render. */
export function DocReviewForm({ id, backTo }: { id: string; backTo?: string }) {
  const [state, action, pending] = useActionState(reviewDocumentAction, undefined);
  if (state?.ok) return <Alert kind="success">{state.ok}</Alert>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      {backTo ? <input type="hidden" name="backTo" value={backTo} /> : null}
      <div className="space-y-1">
        <label htmlFor={`reason-${id}`} className="block text-xs text-muted">Reason (needed to reject)</label>
        <input id={`reason-${id}`} name="reason" maxLength={500} defaultValue={state?.values?.reason} className="h-8 w-64 max-w-full rounded-md border border-border bg-surface px-2 text-sm" />
      </div>
      <Button type="submit" name="decision" value="VERIFIED" disabled={pending} className="h-8 px-3">Verify</Button>
      <Button type="submit" name="decision" value="REJECTED" variant="danger" disabled={pending} className="h-8 px-3">Reject</Button>
      {state?.error ? <div className="w-full"><Alert kind="error">{state.error}</Alert></div> : null}
    </form>
  );
}
