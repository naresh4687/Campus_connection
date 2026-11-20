"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { extendDeadlineAction } from "@/server/drives/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

/** Registration closes by itself when the deadline passes. This reopens it until a new, later deadline (with a reason on record). */
export function ExtendDeadline({ id, expired }: { id: string; expired: boolean }) {
  const [state, run, pending] = useActionState(extendDeadlineAction, undefined);
  // Submitted through a transition: React resets an action form after it runs, which would clear the reason when the new deadline is refused.
  const submit = (ev: FormEvent<HTMLFormElement>) => { ev.preventDefault(); const fd = new FormData(ev.currentTarget); startTransition(() => run(fd)); };
  return (
    <form onSubmit={submit} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      {expired ? <Alert kind="info">The deadline has passed, so registration closed automatically. Extend it to reopen registration.</Alert> : null}
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}{state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <div className="grid gap-3 @xl:grid-cols-2">
        <Field id="deadline" label="New deadline (India time)" type="datetime-local" required />
        <Field id="reason" label="Reason for extending" required minLength={5} maxLength={500} />
      </div>
      <Button type="submit" disabled={pending} pending={pending}>{pending ? "Extending…" : "Extend deadline"}</Button>
    </form>
  );
}
