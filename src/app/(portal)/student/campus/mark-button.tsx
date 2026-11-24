"use client";

import { useActionState } from "react";
import { markCampusAttendanceAction } from "@/server/campus/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** One tap to mark yourself present. The database checks you are on the list for this round and that attendance is open. */
export function MarkButton({ token, label = "Mark me present" }: { token: string; label?: string }) {
  const [state, run, pending] = useActionState(markCampusAttendanceAction, undefined);
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="token" value={token} />
      <Button type="submit" disabled={pending || state?.ok !== undefined} pending={pending}>{pending ? "Marking…" : label}</Button>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
    </form>
  );
}
