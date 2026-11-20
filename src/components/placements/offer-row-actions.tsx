"use client";

import { startTransition, useActionState } from "react";
import { setOfferStatusAction, withdrawOfferAction } from "@/server/manual-placements/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Officer controls for one recorded offer: accept it, put it back to "got offer", or withdraw it. */
export function OfferRowActions({ id, company, offerStatus }: { id: string; company: string; offerStatus: string }) {
  const [s1, setStatus, p1] = useActionState(setOfferStatusAction, undefined);
  const [s2, withdraw, p2] = useActionState(withdrawOfferAction, undefined);
  const fd = (extra: Record<string, string>) => { const f = new FormData(); f.set("id", id); f.set("company", company); for (const [k, v] of Object.entries(extra)) f.set(k, v); return f; };
  return (
    <div className="space-y-2">
      {s1?.error ? <Alert kind="error">{s1.error}</Alert> : null}{s2?.error ? <Alert kind="error">{s2.error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {offerStatus === "ACCEPTED"
          ? <Button type="button" variant="secondary" disabled={p1} onClick={() => startTransition(() => setStatus(fd({ status: "OFFERED" })))}>Mark as not accepted</Button>
          : <Button type="button" disabled={p1} onClick={() => startTransition(() => setStatus(fd({ status: "ACCEPTED" })))}>Mark accepted</Button>}
        <Button type="button" variant="danger" disabled={p2} onClick={() => { if (window.confirm("Withdraw this offer record? It stays in the history as withdrawn.")) startTransition(() => withdraw(fd({}))); }}>Withdraw</Button>
      </div>
    </div>
  );
}
