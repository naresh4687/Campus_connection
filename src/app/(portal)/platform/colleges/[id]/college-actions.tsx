"use client";

import { useActionState } from "react";
import { issueAdminInvitationAction, setCollegeAccessAction, setCommercialStatusAction } from "@/server/platform/actions";
import { COMMERCIAL_STATUSES } from "@/lib/validation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InviteLinkPanel } from "@/components/ui/invite-link-panel";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const label = (v: string) => v.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function CommercialForm({ id, current, note }: { id: string; current: string; note: string | null }) {
  const [state, action, pending] = useActionState(setCommercialStatusAction, undefined);
  return (
    <form action={action} className="max-w-md space-y-3">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <input type="hidden" name="id" value={id} />
      <Select id="status" label="Commercial status" defaultValue={current}>
        {COMMERCIAL_STATUSES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
      </Select>
      <Textarea id="note" label="Internal note (not visible to the college)" rows={3} maxLength={1000} defaultValue={state?.values?.note ?? note ?? ""} />
      <p className="text-xs text-muted">A manual record only: no payment is processed, and this does not by itself block access. Use suspension for that.</p>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save commercial status"}</Button>
    </form>
  );
}

export function AccessForm({ id, status, reason }: { id: string; status: string; reason: string | null }) {
  const [state, action, pending] = useActionState(setCollegeAccessAction, undefined);
  const suspended = status === "SUSPENDED";
  return (
    <form action={action} className="max-w-md space-y-3">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={suspended ? "ACTIVE" : "SUSPENDED"} />
      {suspended ? (
        <>
          <p className="text-sm">Suspended. Reason on record: <span className="whitespace-pre-wrap font-medium">{reason}</span></p>
          <Button type="submit" disabled={pending}>{pending ? "Reactivating…" : "Reactivate college"}</Button>
        </>
      ) : (
        <>
          <Textarea id="reason" label="Reason for suspension" rows={3} required minLength={5} maxLength={1000} defaultValue={state?.values?.reason}
            hint="Suspending signs out every user of this college and blocks sign-in until you reactivate it." />
          <Button type="submit" variant="danger" disabled={pending}>{pending ? "Suspending…" : "Suspend college"}</Button>
        </>
      )}
    </form>
  );
}

export function AdminInviteForm({ id, defaultEmail }: { id: string; defaultEmail: string }) {
  const [state, action, pending] = useActionState(issueAdminInvitationAction, undefined);
  return (
    <div className="space-y-3">
      <form action={action} className="max-w-md space-y-3">
        {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
        <input type="hidden" name="id" value={id} />
        <Field id="adminEmail" label="Administrator's email" type="email" required defaultValue={state?.values?.adminEmail ?? defaultEmail} />
        <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create one-time invitation"}</Button>
      </form>
      {state?.invite ? <InviteLinkPanel title="One-time administrator invitation" link={state.invite.link} email={state.invite.email} expiresText={state.invite.expires} /> : null}
    </div>
  );
}
