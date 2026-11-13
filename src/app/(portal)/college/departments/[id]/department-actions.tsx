"use client";

import { useActionState } from "react";
import { assignCoordinatorAction } from "@/server/college/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export function AssignCoordinatorForm({ departmentId, options }: { departmentId: string; options: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(assignCoordinatorAction, undefined);
  if (options.length === 0) return (
    <div className="space-y-2">
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <p className="text-sm text-muted">No other active coordinators are available. Invite coordinators from the Staff page.</p>
    </div>
  );
  return (
    <form action={action} className="max-w-md space-y-3">
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <input type="hidden" name="departmentId" value={departmentId} />
      <Select id="userId" label="Assign a coordinator" required defaultValue="" key={state?.ok ?? "x"}>
        <option value="" disabled>Choose…</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </Select>
      <Button type="submit" disabled={pending}>{pending ? "Assigning…" : "Assign"}</Button>
    </form>
  );
}
