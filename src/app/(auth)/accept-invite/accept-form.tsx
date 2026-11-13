"use client";

import { useActionState } from "react";
import { acceptInvitationAction } from "@/server/auth/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function AcceptForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvitationAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Field id="fullName" label="Full name" autoComplete="name" required maxLength={200} defaultValue={state?.values?.fullName} />
      <Field id="password" label="Choose a password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} hint="At least 10 characters." />
      <Field id="confirm" label="Confirm password" type="password" autoComplete="new-password" required />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Creating account…" : "Create account"}</Button>
    </form>
  );
}
