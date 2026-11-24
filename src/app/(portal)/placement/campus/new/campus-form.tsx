"use client";

import { useActionState, useState } from "react";
import { ROUND_SUGGESTIONS } from "@/lib/campus";
import { createCampusEventAction } from "@/server/campus/actions";
import type { PostedDrive } from "@/server/campus/queries";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Round = { key: number; name: string; at: string };
let nextKey = 100;

/** Step-free single page: who the drive is for, when and where, who may attend, and the rounds. Creating it generates every round's attendance link. */
export function CampusForm({ drives, departments, years }: { drives: PostedDrive[]; departments: { id: string; code: string; name: string }[]; years: number[] }) {
  const [state, action, pending] = useActionState(createCampusEventAction, undefined);
  const v = state?.values ?? {}; const e = state?.fieldErrors ?? {};
  const [mode, setMode] = useState<"posted" | "new">(v.mode === "new" || drives.length === 0 ? "new" : "posted");
  const [rounds, setRounds] = useState<Round[]>([{ key: 1, name: ROUND_SUGGESTIONS[0], at: "" }, { key: 2, name: ROUND_SUGGESTIONS[2], at: "" }]);
  const setRound = (k: number, p: Partial<Round>) => setRounds((rs) => rs.map((r) => (r.key === k ? { ...r, ...p } : r)));
  return (
    <form action={action} className="max-w-3xl space-y-6" noValidate>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <input type="hidden" name="mode" value={mode} />

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">1. Which drive is this for?</legend>
        <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Drive source">
          {([["posted", "A drive already posted on CampusConnect"], ["new", "A new company / drive"]] as const).map(([m, label]) => (
            <label key={m} className={`cursor-pointer rounded-xl border px-4 py-2.5 text-sm ${mode === m ? "border-foreground bg-brand/30 font-semibold" : "border-border bg-surface"} ${m === "posted" && drives.length === 0 ? "opacity-50" : ""}`}>
              <input type="radio" className="sr-only" name="modeChoice" checked={mode === m} disabled={m === "posted" && drives.length === 0} onChange={() => setMode(m)} />{label}
            </label>
          ))}
        </div>
        {mode === "posted" ? (
          <>
            <Select id="driveId" label="Posted drive" defaultValue={v.driveId ?? ""} error={e.driveId}>
              <option value="">Choose a drive…</option>
              {drives.map((d) => <option key={d.id} value={d.id}>{d.company_name} — {d.job_title}{d.status === "CLOSED" ? " (registration closed)" : ""}</option>)}
            </Select>
            <p className="text-xs text-muted">Only students registered for that drive can mark attendance in round 1. You can still add a walk-in by hand.</p>
          </>
        ) : (
          <>
            <Field id="company" label="Company name" required maxLength={150} defaultValue={v.company} error={e.company} />
            <p className="text-xs text-muted">Every student of the college can mark attendance in round 1, unless you narrow it below.</p>
          </>
        )}
        <Field id="title" label="Title (optional)" maxLength={150} defaultValue={v.title} hint="Shown to students. Leave empty to use “<Company> campus drive”." />
        <Textarea id="details" label="Details for students (optional)" rows={4} maxLength={3000} defaultValue={v.details} hint="Role, package, what to bring, dress code…" />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">2. When and where</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="at" label="Date and time (IST)" type="datetime-local" required defaultValue={v.at} error={e.at} />
          <Field id="venue" label="Venue" maxLength={200} defaultValue={v.venue} hint="e.g. Seminar Hall, Block B" />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">3. Who may attend round 1 (optional)</legend>
        <p className="text-xs text-muted">Leave everything unticked to allow every department and batch (the years follow the calendar).</p>
        <ul className="flex flex-wrap gap-x-5 gap-y-1">
          {departments.map((d) => <li key={d.id}><label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="dept" value={d.id} />{d.code}</label></li>)}
        </ul>
        <p className="text-sm font-semibold">Passing year (batch)</p>
        <ul className="flex flex-wrap gap-x-5 gap-y-1">
          {years.map((y) => <li key={y}><label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="year" value={y} />{y}</label></li>)}
        </ul>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">4. Rounds</legend>
        <p className="text-xs text-muted">Each round gets its own attendance link. Students reach round 2 only when you mark them eligible after round 1, and so on. You can add more rounds later.</p>
        {e.rounds ? <Alert kind="error">{e.rounds}</Alert> : null}
        <ol className="space-y-3">
          {rounds.map((r, i) => (
            <li key={r.key} className="grid gap-3 rounded-xl border border-border bg-surface p-3 sm:grid-cols-[1fr_14rem_auto] sm:items-end">
              <Field id={`roundName-${r.key}`} name="roundName" label={`Round ${i + 1} name`} value={r.name} maxLength={100} list="round-suggestions" onChange={(ev) => setRound(r.key, { name: ev.target.value })} />
              <Field id={`roundAt-${r.key}`} name="roundAt" label="Time (optional)" type="datetime-local" value={r.at} onChange={(ev) => setRound(r.key, { at: ev.target.value })} />
              <Button type="button" variant="secondary" disabled={rounds.length === 1} onClick={() => setRounds((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove round ${i + 1}`}>Remove</Button>
            </li>
          ))}
        </ol>
        <datalist id="round-suggestions">{ROUND_SUGGESTIONS.map((n) => <option key={n} value={n} />)}</datalist>
        {rounds.length < 10 ? <Button type="button" variant="secondary" onClick={() => setRounds((rs) => [...rs, { key: nextKey++, name: "", at: "" }])}>+ Add a round</Button> : null}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} pending={pending}>{pending ? "Creating…" : "Create on-campus drive"}</Button>
        <p className="text-xs text-muted">You will get the attendance links on the next page.</p>
      </div>
    </form>
  );
}
