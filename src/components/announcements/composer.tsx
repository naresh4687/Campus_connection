"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import Link from "next/link";
import { CATEGORY_LABEL, DESTINATION_OF, PURPOSES, PURPOSE_LABEL, classifyMessage, resolveCategory, isPurpose, type Category, type Classification, type Purpose } from "@/lib/composer/classify";
import { MAX_SOURCE_CHARS, MIN_SOURCE_CHARS } from "@/lib/intake/catalog";
import { composeAnnouncementAction } from "@/server/announcements/actions";
import { startIntakeAction } from "@/server/intake/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];

/**
 * One box for any placement message. Step 1 explains what the message looks like (suggestion only, with the quoted reasons); step 2 saves it
 * to the destination staff confirmed: a drive draft through the existing AI drive intake (officers only) or an announcement draft.
 */
export function Composer({ canCreateDrives, base }: { canCreateDrives: boolean; base: string }) {
  const [drive, runDrive, drivePending] = useActionState(startIntakeAction, undefined);
  const [ann, runAnn, annPending] = useActionState(composeAnnouncementAction, undefined);
  const [text, setText] = useState("");
  const [purpose, setPurpose] = useState<Purpose>("AUTO");
  const [result, setResult] = useState<Classification | null>(null);
  const [category, setCategory] = useState<Category>("GENERAL");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [problem, setProblem] = useState<string | null>(null);
  const state = drive?.error ? drive : ann;
  const pending = drivePending || annPending;
  const analyse = () => {
    if (text.trim().length < MIN_SOURCE_CHARS) { setProblem("Paste the message first."); return; }
    setProblem(null);
    const c = classifyMessage(text); const r = resolveCategory(purpose, c);
    setResult(c); setCategory(r.category);
  };
  const submit = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!result) { analyse(); return; }
    if (category === "NEW_DRIVE" && !canCreateDrives) { setProblem("Only placement officers can create placement drives. Choose an announcement type, or ask a placement officer."); return; }
    const fd = new FormData(ev.currentTarget);
    if (category === "NEW_DRIVE") { fd.set("announcement", text); fd.set("key", key); fd.set("sourceType", "PASTED"); startTransition(() => runDrive(fd)); }
    else { fd.set("message", text); fd.set("category", category); startTransition(() => runAnn(fd)); }
  };
  const onText = (v: string) => { setText(v); setResult(null); setKey(crypto.randomUUID()); };
  const err = problem ?? state?.error;
  return (
    <form onSubmit={submit} className="max-w-3xl space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="message" className="block text-sm font-semibold">Paste the company or placement message</label>
        <textarea id="message" rows={14} maxLength={MAX_SOURCE_CHARS + 50} value={text} onChange={(e) => onText(e.target.value)} aria-describedby="message-hint"
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 font-mono text-sm outline-none hover:border-foreground/35 focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-foreground/15" />
        <p id="message-hint" className="text-xs text-muted">Paste any recruitment announcement, interview schedule, training information, venue update or company message. Line breaks, numbering, *bold* text and links are kept. Do not paste students’ personal data.</p>
      </div>
      <Select id="purpose" label="What is this message?" value={purpose} onChange={(e) => { const p = e.target.value; if (isPurpose(p)) { setPurpose(p); setResult(null); } }}>
        {PURPOSES.map((p) => <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>)}
      </Select>
      {err ? <Alert kind="error">{err}</Alert> : null}
      {result ? (
        <section className="space-y-3 card p-4" aria-label="What this message looks like" data-testid="classification">
          <p className="text-sm"><strong>{CATEGORY_LABEL[result.category]}</strong>{result.confident ? "" : " (not certain)"} — suggested destination: <strong>{DESTINATION_OF[result.category] === "DRIVE" ? "a placement drive draft" : "a placement announcement draft"}</strong>.</p>
          {result.reasons.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{result.reasons.map((r, i) => <li key={i}>It {r.why}: <q className="text-muted">{r.quote}</q></li>)}</ul> : <p className="text-sm text-muted">No clear signals were found.</p>}
          {result.warnings.map((w) => <Alert key={w} kind="info">{w}</Alert>)}
          <Select id="category" label="Save it as" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.filter((c) => c !== "NEW_DRIVE" || canCreateDrives).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}{DESTINATION_OF[c] === "DRIVE" ? " → drive draft" : " → announcement draft"}</option>)}
          </Select>
          {!canCreateDrives && result.category === "NEW_DRIVE" ? <Alert kind="info">This looks like a new recruitment opportunity. Only placement officers can create drives. You can save it as an announcement, or pass it to a placement officer.</Alert> : null}
          <p className="text-xs text-muted">Nothing is published and nobody is notified. You will review and edit the draft first.</p>
        </section>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} pending={pending}>{pending ? "Saving the draft…" : result ? "Create the draft" : "Analyze message"}</Button>
        <Link href={`${base}/new`} className="text-sm underline">Fill in the form myself</Link>
      </div>
    </form>
  );
}
