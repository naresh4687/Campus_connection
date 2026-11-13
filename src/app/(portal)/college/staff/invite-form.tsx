"use client";

import { useActionState } from "react";
import { inviteStaffAction } from "@/server/college/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InviteLinkPanel } from "@/components/ui/invite-link-panel";
import { Select } from "@/components/ui/select";

export function InviteStaffForm() {
  const [state, action, pending] = useActionState(inviteStaffAction, undefined);
  const v = state?.values ?? {};
  const e = state?.fieldErrors ?? {};
  return (
    <div className="space-y-4">
      <form action={action} className="max-w-xl space-y-4" noValidate>
        {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="email" label="Email" type="email" required defaultValue={state?.invite ? "" : v.email} error={e.email} />
          <Select key={`role-${v.role ?? ""}`} id="role" label="Role" required defaultValue={v.role ?? ""} error={e.role}>
            <option value="" disabled>Choose…</option>
            <option value="PLACEMENT_OFFICER">Placement officer</option>
            <option value="COORDINATOR">Department coordinator</option>
          </Select>
        </div>
        <p className="text-xs text-muted">The invitation is a one-time link that you send yourself (email delivery is not enabled). It expires in 7 days; inviting the same email again invalidates the earlier link.</p>
        <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create invitation"}</Button>
      </form>
      {state?.invite ? <InviteLinkPanel title="One-time invitation" link={state.invite.link} email={state.invite.email} expiresText={state.invite.expires} /> : null}
    </div>
  );
}
