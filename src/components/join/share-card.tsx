"use client";

import { setJoinLinkAction } from "@/server/join/actions";
import { ActionButton } from "@/components/ui/action-button";
import { CopyButton } from "@/components/ui/copy-button";

/** The college's student sign-up link: copy it, or open WhatsApp with the message ready. Turning it off or replacing it stops older links at once. */
export function ShareCard({ link, enabled }: { link: string; enabled: boolean }) {
  const message = `Create your CampusConnect student account here (your coordinator will approve it): ${link}`;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Share one link with all your students. Each student asks for an account with their own details; a coordinator or you approve it before they can sign in.</p>
      <p className="text-sm">Status: <strong>{enabled ? "On — students can use the link" : "Off — the link does nothing"}</strong></p>
      {enabled ? (
        <div className="space-y-2">
          <label htmlFor="join-link" className="block text-sm font-medium">Sign-up link</label>
          <input id="join-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="h-10 w-full rounded-xl border border-border bg-background px-3 font-mono text-xs" />
          <div className="flex flex-wrap gap-3">
            <CopyButton value={link} label="Copy link" />
            <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground">Share on WhatsApp</a>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-start gap-4 border-t border-border pt-4">
        {enabled ? <ActionButton action={setJoinLinkAction} fields={{ mode: "disable" }} label="Turn link off" /> : <ActionButton action={setJoinLinkAction} fields={{ mode: "enable" }} label="Turn link on" variant="primary" />}
        <ActionButton action={setJoinLinkAction} fields={{ mode: "rotate" }} label="Make a new link" variant="danger" />
      </div>
      <p className="text-xs text-muted">“Make a new link” is for when the link was shared somewhere it should not be: the old link stops working immediately and the new one is on.</p>
    </div>
  );
}
