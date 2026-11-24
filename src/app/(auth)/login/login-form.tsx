"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/server/auth/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { Portal } from "@/lib/portals";

export function LoginForm({ portal, next }: { portal: Portal; next?: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="portal" value={portal} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state?.error ? (
        <Alert kind="error">
          {state.error}
          {state.goTo ? <> <Link href={state.goTo} className="font-semibold underline underline-offset-4">Go to that page</Link></> : null}
        </Alert>
      ) : null}
      <Field id="email" label="Email" type="email" autoComplete="username" required defaultValue={state?.values?.email} />
      <Field id="password" label="Password" type="password" autoComplete="current-password" required />
      <Button type="submit" disabled={pending} pending={pending} className="h-11 w-full">{pending ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}
