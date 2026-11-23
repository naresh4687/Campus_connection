"use client";

import { Alert } from "./alert";
import { CopyButton } from "./copy-button";

/** Shows a one-time link exactly once (it is not stored anywhere in recoverable form). */
export function InviteLinkPanel({ title, link, email, expiresText }: { title: string; link: string; email: string; expiresText: string }) {
  return (
    <div className="space-y-3 rounded-xl border border-success/40 p-4" data-testid="invite-link-panel">
      <p className="font-medium text-foreground">{title}</p>
      <p className="text-sm">Share this link with <strong>{email}</strong> — copy it and send it on WhatsApp or any other channel you trust. It works once and {expiresText}.</p>
      <input id="invite-link-field" readOnly value={link} aria-label="One-time link" onFocus={(e) => e.currentTarget.select()} onClick={(e) => e.currentTarget.select()} className="h-10 w-full rounded-xl border border-border bg-background px-3 font-mono text-xs" />
      <CopyButton value={link} inputId="invite-link-field" />
      <Alert>This link is shown only now. If you lose it, issue a new one — that invalidates this one.</Alert>
    </div>
  );
}
