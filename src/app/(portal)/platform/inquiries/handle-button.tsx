"use client";

import { useActionState } from "react";
import { handleInquiryAction } from "@/server/platform/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function HandleButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(handleInquiryAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      <Button type="submit" variant="secondary" disabled={pending} className="h-8">{pending ? "Saving…" : "Mark handled"}</Button>
    </form>
  );
}
