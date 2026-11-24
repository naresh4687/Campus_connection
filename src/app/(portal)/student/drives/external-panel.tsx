"use client";

import { useActionState, useState, type FormEvent } from "react";
import { MAX_EVIDENCE_MB } from "@/lib/evidence";
import { beginExternalAction } from "@/server/registrations/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function StartExternal({ id }: { id: string }) {
  const [state, run, pending] = useActionState(beginExternalAction, undefined);
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending} pending={pending}>{pending ? "Checking your eligibility…" : "Register through company website"}</Button>
      <p className="text-xs text-muted">We check your eligibility first. Then you fill in the company’s own form and come back here to upload a screenshot of its confirmation page.</p>
    </form>
  );
}

/**
 * A plain multipart form, so it still works without scripts. With scripts it posts via fetch instead: a native form post carries `Origin: null`
 * (our Referrer-Policy is no-referrer) and, on a plain-http address such as the dev server opened by LAN IP, no Sec-Fetch-Site either, so the
 * same-origin check refused it ("Forbidden"). A fetch carries the real Origin. The route answers with the path of the drive page (JSON), and we go there.
 */
export function UploadScreenshot({ id, replace }: { id: string; replace: boolean }) {
  const action = `/student/drives/${id}/evidence`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch(action, { method: "POST", body: new FormData(ev.currentTarget), credentials: "same-origin", headers: { Accept: "application/json" } });
      const body = res.ok ? ((await res.json().catch(() => null)) as { to?: string } | null) : null;
      if (body?.to && body.to.startsWith("/student/drives/")) { window.location.assign(body.to); return; }
      setError(res.status === 403 ? "You are not allowed to do that. Sign in again as the student and retry." : "The screenshot could not be uploaded. Please try again.");
    } catch { setError("The upload failed. Check your connection and try again."); }
    setBusy(false);
  };
  return (
    <form action={action} method="post" encType="multipart/form-data" onSubmit={submit} className="space-y-2">
      {error ? <Alert kind="error">{error}</Alert> : null}
      <label htmlFor="evidence-file" className="block text-sm font-semibold">{replace ? "Upload a new screenshot" : "Screenshot of the final confirmation page"}</label>
      <input id="evidence-file" name="file" type="file" accept="image/png,image/jpeg,image/webp" required aria-describedby="evidence-hint"
        className="block w-full rounded-xl border border-border bg-surface p-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground" />
      <p id="evidence-hint" className="text-xs text-muted">PNG, JPEG or WebP, up to {MAX_EVIDENCE_MB} MB. Show the page that says your form was submitted. It is stored privately and only you and the placement staff can open it.</p>
      <button type="submit" disabled={busy} className="inline-flex h-10 disabled:opacity-60 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground">{busy ? "Uploading…" : replace ? "Submit the new screenshot" : "Submit screenshot"}</button>
    </form>
  );
}
