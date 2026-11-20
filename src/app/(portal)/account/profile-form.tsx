"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { updateProfileAction } from "@/server/auth/password-request-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, run, pending] = useActionState(updateProfileAction, undefined);
  const v = state?.values ?? { name, email };
  const submit = (ev: FormEvent<HTMLFormElement>) => { ev.preventDefault(); const fd = new FormData(ev.currentTarget); startTransition(() => run(fd)); };
  return (
    <form onSubmit={submit} className="max-w-sm space-y-4">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}{state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <Field id="name" label="Name" required maxLength={120} defaultValue={v.name} />
      <Field id="email" label="Sign-in email" type="email" required maxLength={254} defaultValue={v.email} />
      <Field id="current" label="Current password (to confirm the change)" type="password" autoComplete="current-password" required />
      <Button type="submit" disabled={pending} pending={pending}>{pending ? "Saving…" : "Save name and email"}</Button>
    </form>
  );
}
