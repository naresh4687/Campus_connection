"use client";

import { useActionState, useState } from "react";
import { decidePlacementAction, extendDeadlineAction, issueOfferAction, overridePlacementAction, recordJoiningAction, respondAction, selectStudentsAction, withdrawOfferAction } from "@/server/offers/actions";
import type { ActionState } from "@/server/action-utils";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { Candidate } from "@/server/offers/queries";

type Act = (p: ActionState, fd: FormData) => Promise<ActionState>;
const hidden = (f: Record<string, string>) => Object.entries(f).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
const inputCls = "h-10 rounded-md border border-border bg-surface px-3 text-sm";

/** Native multipart form (the browser posts the file straight to the upload route). The size check here is a convenience; the server re-validates everything. */
export function FileUpload({ action, label, button }: { action: string; label: string; button: string }) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form action={action} method="post" encType="multipart/form-data" className="space-y-2" onSubmit={(e) => { if (problem) e.preventDefault(); }}>
      {problem ? <Alert kind="error">{problem}</Alert> : null}
      <div className="space-y-1"><label htmlFor={`f-${action}`} className="block text-sm font-medium">{label}</label>
        <input id={`f-${action}`} name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          onChange={(e) => { const f = e.target.files?.[0]; setProblem(f && f.size > MAX_DOCUMENT_BYTES ? "That file is larger than 5 MB." : null); }}
          className="block w-full text-sm file:mr-3 file:h-10 file:rounded-md file:border file:border-border file:bg-surface file:px-4 file:text-sm" />
        <p className="text-xs text-muted">PDF, PNG or JPEG, up to 5 MB. The content is checked; files are not virus-scanned yet.</p></div>
      <Button type="submit" variant="secondary">{button}</Button>
    </form>
  );
}

export function SelectStudentsForm({ driveId, candidates }: { driveId: string; candidates: Candidate[] }) {
  const [state, run, pending] = useActionState(selectStudentsAction, undefined);
  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="driveId" value={driveId} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <ul className="space-y-1 text-sm" aria-label="Students who can be selected">
        {candidates.map((c) => (<li key={c.registration_id}><label className="flex items-center gap-2"><input type="checkbox" name="regs" value={c.registration_id} /><span className="font-medium">{c.full_name}</span><span className="text-muted">{c.register_number} · {c.department_code}</span></label></li>))}
      </ul>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record selection for ticked students"}</Button>
    </form>
  );
}

export function IssueOfferForm({ driveId, selectionId, letterId }: { driveId: string; selectionId: string; letterId: string | null }) {
  const [state, run, pending] = useActionState(issueOfferAction, undefined);
  return (
    <form action={run} className="space-y-2">
      {hidden({ driveId, selectionId, ...(letterId ? { letterId } : {}) })}
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><label htmlFor={`ctc-${selectionId}`} className="block text-sm font-medium">CTC offered (LPA)</label><input id={`ctc-${selectionId}`} name="ctc" inputMode="decimal" defaultValue={state?.values?.ctc ?? ""} className={`${inputCls} w-32`} /></div>
        <div className="space-y-1"><label htmlFor={`dl-${selectionId}`} className="block text-sm font-medium">Response deadline (IST)</label><input id={`dl-${selectionId}`} name="deadline" type="datetime-local" defaultValue={state?.values?.deadline ?? ""} className={inputCls} /></div>
        <Button type="submit" disabled={pending}>{pending ? "Issuing…" : "Issue offer"}</Button>
      </div>
      {!letterId ? <p className="text-xs text-muted">No offer letter is attached. You can attach one before issuing.</p> : <p className="text-xs text-muted">The latest uploaded letter will be attached.</p>}
    </form>
  );
}

export function ExtendForm({ driveId, selectionId }: { driveId: string; selectionId: string }) {
  const [state, run, pending] = useActionState(extendDeadlineAction, undefined);
  return (
    <form action={run} className="space-y-2">
      {hidden({ driveId, selectionId })}
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <div className="flex flex-wrap items-end gap-3"><div className="space-y-1"><label htmlFor={`ext-${selectionId}`} className="block text-sm font-medium">New response deadline (IST)</label><input id={`ext-${selectionId}`} name="deadline" type="datetime-local" className={inputCls} /></div>
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Extend deadline"}</Button></div>
    </form>
  );
}

/** One reason box with a submit button; used where the action is final and needs an explanation (withdraw, reject, override). */
export function ReasonForm({ kind, fields, label, button, hint }: { kind: "withdraw" | "reject" | "override-verify" | "override-reject"; fields: Record<string, string>; label: string; button: string; hint?: string }) {
  const act: Act = kind === "withdraw" ? withdrawOfferAction : kind === "reject" ? decidePlacementAction : overridePlacementAction;
  const extra: Record<string, string> = kind === "reject" ? { decision: "REJECTED" } : kind === "override-verify" ? { decision: "VERIFIED" } : kind === "override-reject" ? { decision: "REJECTED" } : {};
  const [state, run, pending] = useActionState(act, undefined);
  const id = `reason-${kind}-${fields.selectionId}`;
  return (
    <form action={run} className="space-y-2">
      {hidden({ ...fields, ...extra })}
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <div className="space-y-1"><label htmlFor={id} className="block text-sm font-medium">{label}</label>
        <input id={id} name="reason" maxLength={500} defaultValue={state?.values?.reason ?? ""} className={`${inputCls} w-full max-w-md`} />{hint ? <p className="text-xs text-muted">{hint}</p> : null}</div>
      <Button type="submit" variant="danger" disabled={pending}>{pending ? "Saving…" : button}</Button>
    </form>
  );
}

export function VerifyForm({ selectionId, override = false }: { selectionId: string; override?: boolean }) {
  const [state, run, pending] = useActionState(override ? overridePlacementAction : decidePlacementAction, undefined);
  return (
    <form action={run} className="space-y-2">
      {hidden({ selectionId, decision: "VERIFIED" })}
      {override ? <div className="space-y-1"><label htmlFor={`vr-${selectionId}`} className="block text-sm font-medium">Reason for the override</label><input id={`vr-${selectionId}`} name="reason" maxLength={500} className={`${inputCls} w-full max-w-md`} /></div> : null}
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : override ? "Override: mark as verified" : "Verify placement"}</Button>
    </form>
  );
}

export function RespondForm({ selectionId }: { selectionId: string }) {
  const [state, run, pending] = useActionState(respondAction, undefined);
  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="selectionId" value={selectionId} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <p className="text-sm text-muted">Your answer is final. You cannot change it afterwards.</p>
      <div className="flex gap-3">
        <Button type="submit" name="accept" value="yes" disabled={pending}>Accept this offer</Button>
        <Button type="submit" name="accept" value="no" variant="secondary" disabled={pending}>Decline this offer</Button>
      </div>
    </form>
  );
}

export function JoiningForm({ selectionId, proofId, initial }: { selectionId: string; proofId: string | null; initial?: Record<string, string> }) {
  const [state, run, pending] = useActionState(recordJoiningAction, undefined);
  const v = { ...(initial ?? {}), ...(state?.values ?? {}) };
  return (
    <form action={run} className="space-y-3">
      {hidden({ selectionId, ...(proofId ? { fileId: proofId } : {}) })}
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><label htmlFor="joinedOn" className="block text-sm font-medium">Date you joined</label><input id="joinedOn" name="joinedOn" type="date" defaultValue={v.joinedOn ?? ""} className={`${inputCls} w-full`} required /></div>
        <div className="space-y-1"><label htmlFor="designation" className="block text-sm font-medium">Designation (optional)</label><input id="designation" name="designation" maxLength={150} defaultValue={v.designation ?? ""} className={`${inputCls} w-full`} /></div>
      </div>
      <div className="space-y-1"><label htmlFor="note" className="block text-sm font-medium">Note (optional)</label><input id="note" name="note" maxLength={500} defaultValue={v.note ?? ""} className={`${inputCls} w-full`} /></div>
      {!proofId ? <p className="text-sm text-muted">Upload your joining proof above first.</p> : null}
      <Button type="submit" disabled={pending || !proofId}>{pending ? "Saving…" : "Record joining"}</Button>
    </form>
  );
}
