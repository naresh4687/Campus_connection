"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { EMPLOYMENT_TYPES, yearOptions } from "@/lib/drives";
import { DEGREES } from "@/lib/students";
import { saveDriveAction } from "@/server/drives/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type DriveValues = Record<string, string>;
const csv = (v: string | undefined) => (v ? v.split(",").filter(Boolean) : []);

export function DriveForm({ id, initial, companies, departments }: { id?: string; initial: DriveValues; companies: { id: string; name: string }[]; departments: { id: string; code: string; name: string }[] }) {
  const [state, action, pending] = useActionState(saveDriveAction, undefined);
  const v = { ...initial, ...(state?.values ?? {}) };
  const e = state?.fieldErrors ?? {};
  const [external, setExternal] = useState(v.externalEnabled === "yes");
  // Submitted through a transition: React resets an action form after it runs, which would clear what was typed when a save is refused.
  const submit = (ev: FormEvent<HTMLFormElement>) => { ev.preventDefault(); const fd = new FormData(ev.currentTarget); startTransition(() => action(fd)); };
  const deps = new Set(csv(v.departments)); const years = new Set(csv(v.years)); const degs = new Set(csv(v.degrees));
  return (
    <form onSubmit={submit} className="max-w-4xl space-y-6" noValidate>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      {id ? <input type="hidden" name="id" value={id} /> : null}

      <fieldset className="space-y-4"><legend className="text-lg font-semibold">The role</legend>
        <div className="grid gap-4 @xl:grid-cols-2">
          <div>
            <Field id="companyName" label="Company" required maxLength={150} list="company-options" autoComplete="off" defaultValue={v.companyName} error={e.companyName}
              hint={companies.length ? "Start typing to pick an existing company, or type a new name. New companies are added automatically." : "Type the company name. It is added to your companies automatically."} />
            <datalist id="company-options">{companies.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          </div>
          <Field id="title" label="Job title" required maxLength={150} defaultValue={v.title} error={e.title} />
        </div>
        <div className="grid gap-4 @xl:grid-cols-3">
          <Select key={`ty-${v.type}`} id="type" label="Employment type" required defaultValue={v.type ?? ""} error={e.type}>
            <option value="" disabled>Choose…</option>{EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
          <Field id="location" label="Location" maxLength={150} defaultValue={v.location} error={e.location} />
          <Field id="openings" label="Openings" inputMode="numeric" defaultValue={v.openings} error={e.openings} />
        </div>
        <div className="grid gap-4 @xl:grid-cols-3">
          <Field id="ctc" label="CTC (LPA)" inputMode="decimal" defaultValue={v.ctc} error={e.ctc} />
          <Field id="ctcNote" label="CTC note" maxLength={200} defaultValue={v.ctcNote} error={e.ctcNote} hint="e.g. fixed + variable breakup" />
          <Field id="deadline" label="Application deadline (IST)" type="datetime-local" defaultValue={v.deadline} error={e.deadline} />
        </div>
        <Textarea id="description" label="Job description" rows={4} maxLength={4000} defaultValue={v.description} error={e.description} />
        <div className="grid gap-4 @xl:grid-cols-2">
          <Field id="qualification" label="Qualification" maxLength={300} defaultValue={v.qualification} error={e.qualification} />
          <Field id="bond" label="Bond details" maxLength={1000} defaultValue={v.bond} error={e.bond} />
        </div>
        <Textarea id="interview" label="Interview details" rows={3} maxLength={2000} defaultValue={v.interview} error={e.interview} />
        <Textarea id="instructions" label="Instructions for students" rows={3} maxLength={3000} defaultValue={v.instructions} error={e.instructions} />
      </fieldset>

      <fieldset className="space-y-4"><legend className="text-lg font-semibold">Eligibility</legend>
        <p className="text-xs text-muted">Students are checked against these conditions using their <strong>verified</strong> academic record. Leave a threshold blank for “no requirement” — blank never means zero.</p>
        <div><p className="text-sm font-medium">Eligible departments *</p>
          <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1">{departments.map((d) => (
            <li key={d.id} className="flex items-center gap-2 text-sm"><input id={`dep-${d.id}`} type="checkbox" name="departments" value={d.id} defaultChecked={deps.has(d.id)} className="h-4 w-4" /><label htmlFor={`dep-${d.id}`}>{d.code}</label></li>))}</ul></div>
        <div><p className="text-sm font-medium">Eligible passing years *</p>
          <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1">{yearOptions().map((y) => (
            <li key={y} className="flex items-center gap-2 text-sm"><input id={`yr-${y}`} type="checkbox" name="years" value={y} defaultChecked={years.has(String(y))} className="h-4 w-4" /><label htmlFor={`yr-${y}`}>{y}</label></li>))}</ul></div>
        <div><p className="text-sm font-medium">Degrees (none ticked = any)</p>
          <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1">{DEGREES.map((g) => (
            <li key={g} className="flex items-center gap-2 text-sm"><input id={`dg-${g}`} type="checkbox" name="degrees" value={g} defaultChecked={degs.has(g)} className="h-4 w-4" /><label htmlFor={`dg-${g}`}>{g}</label></li>))}</ul></div>
        <div className="grid gap-4 @2xl:grid-cols-4">
          <Field id="minCgpa" label="Minimum CGPA" inputMode="decimal" defaultValue={v.minCgpa} error={e.minCgpa} />
          <Field id="minTenth" label="Minimum 10th %" inputMode="decimal" defaultValue={v.minTenth} error={e.minTenth} />
          <Field id="minTwelfth" label="Minimum 12th %" inputMode="decimal" defaultValue={v.minTwelfth} error={e.minTwelfth} hint="Checked only for students who did 12th." />
          <Field id="minDiploma" label="Minimum diploma %" inputMode="decimal" defaultValue={v.minDiploma} error={e.minDiploma} hint="Checked only for students who did a diploma (lateral entry)." />
        </div>
        <div className="grid gap-4 @xl:grid-cols-2">
          <Field id="maxBacklogs" label="Maximum active backlogs" inputMode="numeric" defaultValue={v.maxBacklogs} error={e.maxBacklogs} hint="0 means no active backlogs allowed." />
          <Field id="maxArrears" label="Maximum historical arrears" inputMode="numeric" defaultValue={v.maxArrears} error={e.maxArrears} />
        </div>
      </fieldset>
      <fieldset className="space-y-4"><legend className="text-lg font-semibold">How students register</legend>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="externalEnabled" value="yes" checked={external} onChange={(e) => setExternal(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span><strong>This drive has an external registration link</strong> (the company’s website or a form such as Google Forms). Leave it off and students register in CampusConnect with one click.</span></label>
        {external ? (
          <div className="space-y-4 rounded-2xl bg-tint p-4" data-testid="external-fields">
            <Field id="externalUrl" label="External registration link" type="url" placeholder="https://" maxLength={500} defaultValue={v.externalUrl} error={e.externalUrl}
              hint="Only the form students must fill in. A company website or job-description page is not a registration link." />
            <Textarea id="externalInstructions" label="Instructions for students (optional)" rows={3} maxLength={2000} defaultValue={v.externalInstructions} error={e.externalInstructions} />
            <div className="space-y-1">
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="externalConfirmed" value="yes" defaultChecked={v.externalConfirmed === "yes"} className="mt-0.5 h-4 w-4" aria-describedby={e.externalConfirmed ? "externalConfirmed-error" : undefined} />
                <span>I confirm this link is the company’s actual registration form. Students will open it, complete it, and then <strong>upload a screenshot of the final confirmation page</strong> here. Their registration is recorded in CampusConnect only after that screenshot is submitted, and staff then verify it.</span></label>
              {e.externalConfirmed ? <p id="externalConfirmed-error" className="text-xs text-danger">{e.externalConfirmed}</p> : null}
            </div>
          </div>) : <p className="text-sm text-muted">Students will register in CampusConnect with one click once the drive is published.</p>}
      </fieldset>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : id ? "Save draft" : "Create draft"}</Button>
    </form>
  );
}
