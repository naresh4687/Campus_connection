"use client";

import { useActionState } from "react";
import { cancelImportAction, commitImportAction } from "@/server/students/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function CommitForm({ id, ready }: { id: string; ready: number }) {
  const [state, action, pending] = useActionState(commitImportAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Button type="submit" disabled={pending || ready === 0}>{pending ? "Importing…" : `Import ${ready} student${ready === 1 ? "" : "s"}`}</Button>
      {ready === 0 ? <p className="text-xs text-muted">Nothing is ready to import. Fix the file and upload it again, or change the column mapping.</p> : null}
    </form>
  );
}

export function CancelForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(cancelImportAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Cancelling…" : "Cancel this import"}</Button>
    </form>
  );
}
