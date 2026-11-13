"use client";

import { useActionState } from "react";
import { STUDENT_FIELDS, type Mapping } from "@/lib/students";
import { applyMappingAction } from "@/server/students/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function MappingForm({ id, headers, sample, initial, validated }: { id: string; headers: string[]; sample: string[]; initial: Mapping; validated: boolean }) {
  const [state, action, pending] = useActionState(applyMappingAction, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-muted">Tell us which column of your file holds each field. We have guessed from the headers — check them. The first data row is shown to help.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {STUDENT_FIELDS.map((f) => {
          const current = state?.values?.[`map_${f.key}`] ?? (initial[f.key] === null ? "" : String(initial[f.key]));
          return (
            <div key={f.key} className="space-y-1">
              <label htmlFor={`map_${f.key}`} className="block text-sm font-medium">{f.label}{f.required ? " *" : ""}</label>
              <select id={`map_${f.key}`} name={`map_${f.key}`} defaultValue={current} key={`${f.key}-${current}`} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm">
                <option value="">{f.required ? "Choose a column…" : "Not in my file"}</option>
                {headers.map((h, i) => <option key={i} value={String(i)}>{h || `(column ${i + 1})`}{sample[i] ? ` — e.g. ${sample[i].slice(0, 30)}` : ""}</option>)}
              </select>
            </div>
          );
        })}
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Checking rows…" : validated ? "Re-check with this mapping" : "Check the file"}</Button>
    </form>
  );
}
