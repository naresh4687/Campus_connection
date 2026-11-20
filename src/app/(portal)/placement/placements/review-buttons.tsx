"use client";

import { startTransition, useActionState, useState } from "react";
import { reviewPlacementAction } from "@/server/manual-placements/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function ReviewPlacementButtons({ id }: { id: string }) {
  const [state, run, pending] = useActionState(reviewPlacementAction, undefined);
  const [note, setNote] = useState("");
  const send = (decision: string) => () => { const fd = new FormData(); fd.set("id", id); fd.set("decision", decision); fd.set("note", note); startTransition(() => run(fd)); };
  return (
    <div className="space-y-2">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <input aria-label="Reason (required to reject)" placeholder="Reason (to reject)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="h-9 w-full rounded-xl border border-border bg-surface px-3 text-sm" />
      <div className="flex gap-2"><Button type="button" onClick={send("verify")} disabled={pending}>Verify</Button><Button type="button" variant="danger" onClick={send("reject")} disabled={pending}>Reject</Button></div>
    </div>
  );
}
