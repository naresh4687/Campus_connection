"use client";

import { useActionState } from "react";
import { withdrawAcademicsAction } from "@/server/academics/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function WithdrawButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(withdrawAcademicsAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Withdrawing…" : "Withdraw this submission"}</Button>
    </form>
  );
}
