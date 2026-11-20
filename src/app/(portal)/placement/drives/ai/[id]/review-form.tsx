"use client";

import { useActionState, useRef } from "react";
import { yearOptions } from "@/lib/drives";
import { DEGREES } from "@/lib/students";
import { FIELD_BY_KEY, SECTIONS, isEmptyValue, type FieldDef, type FieldResult, type Fields, type Status } from "@/lib/intake/catalog";
import { toInput } from "@/lib/intake/edit";
import { saveIntakeAction } from "@/server/intake/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

const BADGE: Record<Status, { tone: string; label: string }> = {
  EXTRACTED: { tone: "APPROVED", label: "Extracted" }, NEEDS_REVIEW: { tone: "PENDING", label: "Needs review" }, MISSING: { tone: "NOT_STARTED", label: "Missing" },
  AMBIGUOUS: { tone: "PENDING", label: "Ambiguous" }, CONTRADICTORY: { tone: "REJECTED", label: "Contradictory" }, INVALID: { tone: "REJECTED", label: "Invalid" },
};
const input = "h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none transition-[border-color,box-shadow] duration-150 hover:border-foreground/35 focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-foreground/15";
const area = "w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-150 hover:border-foreground/35 focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-foreground/15";

const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v ?? ""));
const ORIGIN: Record<string, string> = { RULE: "pattern reader", MODEL: "AI assistant", BOTH: "pattern reader and AI assistant agree", HUMAN: "staff", NONE: "" };

function Control({ def, f, error, departments, disabled }: { def: FieldDef; f: FieldResult | undefined; error?: string; departments: { id: string; code: string; name: string }[]; disabled: boolean }) {
  const name = `f.${def.key}`; const id = `f-${def.key}`; const v = toInput(def, f?.value ?? null);
  const aria = { "aria-invalid": error ? true : undefined, "aria-describedby": `${id}-meta` } as const;
  if (def.kind === "enum") return <select id={id} name={name} defaultValue={v} disabled={disabled} className={input} {...aria}><option value="">— not set —</option>{def.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  if (def.kind === "longtext" || def.kind === "list") return <textarea id={id} name={name} defaultValue={v} rows={def.kind === "list" ? 3 : 4} maxLength={(def.max ?? 3000) + 500} disabled={disabled} className={area} {...aria} />;
  if (def.kind === "departments" || def.kind === "years" || def.kind === "degrees") {
    const chosen = new Set((Array.isArray(f?.value) ? f!.value : []).map(String));
    const opts: { value: string; label: string }[] = def.kind === "departments" ? departments.map((d) => ({ value: d.code, label: d.code })) : def.kind === "degrees" ? DEGREES.map((d) => ({ value: d, label: d })) : [...new Set([...yearOptions(), ...[...chosen].map(Number)])].sort().map((y) => ({ value: String(y), label: String(y) }));
    return (
      <ul id={id} className="flex flex-wrap gap-x-5 gap-y-1" aria-labelledby={`l-${def.key}`}>{opts.map((o) => (
        <li key={o.value} className="flex items-center gap-2 text-sm"><input id={`${id}-${o.value}`} type="checkbox" name={name} value={o.value} defaultChecked={chosen.has(o.value)} disabled={disabled} className="h-4 w-4" /><label htmlFor={`${id}-${o.value}`}>{o.label}</label></li>))}</ul>
    );
  }
  if (def.kind === "datetime") return <input id={id} name={name} defaultValue={v} disabled={disabled} className={input} placeholder="YYYY-MM-DDTHH:mm" inputMode="numeric" pattern="\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?" {...aria} />;
  return <input id={id} name={name} defaultValue={v} disabled={disabled} className={input} maxLength={(def.max ?? 200) + 200} inputMode={def.kind === "number" ? "decimal" : def.kind === "int" ? "numeric" : undefined} {...aria} />;
}

function FieldRow({ def, f, error, departments, disabled, onPick }: { def: FieldDef; f: FieldResult | undefined; error?: string; departments: { id: string; code: string; name: string }[]; disabled: boolean; onPick: (key: string, value: unknown) => void }) {
  const status: Status = f?.status ?? "MISSING"; const b = BADGE[status];
  const needs = !!f && f.needsVerification && !f.human && !isEmptyValue(f.value);
  const multi = def.kind === "departments" || def.kind === "years" || def.kind === "degrees";
  return (
    <div className="space-y-1.5 border-t border-border pt-4 first:border-0 first:pt-0" data-field={def.key} data-status={status}>
      <div className="flex flex-wrap items-center gap-2">
        {multi ? <span id={`l-${def.key}`} className="text-sm font-semibold">{def.label}{def.mandatory ? <span aria-hidden="true"> *</span> : null}</span>
          : <label htmlFor={`f-${def.key}`} id={`l-${def.key}`} className="text-sm font-semibold">{def.label}{def.mandatory ? <span aria-hidden="true"> *</span> : null}</label>}
        <StatusBadge value={b.tone} label={b.label} />
        {def.eligibility ? <span className="rounded-full bg-tint px-2 py-0.5 text-xs text-muted">decides eligibility</span> : null}
        {f?.human ? <span className="text-xs text-muted">edited or confirmed by staff</span> : f && f.origin !== "NONE" && f.reliability !== "NONE" ? <span className="text-xs text-muted">reliability {f.reliability.toLowerCase()} · {ORIGIN[f.origin]}</span> : null}
      </div>
      <Control def={def} f={f} error={error} departments={departments} disabled={disabled} />
      <div id={`f-${def.key}-meta`} className="space-y-1 text-xs">
        {error ? <p className="text-danger" role="alert">{error}</p> : null}
        {def.hint ? <p className="text-muted">{def.hint}</p> : null}
        {f?.note ? <p className="text-muted">{f.note}</p> : null}
        {f?.evidence ? <blockquote className="border-l-2 border-border pl-2 text-muted"><span className="sr-only">Source text: </span>“{f.evidence}”</blockquote> : f?.status === "MISSING" ? <p className="text-muted">Not provided in the announcement.</p> : null}
        {f?.alternatives?.length ? (
          <div className="space-y-1 rounded-lg border border-danger/40 bg-danger/5 p-2" role="group" aria-label={`Conflicting values for ${def.label}`}>
            <p className="font-medium text-danger">Conflicting values were found. Pick one (or type another) — nothing was chosen for you.</p>
            <ul className="space-y-1">{f.alternatives.map((a, i) => (
              <li key={i} className="flex flex-wrap items-start gap-2"><Button type="button" variant="secondary" className="h-8 px-3 text-xs" disabled={disabled} onClick={() => onPick(def.key, a.value)}>Use {show(a.value)}</Button><span className="text-muted">“{a.evidence}”</span></li>))}</ul>
          </div>) : null}
        {needs && !disabled ? <label className="flex items-center gap-2 font-medium"><input type="checkbox" name={`c.${def.key}`} value="yes" className="h-4 w-4" /> I checked this against the announcement and it is correct</label> : null}
      </div>
    </div>
  );
}

export function ReviewForm({ id, fields, departments, readOnly }: { id: string; fields: Fields; departments: { id: string; code: string; name: string }[]; readOnly: boolean }) {
  const [state, run, pending] = useActionState(saveIntakeAction, undefined);
  const form = useRef<HTMLFormElement>(null);
  const e = state?.fieldErrors ?? {};
  const pick = (key: string, value: unknown) => {
    const els = form.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="f.${key}"]`); if (!els) return;
    const arr = Array.isArray(value) ? value.map(String) : [String(value)];
    els.forEach((el) => { if (el instanceof HTMLInputElement && el.type === "checkbox") el.checked = arr.includes(el.value); else el.value = Array.isArray(value) && FIELD_BY_KEY[key].kind === "list" ? value.join("\n") : Array.isArray(value) ? value.join(",") : String(value); });
  };
  return (
    <form ref={form} action={run} className="space-y-6" noValidate>
      <input type="hidden" name="id" value={id} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      {state?.notes?.length ? <Alert kind="info"><ul className="list-disc pl-4">{state.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></Alert> : null}
      {SECTIONS.map((sec, i) => {
        const defs = Object.values(FIELD_BY_KEY).filter((d) => d.section === sec.id);
        return (
          <fieldset key={sec.id} className="space-y-4 card p-5" data-section={sec.id}>
            <legend className="px-2 text-lg font-semibold">{i + 1}. {sec.title}</legend>
            {defs.map((d) => <FieldRow key={d.key} def={d} f={fields[d.key]} error={e[d.key]} departments={departments} disabled={readOnly} onPick={pick} />)}
          </fieldset>
        );
      })}
      {!readOnly ? <div className="sticky bottom-3 z-10 flex justify-end"><Button type="submit" disabled={pending} className="shadow-lg">{pending ? "Saving…" : "Save changes to the draft"}</Button></div> : null}
    </form>
  );
}
