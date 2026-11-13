"use client";

import { useActionState } from "react";
import type { ActionState } from "@/server/action-utils";
import { Alert } from "./alert";
import { Button } from "./button";
import { InviteLinkPanel } from "./invite-link-panel";

/** A one-click form for a server action with hidden fields (reversible actions only). Shows the outcome inline, and a one-time link if the action returns one. */
export function ActionButton({ action, fields, label, pendingLabel, variant = "secondary", small = false, linkTitle = "One-time link" }: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  small?: boolean;
  linkTitle?: string;
}) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <form action={run} className="space-y-2">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Button type="submit" variant={variant} disabled={pending} className={small ? "h-8 px-3" : ""}>{pending ? (pendingLabel ?? "Working…") : label}</Button>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok && !state.invite ? <Alert kind="success">{state.ok}</Alert> : null}
      {state?.invite ? <InviteLinkPanel title={linkTitle} link={state.invite.link} email={state.invite.email} expiresText={state.invite.expires} /> : null}
    </form>
  );
}
