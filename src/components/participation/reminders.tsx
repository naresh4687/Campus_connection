"use client";

import { useActionState } from "react";
import { remindCoordinatorsAction, remindStudentsAction } from "@/server/registrations/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Both reminders ask for an explicit tick first and report exactly how many people were notified. */
export function ReminderForms({ drive, dept, toChase, canNotifyCoordinators, open }: { drive: string; dept: string; toChase: number; canNotifyCoordinators: boolean; open: boolean }) {
  const [s1, run1, p1] = useActionState(remindStudentsAction, undefined);
  const [s2, run2, p2] = useActionState(remindCoordinatorsAction, undefined);
  if (!open) return <p className="text-sm text-muted">Registration is closed, so reminders are off.</p>;
  return (
    <div className="grid gap-4 @3xl:grid-cols-2">
      <form action={run1} className="space-y-2 border border-border p-4">
        <input type="hidden" name="drive" value={drive} /><input type="hidden" name="dept" value={dept} />
        <h3 className="text-sm">Remind students{dept ? " of this department" : ""}</h3>
        <p className="text-xs text-muted">Sends an in-app notification to every eligible student with an account who has not registered{toChase ? ` (about ${toChase})` : ""}, and to those who started an external registration but have not uploaded the screenshot. Once every six hours.</p>
        {s1?.error ? <Alert kind="error">{s1.error}</Alert> : null}{s1?.ok ? <Alert kind="success">{s1.ok}</Alert> : null}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" value="yes" className="mt-0.5 h-4 w-4" /> <span>Send the reminder now.</span></label>
        <Button type="submit" disabled={p1} pending={p1}>Remind students</Button>
      </form>
      {canNotifyCoordinators ? (
        <form action={run2} className="space-y-2 border border-border p-4">
          <input type="hidden" name="drive" value={drive} />
          <h3 className="text-sm">Notify department coordinators</h3>
          <p className="text-xs text-muted">Each department’s coordinators get a notification with how many eligible students of theirs have not registered, and a link to the list they can download.</p>
          {s2?.error ? <Alert kind="error">{s2.error}</Alert> : null}{s2?.ok ? <Alert kind="success">{s2.ok}</Alert> : null}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" value="yes" className="mt-0.5 h-4 w-4" /> <span>Notify the coordinators now.</span></label>
          <Button type="submit" variant="secondary" disabled={p2} pending={p2}>Notify coordinators</Button>
        </form>) : null}
    </div>
  );
}
