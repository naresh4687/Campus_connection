import { Alert } from "./alert";
import { CopyButton } from "./copy-button";

/** Shows a one-time link exactly once (it is not stored anywhere in recoverable form). */
export function InviteLinkPanel({ title, link, email, expiresText }: { title: string; link: string; email: string; expiresText: string }) {
  return (
    <div className="space-y-3 rounded-xl border border-success/40 p-4" data-testid="invite-link-panel">
      <p className="font-medium text-success">{title}</p>
      <p className="text-sm">Send this link to <strong>{email}</strong> yourself (email delivery is not enabled). It works once and {expiresText}.</p>
      <input readOnly value={link} aria-label="One-time link" className="h-10 w-full rounded-xl border border-border bg-background px-3 font-mono text-xs" />
      <div className="flex flex-wrap items-center gap-3">
        <CopyButton value={link} />
      </div>
      <Alert>This link is shown only now. If you lose it, issue a new one — that invalidates this one.</Alert>
    </div>
  );
}
