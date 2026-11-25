"use client";

import { useActionState } from "react";
import { verifyMfaAction } from "@/server/auth/mfa-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifyMfaAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Field id="code" label="Code" required maxLength={40} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} hint="The 6-digit code from your authenticator app, or one of your recovery codes." />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Checking…" : "Verify and sign in"}</Button>
    </form>
  );
}
