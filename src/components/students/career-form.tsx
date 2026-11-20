"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { CareerCategory } from "@/lib/career";
import { setCareerPreferenceAction } from "@/server/students/career-actions";

/**
 * Change career preference. With `studentId` it changes that one student; without it, it changes the students ticked in the
 * list (their checkboxes point at this form with the `form` attribute, so the table need not sit inside it).
 */
export function CareerForm({ categories, formId, studentId, current }: { categories: CareerCategory[]; formId: string; studentId?: string; current?: string }) {
  const [state, action, pending] = useActionState(setCareerPreferenceAction, undefined);
  const options = categories.filter((c) => c.active || c.code === current);
  return (
    <form id={formId} action={action} className="space-y-3">
      {studentId ? <input type="hidden" name="ids" value={studentId} /> : null}
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <div className="flex flex-wrap items-end gap-3">
        <Select id={`${formId}-pref`} name="preference" label="Move to" defaultValue={current && options.some((o) => o.code === current) ? current : options[0]?.code}>
          {options.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
        </Select>
        <div className="min-w-56 flex-1 space-y-1.5">
          <label htmlFor={`${formId}-reason`} className="block text-sm font-semibold">Reason</label>
          <input id={`${formId}-reason`} name="reason" required minLength={3} maxLength={300} placeholder="Why is this changing?"
            className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none transition-[border-color,box-shadow] duration-150 hover:border-foreground/35 focus-visible:border-foreground focus-visible:ring-4 focus-visible:ring-brand/35" />
        </div>
        <Button type="submit" pending={pending} disabled={pending}>{pending ? "Saving…" : studentId ? "Update preference" : "Update selected"}</Button>
      </div>
    </form>
  );
}

/** Ticks or clears every row checkbox that belongs to the form, for "select everyone on this page". */
export function SelectAll({ formId }: { formId: string }) {
  return (
    <button type="button" className="text-sm font-medium underline underline-offset-4"
      onClick={(e) => {
        const boxes = [...document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${formId}"]`)];
        const all = boxes.every((b) => b.checked);
        boxes.forEach((b) => { b.checked = !all; });
        e.currentTarget.textContent = all ? "Select everyone on this page" : "Clear selection";
      }}>
      Select everyone on this page
    </button>
  );
}
