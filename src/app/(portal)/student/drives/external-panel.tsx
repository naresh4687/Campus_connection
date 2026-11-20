"use client";

import { useActionState } from "react";
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

/** A plain multipart form: it works on every phone, lets the student pick from the gallery or files, and needs no scripts. */
export function UploadScreenshot({ id, replace }: { id: string; replace: boolean }) {
  return (
    <form action={`/student/drives/${id}/evidence`} method="post" encType="multipart/form-data" className="space-y-2">
      <label htmlFor="evidence-file" className="block text-sm font-semibold">{replace ? "Upload a new screenshot" : "Screenshot of the final confirmation page"}</label>
      <input id="evidence-file" name="file" type="file" accept="image/png,image/jpeg,image/webp" required aria-describedby="evidence-hint"
        className="block w-full rounded-xl border border-border bg-surface p-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground" />
      <p id="evidence-hint" className="text-xs text-muted">PNG, JPEG or WebP, up to {MAX_EVIDENCE_MB} MB. Show the page that says your form was submitted. It is stored privately and only you and the placement staff can open it.</p>
      <button type="submit" className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground">{replace ? "Submit the new screenshot" : "Submit screenshot"}</button>
    </form>
  );
}
