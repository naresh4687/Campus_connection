import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "@/server/auth/actions";
import { type SessionUser } from "@/server/auth/session";
import { NAV } from "./nav";
import { Button } from "@/components/ui/button";
import { unreadCount } from "@/server/notifications/queries";

const ROLE_LABEL = {
  PLATFORM_SUPER_ADMIN: "Platform administrator",
  COLLEGE_ADMIN: "College administrator",
  PLACEMENT_OFFICER: "Placement officer",
  COORDINATOR: "Department coordinator",
  STUDENT: "Student",
} as const;

export async function PortalShell({ session, children }: { session: SessionUser; children: ReactNode }) {
  const unread = session.role === "PLATFORM_SUPER_ADMIN" ? 0 : await unreadCount(session).catch(() => 0);
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="bg-nav text-nav-foreground print:hidden">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold tracking-tight">CampusConnect</span>
          <nav aria-label="Main" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {NAV[session.role].map((n) => <Link key={n.href} href={n.href} className="hover:underline">{n.label}</Link>)}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {session.role !== "PLATFORM_SUPER_ADMIN" ? <Link href="/notifications" className="hover:underline">Notifications{unread > 0 ? <span className="ml-1 rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-foreground" data-testid="unread-count">{unread}<span className="sr-only"> unread</span></span> : null}</Link> : null}
            <span className="text-right leading-tight">
              <span className="block">{session.fullName}</span>
              <span className="block text-xs opacity-75">{ROLE_LABEL[session.role]}</span>
            </span>
            <form action={logoutAction}>
              <Button type="submit" variant="secondary" className="h-9">Sign out</Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
