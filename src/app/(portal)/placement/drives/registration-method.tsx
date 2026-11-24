"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { LINK_PURPOSE_LABEL, type LinkPurpose } from "@/lib/evidence";
import { setDriveRegistrationAction } from "@/server/registrations/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Props = {
  id: string; method: string; url: string; instructions: string; confirmed: boolean; review: boolean; locked: boolean;
  suggestions: { url: string; purpose: LinkPurpose; why: string }[];
};

/**
 * How students register: in CampusConnect (one click) or through the company's own form. A link in a company message is only a suggestion: the officer
 * chooses it and ticks that it really is the registration form. A company website or job-description page is never made a registration requirement by itself.
 */
export function RegistrationMethod({ id, method: m0, url: u0, instructions: i0, confirmed: c0, locked, suggestions }: Props) {
  const [state, run, pending] = useActionState(setDriveRegistrationAction, undefined);
  const [method, setMethod] = useState(m0);
  const [url, setUrl] = useState(state?.values?.url ?? u0);
  // Submitted through a transition: React resets an action form after it runs, which would clear the chosen method and ticks when a save is refused.
  const submit = (ev: FormEvent<HTMLFormElement>) => { ev.preventDefault(); const fd = new FormData(ev.currentTarget); fd.set("method", method); startTransition(() => run(fd)); };
  return (
    <form onSubmit={submit} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      {locked ? <Alert kind="info">Students have already started registering, so the method and link are fixed. You can still change the instructions below by contacting the platform team.</Alert> : null}
      <fieldset className="space-y-2" disabled={locked}>
        <legend className="text-sm font-semibold">Registration method</legend>
        <label className="flex items-start gap-2 text-sm"><input type="radio" name="method" value="INTERNAL" checked={method === "INTERNAL"} onChange={() => setMethod("INTERNAL")} className="mt-0.5 h-4 w-4" /><span><strong>Internal registration</strong> — students register in CampusConnect with one click.</span></label>
        <label className="flex items-start gap-2 text-sm"><input type="radio" name="method" value="EXTERNAL" checked={method === "EXTERNAL"} onChange={() => setMethod("EXTERNAL")} className="mt-0.5 h-4 w-4" /><span><strong>External registration</strong> — students fill in the company’s own form, then upload a screenshot of its confirmation page.</span></label>
      </fieldset>
      {method === "EXTERNAL" ? (
        <div className="space-y-3">
          {suggestions.length ? (
            <div className="space-y-1.5"><p className="text-sm font-semibold">Links found in the company message</p>
              <ul className="space-y-1.5 text-sm">{suggestions.map((l) => (
                <li key={l.url} className="rounded-xl border border-border p-2"><span className="break-all font-mono text-xs">{l.url}</span>
                  <span className="mt-0.5 block text-xs text-muted">{LINK_PURPOSE_LABEL[l.purpose]} — {l.why}</span>
                  {!locked ? <button type="button" onClick={() => setUrl(l.url)} className="mt-1 text-xs underline">Use this as the registration link</button> : null}</li>))}
              </ul></div>) : null}
          <div className="space-y-1.5"><label htmlFor="url" className="block text-sm font-semibold">External registration link</label>
            <input id="url" name="url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} disabled={locked} placeholder="https://" maxLength={500}
              className="h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm outline-none focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-foreground/15" /></div>
          <div className="space-y-1.5"><label htmlFor="instructions" className="block text-sm font-semibold">Instructions for students (optional)</label>
            <textarea id="instructions" name="instructions" rows={3} maxLength={2000} defaultValue={state?.values?.instructions ?? i0}
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-foreground/15" /></div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmed" value="yes" defaultChecked={c0} disabled={locked} className="mt-0.5 h-4 w-4" /><span>I confirm this link is the company’s actual registration form, not a company website or an information page. A drive cannot be published until this is ticked.</span></label>
        </div>
      ) : null}
      {!locked ? <Button type="submit" disabled={pending} pending={pending}>{pending ? "Saving…" : "Save registration method"}</Button> : null}
    </form>
  );
}
