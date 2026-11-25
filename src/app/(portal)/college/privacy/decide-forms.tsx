"use client";

import { useActionState } from "react";
import { decideErasureAction, retryErasureFilesAction } from "@/server/privacy/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function DecideForms({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(decideErasureAction, undefined);
  return (
    <div className="space-y-3">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <form action={action} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value="approve" />
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" value="yes" className="mt-1" />I understand that erasing {name}’s data cannot be undone.</label>
        <Button type="submit" variant="danger" disabled={pending}>Approve and erase</Button>
      </form>
      <form action={action} className="space-y-2">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value="decline" />
        <Field id={`reason-${id}`} name="reason" label="Reason for declining" maxLength={500} />
        <Button type="submit" variant="secondary" disabled={pending}>Decline</Button>
      </form>
    </div>
  );
}

export function RetryForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(retryErasureFilesAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Button type="submit" variant="secondary" disabled={pending}>Retry file removal</Button>
    </form>
  );
}
