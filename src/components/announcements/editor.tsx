"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import Link from "next/link";
import { DISPLAY_LABEL, DISPLAY_MODES, FIELDS_FOR, KINDS, KIND_LABEL, PRIORITIES, PRIORITY_LABEL, REQUIRED_NOTE, SOURCES, SOURCE_LABEL, isKind, type Kind } from "@/lib/announcements";
import { saveAnnouncementAction } from "@/server/announcements/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type EditorValues = {
  kind: string; title: string; company_name: string; drive_id: string; priority: string; display_mode: string; summary: string; original_message: string;
  event_date: string; event_time: string; venue: string; instructions: string; consent_deadline: string; expires_at: string; action_link: string; stages: string; batches: string;
  aud_source: string; aud_departments: string[]; aud_years: string; aud_career: string; aud_drive: string; aud_named: string;
};
export const EMPTY_VALUES: EditorValues = {
  kind: "", title: "", company_name: "", drive_id: "", priority: "NORMAL", display_mode: "BOTH", summary: "", original_message: "", event_date: "", event_time: "", venue: "", instructions: "",
  consent_deadline: "", expires_at: "", action_link: "", stages: "", batches: "", aud_source: "ALL", aud_departments: [], aud_years: "", aud_career: "PLACEMENT", aud_drive: "", aud_named: "",
};
const CAREERS = [["PLACEMENT", "Placement"], ["HIGHER_STUDIES", "Higher studies"], ["ENTREPRENEURSHIP", "Entrepreneurship"], ["OTHER", "Other"], ["UNDECIDED", "Undecided"], ["NOT_SEEKING_PLACEMENT", "Not seeking placement"]];

type Props = {
  id?: string; initial: EditorValues; departments: { id: string; code: string; name: string }[]; drives: { id: string; company_name: string; job_title: string; status: string }[];
  coordinator: boolean; published: boolean; backHref: string;
};

/** One form for creating and editing an announcement: only the fields that apply to the chosen type are shown; the database enforces the rules. */
export function AnnouncementEditor({ id, initial, departments, drives, coordinator, published, backHref }: Props) {
  const [state, action, pending] = useActionState(saveAnnouncementAction, undefined);
  const v = { ...initial, ...(state?.values ?? {}) } as EditorValues;
  const e = state?.fieldErrors ?? {};
  // Submitted through a transition instead of the form's action prop: React resets an action form after it runs, which would blank everything the officer typed when the save is refused.
  const submit = (ev: FormEvent<HTMLFormElement>) => { ev.preventDefault(); const fd = new FormData(ev.currentTarget); startTransition(() => action(fd)); };
  const [kind, setKind] = useState<string>(v.kind);
  const [source, setSource] = useState<string>(v.aud_source);
  const applies = new Set<string>(isKind(kind) ? FIELDS_FOR[kind as Kind] : []);
  return (
    <form onSubmit={submit} className="max-w-3xl space-y-5" noValidate>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      {state?.table ? <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-left text-sm"><caption className="sr-only">Named students</caption>
        <thead className="bg-background text-xs text-muted"><tr>{state.table.headers.map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
        <tbody>{state.table.rows.map((r, i) => <tr key={i} className="border-t border-border">{r.map((c, j) => <td key={j} className="px-3 py-2">{c}</td>)}</tr>)}</tbody></table></div> : null}
      {id ? <input type="hidden" name="id" value={id} /> : null}

      <fieldset className="space-y-4"><legend className="text-base font-semibold">What is it?</legend>
        <Select id="kind" label="Type of announcement" value={kind} onChange={(ev) => setKind(ev.target.value)} disabled={published} error={e.kind} required>
          <option value="">Choose a type…</option>
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </Select>
        {published ? <input type="hidden" name="kind" value={kind} /> : null}
        {isKind(kind) && REQUIRED_NOTE[kind] ? <p className="text-xs text-muted">{REQUIRED_NOTE[kind]}</p> : null}
        <Field id="title" label="Title" required maxLength={150} defaultValue={v.title} error={e.title} />
        <div className="grid gap-4 @xl:grid-cols-2">
          <Field id="company_name" label="Company (optional)" maxLength={120} defaultValue={v.company_name} error={e.company_name} />
          <Select id="drive_id" label="Related placement drive (optional)" defaultValue={v.drive_id} error={e.drive_id}>
            <option value="">Not linked to a drive</option>
            {drives.map((d) => <option key={d.id} value={d.id}>{d.company_name} — {d.job_title}</option>)}
          </Select>
        </div>
        <p className="text-xs text-muted">An announcement never creates or changes a drive. Linking only shows students which drive it belongs to.</p>
      </fieldset>

      {applies.size ? (
        <fieldset className="space-y-4"><legend className="text-base font-semibold">Details</legend>
          <div className="grid gap-4 @xl:grid-cols-3">
            {applies.has("event_date") ? <Field id="event_date" label="Event date" type="date" defaultValue={v.event_date} error={e.event_date} /> : null}
            {applies.has("event_time") ? <Field id="event_time" label="Time (as written)" maxLength={40} placeholder="9.10 AM" defaultValue={v.event_time} error={e.event_time} /> : null}
            {applies.has("venue") ? <Field id="venue" label="Venue" maxLength={200} defaultValue={v.venue} error={e.venue} /> : null}
          </div>
          {applies.has("consent_deadline") ? <Field id="consent_deadline" label="Consent deadline (India time)" type="datetime-local" defaultValue={v.consent_deadline} error={e.consent_deadline} /> : null}
          {applies.has("stages") ? <Textarea id="stages" label="Recruitment stages (one per line, in order)" rows={5} maxLength={3000} defaultValue={v.stages} error={e.stages} /> : null}
          {applies.has("batches") ? <Textarea id="batches" label="Batches and their venues (one per line: Batch 1 | CC1 and CC2)" rows={5} maxLength={5000} defaultValue={v.batches} error={e.batches} hint="Each batch keeps its own venue. Optionally add a note after a second “|”." /> : null}
          {applies.has("instructions") ? <Textarea id="instructions" label="Instructions" rows={4} maxLength={3000} defaultValue={v.instructions} error={e.instructions} /> : null}
          {applies.has("action_link") ? <Field id="action_link" label="Link students should use (optional)" type="url" placeholder="https://" defaultValue={v.action_link} error={e.action_link} /> : null}
        </fieldset>
      ) : null}

      <fieldset className="space-y-4"><legend className="text-base font-semibold">What students see</legend>
        <Textarea id="summary" label="Summary" rows={6} maxLength={5000} defaultValue={v.summary} error={e.summary} hint="Keep the exact meaning of dates, amounts, conditions and consent requirements." />
        <Textarea id="original_message" label="Original message (kept exactly as received)" rows={8} maxLength={20000} defaultValue={v.original_message} error={e.original_message} />
        <div className="grid gap-4 @xl:grid-cols-3">
          <Select id="display_mode" label="Students see" defaultValue={v.display_mode} error={e.display_mode}>{DISPLAY_MODES.map((m) => <option key={m} value={m}>{DISPLAY_LABEL[m]}</option>)}</Select>
          <Select id="priority" label="Priority" defaultValue={v.priority} error={e.priority}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select>
          <Field id="expires_at" label="Expires (optional, India time)" type="datetime-local" defaultValue={v.expires_at} error={e.expires_at} />
        </div>
      </fieldset>

      <fieldset className="space-y-4"><legend className="text-base font-semibold">Who receives it</legend>
        {published ? <Alert kind="info">The audience of a published announcement cannot be changed. Publish a new announcement for other students.</Alert> : null}
        <Select id="aud_source" label="Audience" value={source} onChange={(ev) => setSource(ev.target.value)} error={e.aud_source} disabled={published}>
          {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
        </Select>
        {published ? <input type="hidden" name="aud_source" value={source} /> : null}
        {source === "CAREER" ? <Select id="aud_career" label="Career interest" defaultValue={v.aud_career}>{CAREERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select> : null}
        {source === "DRIVE_REGISTERED" || source === "DRIVE_SHORTLISTED" || source === "DRIVE_SELECTED" ? (
          <Select id="aud_drive" label="Drive" defaultValue={v.aud_drive} error={e.aud_drive}><option value="">Choose a drive…</option>{drives.map((d) => <option key={d.id} value={d.id}>{d.company_name} — {d.job_title}</option>)}</Select>) : null}
        {source !== "NAMED" ? (
          <>
            <div role="group" aria-label="Departments" className="space-y-1.5"><p className="text-sm font-semibold">Departments{coordinator ? "" : " (none ticked = all)"}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">{departments.map((d) => (
                <label key={d.id} className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="aud_departments" value={d.id} defaultChecked={v.aud_departments.includes(d.id)} className="h-4 w-4" />{d.code}</label>))}</div></div>
            <Field id="aud_years" label="Passing years (optional)" placeholder="2026, 2027" defaultValue={v.aud_years} error={e.aud_years} />
          </>
        ) : (
          <>
            <Textarea id="aud_named" label="Register numbers (one per line or separated by commas)" rows={5} defaultValue={v.aud_named} error={e.aud_named} hint="Each number is matched to a student record. Nobody is notified from a list you have not confirmed." />
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="aud_named_confirmed" value="yes" className="mt-0.5 h-4 w-4" /> <span>I have checked that these are the intended students.</span></label>
            {e.aud_named_confirmed ? <p className="text-xs text-danger">{e.aud_named_confirmed}</p> : null}
          </>
        )}
      </fieldset>

      {published ? (
        <fieldset className="space-y-3"><legend className="text-base font-semibold">Changing a published announcement</legend>
          <Field id="reason" label="Why are you changing it?" required minLength={5} maxLength={500} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="notify" value="yes" className="h-4 w-4" /> Notify the students again about this change</label>
        </fieldset>) : null}

      <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending} pending={pending}>{pending ? "Saving…" : id ? "Save changes" : "Save draft"}</Button><Link href={backHref} className="text-sm underline">Back</Link></div>
      <p className="text-xs text-muted">Saving never notifies anyone. Students are notified only when you publish.</p>
    </form>
  );
}
