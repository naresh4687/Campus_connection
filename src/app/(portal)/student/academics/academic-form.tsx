"use client";

import { useActionState } from "react";
import { submitAcademicsAction } from "@/server/academics/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export type AcademicValues = { cgpa: string; tenth: string; twelfth: string; diploma: string; backlogs: string; arrears: string; note: string };

export type EvidenceOption = { id: string; original_name: string; kind: string; review_status: string };

export function AcademicForm({ initial, updating, evidence }: { initial: AcademicValues; updating: boolean; evidence: EvidenceOption[] }) {
  const [state, action, pending] = useActionState(submitAcademicsAction, undefined);
  const v = { ...initial, ...(state?.values ?? {}) } as AcademicValues;
  const e = state?.fieldErrors ?? {};
  return (
    <form action={action} className="max-w-2xl space-y-4" noValidate>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="cgpa" label="Overall CGPA (out of 10)" inputMode="decimal" required defaultValue={v.cgpa} error={e.cgpa} hint="Up to two decimal places." />
        <Field id="tenth" label="10th percentage" inputMode="decimal" required defaultValue={v.tenth} error={e.tenth} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="twelfth" label="12th percentage" inputMode="decimal" defaultValue={v.twelfth} error={e.twelfth} hint="Leave blank if you came through a diploma." />
        <Field id="diploma" label="Diploma percentage" inputMode="decimal" defaultValue={v.diploma} error={e.diploma} hint="Leave blank if you did not do a diploma." />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="backlogs" label="Active backlogs" inputMode="numeric" required defaultValue={v.backlogs} error={e.backlogs} hint="Type 0 if you have none." />
        <Field id="arrears" label="Historical arrears" inputMode="numeric" required defaultValue={v.arrears} error={e.arrears} hint="Total arrears you have had in the past, including cleared ones. Type 0 if none." />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Evidence (optional)</legend>
        <p className="text-xs text-muted">Attach the mark sheets or certificates that support these values. Attached documents cannot be deleted afterwards.</p>
        {evidence.length === 0 ? <p className="text-sm text-muted">You have no mark sheets or certificates uploaded. <a href="/student/documents" className="underline">Upload documents</a> first if you want to attach evidence.</p> : (
          <ul className="space-y-1">
            {evidence.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-sm">
                <input id={`ev-${d.id}`} type="checkbox" name="evidence" value={d.id} className="h-4 w-4" />
                <label htmlFor={`ev-${d.id}`}>{d.original_name} <span className="text-muted">({d.kind === "MARKSHEET" ? "mark sheet" : "certificate"})</span></label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <Textarea id="note" label="Note for the reviewer (optional)" rows={3} maxLength={500} defaultValue={v.note} error={e.note} />
      <Button type="submit" disabled={pending}>{pending ? "Submitting…" : updating ? "Submit update for review" : "Submit for review"}</Button>
    </form>
  );
}
