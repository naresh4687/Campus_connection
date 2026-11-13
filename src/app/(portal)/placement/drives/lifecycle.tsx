"use client";

import { useActionState } from "react";
import { publishDriveAction, setDriveStatusAction } from "@/server/drives/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

function One({ id, label, to, variant = "secondary" }: { id: string; label: string; to?: string; variant?: "primary" | "secondary" | "danger" }) {
  const [state, run, pending] = useActionState(to ? setDriveStatusAction : publishDriveAction, undefined);
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="id" value={id} />{to ? <input type="hidden" name="to" value={to} /> : null}
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      <Button type="submit" variant={variant} disabled={pending}>{pending ? "Working…" : label}</Button>
    </form>
  );
}

export function Lifecycle({ id, status }: { id: string; status: string }) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      {status === "DRAFT" ? <><One id={id} label="Publish drive" variant="primary" /><One id={id} label="Discard (archive) draft" to="ARCHIVED" variant="danger" /></> : null}
      {status === "PUBLISHED" ? <><One id={id} label="Close drive" to="CLOSED" /><One id={id} label="Unpublish (back to draft)" to="DRAFT" /></> : null}
      {status === "CLOSED" ? <One id={id} label="Archive drive" to="ARCHIVED" /> : null}
      {status === "ARCHIVED" ? <p className="text-sm text-muted">This drive is archived and read-only.</p> : null}
    </div>
  );
}
