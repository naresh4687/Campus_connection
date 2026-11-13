import type { ReactNode } from "react";
import { PortalShell } from "@/components/layout/portal-shell";
import { requireSession } from "@/server/auth/session";

// Chrome only. Every page ALSO enforces its own role: layouts do not re-run on every client navigation.
export default async function PortalLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  return <PortalShell session={session}>{children}</PortalShell>;
}
