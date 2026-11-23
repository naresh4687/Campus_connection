"use client";

import type { ReactNode } from "react";
import { cleanupOnSignOut } from "@/lib/push-client";

/** The sign-out form. Before the server ends the session, this device stops receiving this account's push alerts and our caches are cleared. */
export function SignOutForm({ action, slot, className, children }: { action: () => Promise<void>; slot: string; className?: string; children: ReactNode }) {
  return (
    <form className={className} action={async () => { await cleanupOnSignOut(slot); await action(); }}>
      {children}
    </form>
  );
}
