"use client";

import { useActionState } from "react";
import { loginAction } from "@/server/auth/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Field id="email" label="Email" type="email" autoComplete="username" required defaultValue={state?.values?.email} />
      <Field id="password" label="Password" type="password" autoComplete="current-password" required />
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}
