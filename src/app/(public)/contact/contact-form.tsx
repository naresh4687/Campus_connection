"use client";

import { useActionState } from "react";
import { submitInquiryAction } from "@/server/platform/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export function ContactForm() {
  const [state, action, pending] = useActionState(submitInquiryAction, undefined);
  const v = state?.values ?? {};
  const e = state?.fieldErrors ?? {};
  if (state?.ok) return <Alert kind="success">{state.ok}</Alert>;
  return (
    <form action={action} className="space-y-5" noValidate>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label="Your name" required maxLength={120} autoComplete="name" defaultValue={v.name} error={e.name} />
        <Field id="email" label="Email" type="email" required autoComplete="email" defaultValue={v.email} error={e.email} />
      </div>
      <Field id="organization" label="College or organisation (optional)" maxLength={200} defaultValue={v.organization} error={e.organization} />
      <Textarea id="message" label="Message" required maxLength={2000} defaultValue={v.message} error={e.message} />
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Leave this empty<input type="text" name="contactUrl" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send message"}</Button>
    </form>
  );
}
