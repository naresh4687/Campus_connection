"use client";

import { useActionState, useState, useSyncExternalStore, type MouseEvent } from "react";
import { addCampusRoundAction, campusRosterAction, setCampusAttendanceAction, setCampusEventStatusAction, setCampusRoundStatusAction, updateCampusEventAction } from "@/server/campus/actions";
import type { MissingRow, RosterRow } from "@/server/campus/queries";
import { ActionButton } from "@/components/ui/action-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { fmtDateTime, } from "@/lib/format";
import { isoToIstInput } from "@/lib/announcements";

const origin = () => window.location.origin;
const noop = () => () => {};

/** The round's attendance link, as a full address for the browser being used (works on a LAN address or the live site). */
export function AttendanceLink({ token, id }: { token: string; id: string }) {
  const base = useSyncExternalStore(noop, origin, () => "");
  const link = `${base}/student/campus/attend/${token}`;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-xs font-semibold">Attendance link</label>
      <input id={id} readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="h-10 w-full rounded-xl border border-border bg-background px-3 font-mono text-xs" />
      <div className="flex flex-wrap gap-3">
        <CopyButton value={link} label="Copy link" inputId={id} />
        <a href={`https://wa.me/?text=${encodeURIComponent(`Mark your attendance for the campus drive: ${link}`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-xl border border-border bg-surface px-4 text-sm font-medium hover:bg-tint">Share on WhatsApp</a>
      </div>
      <p className="text-xs text-muted">Students must be signed in. Only students who may attend this round can mark themselves present.</p>
    </div>
  );
}

/** Open / close attendance for one round. */
export function RoundToggle({ round, status }: { round: string; status: string }) {
  const [state, run, pending] = useActionState(setCampusRoundStatusAction, undefined);
  const open = status === "OPEN";
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="round" value={round} /><input type="hidden" name="status" value={open ? "CLOSED" : "OPEN"} />
      <Button type="submit" variant={open ? "secondary" : "primary"} disabled={pending}>{pending ? "Working…" : open ? "Close attendance" : status === "CLOSED" ? "Reopen attendance" : "Open attendance"}</Button>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
    </form>
  );
}

/** Who is present in this round: tick students, then move them to the next round (or take them back out), or mark them absent. */
export function RosterForm({ round, roundNumber, hasNext, rows, isLast }: { round: string; roundNumber: number; hasNext: boolean; rows: RosterRow[]; isLast: boolean }) {
  const [state, run, pending] = useActionState(campusRosterAction, undefined);
  // Runs on click, before the form is submitted: records which of the three buttons was pressed in the hidden "intent" field.
  const press = (v: string) => (ev: MouseEvent<HTMLButtonElement>) => { const f = ev.currentTarget.form?.elements.namedItem("intent"); if (f instanceof HTMLInputElement) f.value = v; };
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const all = rows.length > 0 && picked.size === rows.length;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const busy = pending;
  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="round" value={round} /><input type="hidden" name="intent" defaultValue="" />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      {rows.length === 0 ? <p className="text-sm text-muted">Nobody has marked attendance for this round yet. Share the link above, or add students by hand below.</p> : (
        <>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Actions for the ticked students">
            <Button type="submit" onClick={press("advance")} disabled={busy || picked.size === 0}>{isLast ? "Mark eligible for the next round" : `Mark eligible for round ${roundNumber + 1}`}</Button>
            <Button type="submit" variant="secondary" onClick={press("unadvance")} disabled={busy || picked.size === 0}>Remove from next round</Button>
            <Button type="submit" variant="danger" onClick={press("absent")} disabled={busy || picked.size === 0}>Mark absent</Button>
            <span className="text-xs text-muted" aria-live="polite">{picked.size} selected</span>
          </div>
          {!hasNext ? <p className="text-xs text-muted">There is no round {roundNumber + 1} yet — add it below first, so these students can be told and can mark attendance there.</p> : null}
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="bg-nav text-xs uppercase tracking-wider text-nav-foreground"><tr>
                <th scope="col" className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Select all students" checked={all} onChange={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.student_id)))} /></th>
                <th scope="col" className="px-3 py-2.5">Student</th><th scope="col" className="px-3 py-2.5">Register no.</th><th scope="col" className="px-3 py-2.5">Dept</th><th scope="col" className="px-3 py-2.5">Checked in</th><th scope="col" className="px-3 py-2.5">Next round</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.student_id}>
                    <td className="px-3 py-2.5"><input type="checkbox" name="student" value={r.student_id} checked={picked.has(r.student_id)} onChange={() => toggle(r.student_id)} aria-label={`Select ${r.full_name}`} /></td>
                    <td className="px-3 py-2.5 font-medium">{r.full_name}</td><td className="px-3 py-2.5">{r.register_number}</td><td className="px-3 py-2.5">{r.department_code}</td>
                    <td className="px-3 py-2.5">{fmtDateTime(r.marked_at)}<span className="block text-xs text-muted">{r.method === "SELF" ? "By the student" : "Added by you"}</span></td>
                    <td className="px-3 py-2.5">{r.advanced ? <strong>Eligible</strong> : <span className="text-muted">—</span>}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </form>
  );
}

/** Students who may attend but are not marked present (late arrivals, phone trouble). Search by name or register number. */
export function ManualAdd({ round, roundNumber, rows, q, base }: { round: string; roundNumber: number; rows: MissingRow[]; q: string; base: string }) {
  const [state, run, pending] = useActionState(setCampusAttendanceAction, undefined);
  return (
    <div className="space-y-3">
      <form method="get" action={base} className="flex flex-wrap items-end gap-3" role="search">
        <input type="hidden" name="round" value={roundNumber} />
        <div className="w-full max-w-xs"><Field id="q" label="Find a student" defaultValue={q} placeholder="Name or register number" /></div>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}{state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      {rows.length === 0 ? <p className="text-sm text-muted">{q ? "No matching student who is not already present." : "Everyone who may attend is already marked present. Search to add someone else by hand (round 1 only)."}</p> : (
        <form action={run} className="space-y-2">
          <input type="hidden" name="round" value={round} /><input type="hidden" name="present" value="1" />
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-2xl border border-border bg-surface">
            {rows.map((r) => (
              <li key={r.student_id}><label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"><input type="checkbox" name="student" value={r.student_id} />
                <span className="font-medium">{r.full_name}</span><span className="text-muted">{r.register_number} · {r.department_code} · {r.passing_year}</span></label></li>))}
          </ul>
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Mark ticked students present"}</Button>
        </form>
      )}
    </div>
  );
}

/** Edit the details of the drive, and complete / cancel / reopen it. */
export function EventControls({ id, title, details, venue, eventAt, status }: { id: string; title: string; details: string | null; venue: string | null; eventAt: string; status: string }) {
  const [state, run, pending] = useActionState(updateCampusEventAction, undefined);
  const v = { title, details: details ?? "", venue: venue ?? "", at: isoToIstInput(eventAt), ...(state?.values ?? {}) }; const e = state?.fieldErrors ?? {};
  return (
    <div className="space-y-4">
      <form action={run} className="max-w-2xl space-y-3" noValidate>
        <input type="hidden" name="id" value={id} />
        {state?.error ? <Alert kind="error">{state.error}</Alert> : null}{state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
        <Field id="title" label="Title" defaultValue={v.title} error={e.title} maxLength={150} />
        <div className="grid gap-3 sm:grid-cols-2"><Field id="at" label="Date and time (IST)" type="datetime-local" defaultValue={v.at} error={e.at} /><Field id="venue" label="Venue" defaultValue={v.venue} maxLength={200} /></div>
        <Textarea id="details" label="Details for students" rows={3} defaultValue={v.details} maxLength={3000} />
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
      </form>
      <div className="flex flex-wrap items-start gap-3 border-t border-border pt-4">
        {status === "UPCOMING" ? (
          <>
            <ActionButton action={setCampusEventStatusAction} fields={{ id, status: "COMPLETED" }} label="Mark completed (closes attendance)" />
            <ActionButton action={setCampusEventStatusAction} fields={{ id, status: "CANCELLED" }} label="Cancel this drive" variant="danger" />
          </>
        ) : <ActionButton action={setCampusEventStatusAction} fields={{ id, status: "UPCOMING" }} label="Reopen this drive" />}
      </div>
    </div>
  );
}

export function AddRoundForm({ id, next }: { id: string; next: number }) {
  const [state, run, pending] = useActionState(addCampusRoundAction, undefined);
  const e = state?.fieldErrors ?? {};
  return (
    <form action={run} key={state?.ok ?? "f"} className="grid max-w-2xl gap-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end" noValidate>
      <input type="hidden" name="id" value={id} />
      <Field id="name" label={`Round ${next} name`} placeholder="e.g. Technical interview" maxLength={100} error={e.name} />
      <Field id="at" label="Time (optional)" type="datetime-local" error={e.at} />
      <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add round"}</Button>
      <div className="sm:col-span-3">{state?.error && !e.name && !e.at ? <Alert kind="error">{state.error}</Alert> : null}{state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}</div>
    </form>
  );
}
