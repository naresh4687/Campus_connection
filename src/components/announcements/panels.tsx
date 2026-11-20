"use client";

import { useActionState } from "react";
import { archiveAnnouncementAction, publishAnnouncementAction } from "@/server/announcements/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function PublishPanel({ id, audienceSet, reach }: { id: string; audienceSet: boolean; reach: { total: number; with_account: number } | null }) {
  const [state, run, pending] = useActionState(publishAnnouncementAction, undefined);
  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {!audienceSet ? <Alert kind="info">Choose who should receive this and save before publishing.</Alert> : reach ? <p className="text-sm">This will notify up to <strong>{reach.with_account}</strong> student{reach.with_account === 1 ? "" : "s"} with an account ({reach.total} match the audience today). The audience is fixed when you publish.</p> : null}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" value="yes" className="mt-0.5 h-4 w-4" disabled={!audienceSet} /> <span>I have checked the preview and the audience. I understand publishing notifies the students.</span></label>
      <Button type="submit" disabled={!audienceSet || pending} pending={pending}>{pending ? "Publishing…" : "Publish announcement"}</Button>
    </form>
  );
}

export function ArchiveButton({ id }: { id: string }) {
  const [state, run, pending] = useActionState(archiveAnnouncementAction, undefined);
  return (<form action={run} className="space-y-2"><input type="hidden" name="id" value={id} />{state?.error ? <Alert kind="error">{state.error}</Alert> : null}<Button type="submit" variant="danger" disabled={pending}>Archive</Button></form>);
}
