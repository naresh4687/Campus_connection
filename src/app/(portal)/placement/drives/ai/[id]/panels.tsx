"use client";

import { useActionState } from "react";
import type { DiffRow } from "@/lib/intake/edit";
import { applyPendingAction, discardIntakeAction, publishIntakeAction, reextractAction, retryIntakeAction } from "@/server/intake/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join(", ") : String(v));

export function RetryButton({ id }: { id: string }) {
  const [state, run, pending] = useActionState(retryIntakeAction, undefined);
  return (<form action={run} className="space-y-2"><input type="hidden" name="id" value={id} />{state?.error ? <Alert kind="error">{state.error}</Alert> : null}<Button type="submit" disabled={pending} pending={pending}>{pending ? "Reading the announcement…" : "Try the extraction again"}</Button></form>);
}

export function ReextractButton({ id, disabled }: { id: string; disabled: boolean }) {
  const [state, run, pending] = useActionState(reextractAction, undefined);
  return (
    <form action={run} className="space-y-2"><input type="hidden" name="id" value={id} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}{state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <Button type="submit" variant="secondary" disabled={pending || disabled} pending={pending}>{pending ? "Reading again…" : "Read the announcement again"}</Button>
      <p className="text-xs text-muted">Your corrections are never overwritten. New readings appear as a comparison and you choose what to take.</p>
    </form>
  );
}

export function DiffPanel({ id, rows, modelLabel }: { id: string; rows: DiffRow[]; modelLabel: string }) {
  const [state, run, pending] = useActionState(applyPendingAction, undefined);
  const KIND = { NEW: "New information", CHANGED: "Different from before", KEEP_YOURS: "Different from YOUR value" } as const;
  return (
    <form action={run} className="space-y-3" aria-label="Compare the new reading">
      <input type="hidden" name="id" value={id} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}{state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <p className="text-sm">A new reading ({modelLabel}) differs from the draft in {rows.length} field{rows.length === 1 ? "" : "s"}. Nothing is replaced unless you tick it. Values you entered are marked and are never replaced by default.</p>
      {rows.length ? <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-left text-sm"><caption className="sr-only">Differences</caption>
        <thead className="bg-background text-xs text-muted"><tr><th className="px-3 py-2">Use new</th><th className="px-3 py-2">Field</th><th className="px-3 py-2">Now</th><th className="px-3 py-2">New reading</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.key} className="border-t border-border align-top">
            <td className="px-3 py-2"><input type="checkbox" name="take" value={r.key} id={`take-${r.key}`} className="h-4 w-4" aria-label={`Use the new value for ${r.label}`} /></td>
            <td className="px-3 py-2"><label htmlFor={`take-${r.key}`} className="font-medium">{r.label}</label><div className="text-xs text-muted">{KIND[r.kind]}</div></td>
            <td className="px-3 py-2">{show(r.current?.value)}{r.current?.human ? <span className="block text-xs text-muted">entered by staff</span> : null}</td>
            <td className="px-3 py-2">{r.proposed.status === "CONTRADICTORY" ? "Conflicting values" : show(r.proposed.value)}<span className="block text-xs text-muted">“{r.proposed.evidence.slice(0, 160)}”</span></td>
          </tr>))}</tbody></table></div> : null}
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={pending} pending={pending}>Replace the ticked values</Button></div>
    </form>
  );
}

export function PublishPanel({ id, ready, problems }: { id: string; ready: boolean; problems: string[] }) {
  const [state, run, pending] = useActionState(publishIntakeAction, undefined);
  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      {state?.error ? <Alert kind="error">{state.error}{state.notes?.length ? <ul className="mt-1 list-disc pl-4">{state.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}</Alert> : null}
      {!ready ? <Alert kind="info"><p className="font-medium">Not ready to publish yet:</p><ul className="list-disc pl-4">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul></Alert> : null}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" value="yes" className="mt-0.5 h-4 w-4" disabled={!ready} /> <span>I have checked the preview against the company’s announcement. I understand publishing makes this drive visible to eligible students and notifies them.</span></label>
      <Button type="submit" disabled={!ready || pending} pending={pending}>{pending ? "Publishing…" : "Publish drive"}</Button>
      <p className="text-xs text-muted">Only you can publish. Eligibility is calculated by the platform from the criteria above and each student’s verified record, never by the AI.</p>
    </form>
  );
}

export function DiscardButton({ id }: { id: string }) {
  const [state, run, pending] = useActionState(discardIntakeAction, undefined);
  return (<form action={run} className="space-y-2"><input type="hidden" name="id" value={id} />{state?.error ? <Alert kind="error">{state.error}</Alert> : null}<Button type="submit" variant="danger" disabled={pending}>Discard this announcement</Button></form>);
}
