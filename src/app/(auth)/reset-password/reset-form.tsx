"use client";

import { useActionState } from "react";
import { completePasswordResetAction } from "@/server/auth/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(completePasswordResetAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Field id="password" label="New password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} hint="At least 10 characters." />
      <Field id="confirm" label="Confirm new password" type="password" autoComplete="new-password" required />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Saving…" : "Set new password"}</Button>
    </form>
  );
}
