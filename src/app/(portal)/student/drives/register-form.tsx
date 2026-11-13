"use client";

import { useActionState } from "react";
import { registerAction, withdrawAction } from "@/server/registrations/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function RegisterForm({ id, registered }: { id: string; registered: boolean }) {
  const [state, run, pending] = useActionState(registered ? withdrawAction : registerAction, undefined);
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Button type="submit" variant={registered ? "secondary" : "primary"} disabled={pending}>{pending ? "Working…" : registered ? "Withdraw my registration" : "Register for this drive"}</Button>
    </form>
  );
}
