"use client";

import { useActionState } from "react";
import { addAchievementAction, reviseAchievementAction, withdrawAchievementAction } from "@/server/achievements/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ACHIEVEMENT_KINDS, KIND_LABEL } from "@/lib/achievements";

export function AchievementForm() {
  const [state, action, pending] = useActionState(addAchievementAction, undefined);
  const v = state?.values ?? {};
  const e = state?.fieldErrors ?? {};
  // A successful add clears the form (the key changes), a failed one keeps what was typed.
  return (
    <form action={action} key={state?.ok ?? "form"} className="max-w-2xl space-y-4" noValidate>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <div className="grid gap-4 @xl:grid-cols-2">
        <Select key={v.kind ?? ""} id="kind" label="Type" defaultValue={v.kind ?? ""} error={e.kind}>
          <option value="" disabled>Choose…</option>
          {ACHIEVEMENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </Select>
        <Field id="date" label="Date" type="date" required defaultValue={v.date} error={e.date} hint="When it happened or was awarded." />
      </div>
      <Field id="title" label="Title" required maxLength={150} defaultValue={v.title} error={e.title} />
      <Textarea id="description" label="Description (optional)" rows={3} maxLength={600} defaultValue={v.description} error={e.description} />
      <Field id="link" label="Link (optional)" inputMode="url" defaultValue={v.link} error={e.link} hint="Certificate, repository or publication page, starting with https://" />
      <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add achievement"}</Button>
    </form>
  );
}

export function WithdrawAchievement({ id }: { id: string }) {
  const [state, action, pending] = useActionState(withdrawAchievementAction, undefined);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="id" value={id} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Withdrawing…" : "Withdraw"}</Button>
    </form>
  );
}

/** Edit a verified entry: the change is a new entry for review; the verified one stays as it is until it is verified. */
export function ReviseAchievement({ a }: { a: { id: string; kind: string; title: string; achieved_on: string; description: string | null; link: string | null } }) {
  const [state, action, pending] = useActionState(reviseAchievementAction, undefined);
  const v = { kind: a.kind, title: a.title, date: a.achieved_on, description: a.description ?? "", link: a.link ?? "", ...(state?.values ?? {}) };
  const e = state?.fieldErrors ?? {};
  if (state?.ok) return <Alert kind="success">{state.ok}</Alert>;
  return (
    <details className="rounded-xl border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">Edit this entry</summary>
      <form action={action} className="mt-3 max-w-2xl space-y-3" noValidate>
        <p className="text-xs text-muted">Your verified entry stays as it is, and keeps counting, until a coordinator verifies the change.</p>
        {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
        <input type="hidden" name="id" value={a.id} />
        <div className="grid gap-3 @xl:grid-cols-2">
          <Select key={v.kind} id={`kind-${a.id}`} name="kind" label="Type" defaultValue={v.kind} error={e.kind}>
            {ACHIEVEMENT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </Select>
          <Field id={`date-${a.id}`} name="date" label="Date" type="date" required defaultValue={v.date} error={e.date} />
        </div>
        <Field id={`title-${a.id}`} name="title" label="Title" required maxLength={150} defaultValue={v.title} error={e.title} />
        <Textarea id={`description-${a.id}`} name="description" label="Description (optional)" rows={3} maxLength={600} defaultValue={v.description} error={e.description} />
        <Field id={`link-${a.id}`} name="link" label="Link (optional)" inputMode="url" defaultValue={v.link} error={e.link} />
        <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send change for review"}</Button>
      </form>
    </details>
  );
}
