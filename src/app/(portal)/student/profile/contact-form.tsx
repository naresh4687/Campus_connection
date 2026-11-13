"use client";

import { useActionState } from "react";
import { updateOwnContactAction } from "@/server/students/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function ContactForm({ phone, personalEmail }: { phone: string; personalEmail: string }) {
  const [state, action, pending] = useActionState(updateOwnContactAction, undefined);
  const v = { phone, personalEmail, ...(state?.values ?? {}) };
  const e = state?.fieldErrors ?? {};
  return (
    <form action={action} className="max-w-md space-y-4" noValidate>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <Field id="phone" label="Phone" type="tel" defaultValue={v.phone} error={e.phone} />
      <Field id="personalEmail" label="Personal email" type="email" defaultValue={v.personalEmail} error={e.personalEmail} hint="Optional. Your college email is used to sign in." />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save contact details"}</Button>
    </form>
  );
}
