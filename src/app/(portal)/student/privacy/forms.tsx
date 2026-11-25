"use client";

import { useActionState } from "react";
import { cancelErasureAction, requestErasureAction } from "@/server/privacy/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function RequestForm() {
  const [state, action, pending] = useActionState(requestErasureAction, undefined);
  return (
    <form action={action} className="max-w-sm space-y-4">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Field id="password" label="Your password" type="password" autoComplete="current-password" required maxLength={128} />
      <Button type="submit" variant="danger" disabled={pending}>{pending ? "Sending…" : "Ask to delete my data"}</Button>
    </form>
  );
}

export function CancelForm() {
  const [state, action, pending] = useActionState(cancelErasureAction, undefined);
  return (
    <form action={action} className="space-y-3">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Cancelling…" : "Cancel my request"}</Button>
    </form>
  );
}
