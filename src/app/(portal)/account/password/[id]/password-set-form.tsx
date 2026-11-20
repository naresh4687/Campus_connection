"use client";

import { useActionState } from "react";
import { completePasswordRequestAction } from "@/server/auth/password-request-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function PasswordSetForm({ id }: { id: string }) {
  const [state, run, pending] = useActionState(completePasswordRequestAction, undefined);
  return (
    <form action={run} className="max-w-sm space-y-4">
      <input type="hidden" name="id" value={id} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Field id="password" label="New password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} hint="At least 10 characters." />
      <Field id="confirm" label="Confirm new password" type="password" autoComplete="new-password" required />
      <Button type="submit" disabled={pending} pending={pending}>{pending ? "Saving…" : "Change password"}</Button>
    </form>
  );
}
