"use client";

import { startTransition, useActionState } from "react";
import { decidePasswordRequestAction } from "@/server/auth/password-request-actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function DecideButtons({ id }: { id: string }) {
  const [state, run, pending] = useActionState(decidePasswordRequestAction, undefined);
  const send = (decision: string) => () => { const fd = new FormData(); fd.set("id", id); fd.set("decision", decision); startTransition(() => run(fd)); };
  return (
    <div className="space-y-2">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}{state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <div className="flex gap-2"><Button type="button" onClick={send("approve")} disabled={pending}>Yes, approve</Button><Button type="button" variant="secondary" onClick={send("decline")} disabled={pending}>Decline</Button></div>
    </div>
  );
}
