"use client";

import { useActionState } from "react";
import { approveApplicationAction, rejectApplicationAction, startReviewAction } from "@/server/platform/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InviteLinkPanel } from "@/components/ui/invite-link-panel";
import { Textarea } from "@/components/ui/textarea";

export function ReviewActions({ id, status, officialEmail, collegeId }: { id: string; status: string; officialEmail: string; collegeId: string | null }) {
  const [startState, start, starting] = useActionState(startReviewAction, undefined);
  const [approveState, approve, approving] = useActionState(approveApplicationAction, undefined);
  const [rejectState, reject, rejecting] = useActionState(rejectApplicationAction, undefined);

  return (
    <div className="space-y-4">
      {/* The invitation link must survive the re-render that follows approval, so this panel is driven by action state, not by status. */}
      {approveState?.invite ? (
        <>
          <Alert kind="success">{approveState.ok}</Alert>
          <InviteLinkPanel title="One-time administrator invitation" link={approveState.invite.link} email={approveState.invite.email} expiresText={approveState.invite.expires} />
        </>
      ) : null}

      {status === "SUBMITTED" ? (
        <form action={start} className="space-y-3">
          {startState?.error ? <Alert kind="error">{startState.error}</Alert> : null}
          <input type="hidden" name="id" value={id} />
          <p className="text-sm text-muted">Move this application into review before deciding. Nothing is sent to the applicant.</p>
          <Button type="submit" disabled={starting}>{starting ? "Starting…" : "Start review"}</Button>
        </form>
      ) : null}

      {status === "UNDER_REVIEW" ? (
        <div className="grid gap-6 @3xl:grid-cols-2">
          <form action={approve} className="space-y-3 rounded-xl border border-border p-4">
            <h3 className="font-medium">Approve</h3>
            {approveState?.error ? <Alert kind="error">{approveState.error}</Alert> : null}
            <input type="hidden" name="id" value={id} />
            <Field id="adminEmail" label="College administrator's email" type="email" required defaultValue={approveState?.values?.adminEmail ?? officialEmail}
              hint="Approving creates the college workspace and a one-time invitation for this person. You will see the link once." />
            <Button type="submit" disabled={approving}>{approving ? "Approving…" : "Approve and create invitation"}</Button>
          </form>
          <form action={reject} className="space-y-3 rounded-xl border border-border p-4">
            <h3 className="font-medium">Reject</h3>
            {rejectState?.error ? <Alert kind="error">{rejectState.error}</Alert> : null}
            <input type="hidden" name="id" value={id} />
            <Textarea id="reason" label="Reason (shown to the applicant)" required minLength={5} maxLength={1000} defaultValue={rejectState?.values?.reason} />
            <Button type="submit" variant="danger" disabled={rejecting}>{rejecting ? "Rejecting…" : "Reject application"}</Button>
          </form>
        </div>
      ) : null}

      {status === "APPROVED" && collegeId && !approveState?.invite ? <p className="text-sm">This application was approved. <a className="underline" href={`/platform/colleges/${collegeId}`}>Open the college</a> to manage access and administrator invitations.</p> : null}
      {rejectState?.ok ? <Alert kind="success">{rejectState.ok}</Alert> : null}
    </div>
  );
}
