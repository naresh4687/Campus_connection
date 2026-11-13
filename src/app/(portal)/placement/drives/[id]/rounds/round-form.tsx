"use client";

import { useActionState } from "react";
import { saveRoundAction } from "@/server/rounds/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ROUND_KINDS } from "@/lib/rounds";

export function RoundForm({ driveId, id, initial }: { driveId: string; id?: string; initial?: Record<string, string> }) {
  const [state, run, pending] = useActionState(saveRoundAction, undefined);
  const v = { ...(initial ?? {}), ...(state?.values ?? {}) };
  const e = state?.fieldErrors ?? {};
  const p = id ?? "new";
  return (
    <form action={run} className="space-y-3" noValidate>
      <input type="hidden" name="driveId" value={driveId} />{id ? <input type="hidden" name="id" value={id} /> : null}
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`name-${p}`} name="name" label="Round name" maxLength={100} defaultValue={v.name} error={e.name} required />
        <Select key={`kind-${p}-${v.kind}`} id={`kind-${p}`} name="kind" label="Round type" defaultValue={v.kind ?? ""} error={e.kind} required><option value="">Choose…</option>{ROUND_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</Select>
        <Field id={`at-${p}`} name="at" label="Date and time (IST)" type="datetime-local" defaultValue={v.at} error={e.at} />
        <Field id={`venue-${p}`} name="venue" label="Venue or link" maxLength={300} defaultValue={v.venue} error={e.venue} />
      </div>
      <Textarea id={`instructions-${p}`} name="instructions" label="Instructions for students" rows={3} maxLength={2000} defaultValue={v.instructions} error={e.instructions} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : id ? "Save round" : "Add round"}</Button>
    </form>
  );
}
