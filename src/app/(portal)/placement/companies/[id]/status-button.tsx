"use client";

import { useActionState } from "react";
import { setCompanyStatusAction } from "@/server/companies/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function StatusButton({ id, active }: { id: string; active: boolean }) {
  const [state, action, pending] = useActionState(setCompanyStatusAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={active ? "INACTIVE" : "ACTIVE"} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <Button type="submit" variant={active ? "danger" : "primary"} disabled={pending}>{pending ? "Saving…" : active ? "Deactivate company" : "Reactivate company"}</Button>
    </form>
  );
}
