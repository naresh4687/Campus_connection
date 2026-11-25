"use client";

import { useActionState } from "react";
import { confirmMfaSetupAction, disableMfaAction, startMfaSetupAction } from "@/server/auth/mfa-actions";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClass } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function StartForm() {
  const [state, action, pending] = useActionState(startMfaSetupAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Field id="password" label="Your password" type="password" autoComplete="current-password" required maxLength={128} />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Please wait…" : "Set up two-step sign-in"}</Button>
    </form>
  );
}

export function ConfirmForm({ secret, url, home }: { secret: string; url: string; home: string }) {
  const [state, action, pending] = useActionState(confirmMfaSetupAction, undefined);
  if (state?.codes) {
    return (
      <div className="space-y-4 text-sm">
        <Alert kind="success">{state.ok}</Alert>
        <p><strong>Save these recovery codes now.</strong> Each works once if you lose your phone. They are not shown again.</p>
        <ul aria-label="Recovery codes" className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3 font-mono">{state.codes.map((c) => <li key={c}>{c}</li>)}</ul>
        <a href={home} className={buttonClass("primary", "w-full")}>I have saved them. Continue</a>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4 text-sm">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <p>1. In an authenticator app (Google Authenticator, Microsoft Authenticator or similar) add an account and enter this setup key:</p>
      <p data-testid="mfa-secret" className="break-all rounded-xl border border-border p-3 text-center font-mono text-base">{secret.replace(/(.{4})/g, "$1 ").trim()}</p>
      <p>On this phone? <a href={url} className="font-semibold underline">Open it in your authenticator app</a>.</p>
      <p>2. Type the 6-digit code the app shows.</p>
      <Field id="code" label="6-digit code" required inputMode="numeric" maxLength={7} autoComplete="one-time-code" />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Checking…" : "Turn it on"}</Button>
    </form>
  );
}

export function DisableForm() {
  const [state, action, pending] = useActionState(disableMfaAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Field id="password" label="Your password" type="password" autoComplete="current-password" required maxLength={128} />
      <Button type="submit" variant="danger" disabled={pending} className="w-full">{pending ? "Please wait…" : "Turn two-step sign-in off"}</Button>
    </form>
  );
}
