"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/server/auth/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, undefined);
  return (
    <form action={action} className="max-w-sm space-y-4">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <Field id="current" label="Current password" type="password" autoComplete="current-password" required />
      <Field id="password" label="New password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} hint="At least 10 characters." />
      <Field id="confirm" label="Confirm new password" type="password" autoComplete="new-password" required />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Change password"}</Button>
    </form>
  );
}
