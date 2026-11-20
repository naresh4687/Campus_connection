"use client";

import { useActionState } from "react";
import { requestPasswordChangeAction } from "@/server/auth/password-request-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function RequestPasswordButton() {
  const [state, run, pending] = useActionState(requestPasswordChangeAction, undefined);
  return (
    <form action={run} className="space-y-3">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}{state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <Button type="submit" disabled={pending} pending={pending}>{pending ? "Sending…" : "Request a password change"}</Button>
    </form>
  );
}
