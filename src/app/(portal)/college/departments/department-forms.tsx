"use client";

import { useActionState } from "react";
import { createDepartmentAction, updateDepartmentAction } from "@/server/college/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

type Props = { id?: string; initial?: { name: string; code: string; description: string | null } };

/** Create (no id) or edit (with id) a department. */
export function DepartmentForm({ id, initial }: Props) {
  const [state, action, pending] = useActionState(id ? updateDepartmentAction : createDepartmentAction, undefined);
  const v = state?.values ?? { name: initial?.name ?? "", code: initial?.code ?? "", description: initial?.description ?? "" };
  const e = state?.fieldErrors ?? {};
  // After a successful create the form should empty itself; remounting on the success message does that.
  return (
    <form action={action} key={!id && state?.ok ? `done-${state.ok}` : "form"} className="max-w-xl space-y-4" noValidate>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <div className="grid gap-4 @xl:grid-cols-[1fr_9rem]">
        <Field id="name" label="Department name" required maxLength={100} defaultValue={state?.ok && !id ? "" : v.name} error={e.name} />
        <Field id="code" label="Code" required maxLength={12} defaultValue={state?.ok && !id ? "" : v.code} error={e.code} hint="e.g. CSE" />
      </div>
      <Textarea id="description" label="Description (optional)" rows={3} maxLength={500} defaultValue={state?.ok && !id ? "" : v.description ?? ""} error={e.description} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : id ? "Save changes" : "Add department"}</Button>
    </form>
  );
}
