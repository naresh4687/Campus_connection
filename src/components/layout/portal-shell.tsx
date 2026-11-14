import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "@/server/auth/actions";
import { type SessionUser } from "@/server/auth/session";
import { NAV } from "./nav";
import { NavLinks } from "./nav-links";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { unreadCount } from "@/server/notifications/queries";

const ROLE_LABEL = {
  PLATFORM_SUPER_ADMIN: "Platform administrator",
  COLLEGE_ADMIN: "College administrator",
  PLACEMENT_OFFICER: "Placement officer",
  COORDINATOR: "Department coordinator",
  STUDENT: "Student",
} as const;

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";

/** Sidebar from tablet width up (md), a stacked header on phones. It is one <header>, so the landmark and its contents stay the same. */
export async function PortalShell({ session, children }: { session: SessionUser; children: ReactNode }) {
  const unread = session.role === "PLATFORM_SUPER_ADMIN" ? 0 : await unreadCount(session).catch(() => 0);
  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <header className="flex flex-col gap-4 bg-nav p-4 text-nav-foreground print:hidden md:sticky md:top-0 md:h-dvh md:w-56 md:shrink-0 md:overflow-y-auto md:p-4 lg:w-64 lg:p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2.5 font-display text-lg font-bold tracking-tight text-white"><Logo />CampusConnect</span>
          <form action={logoutAction} className="md:hidden">
            <Button type="submit" variant="secondary" className="h-9">Sign out</Button>
          </form>
        </div>
        <NavLinks items={NAV[session.role]} />
        <div className="flex flex-col gap-3 md:mt-auto">
          {session.role !== "PLATFORM_SUPER_ADMIN" ? (
            <Link href="/notifications" className="flex items-center justify-between rounded-xl px-3 py-2 text-sm hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <span>Notifications</span>
              {unread > 0 ? <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-black" data-testid="unread-count">{unread}<span className="sr-only"> unread</span></span> : null}
            </Link>
          ) : null}
          <ThemeSwitch tone="nav" />
          <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-3 text-sm">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-black">{initials(session.fullName)}</span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-medium text-white">{session.fullName}</span>
              <span className="block text-xs opacity-80">{ROLE_LABEL[session.role]}</span>
            </span>
          </div>
          <form action={logoutAction} className="hidden md:block">
            <Button type="submit" variant="secondary" className="h-10 w-full">Sign out</Button>
          </form>
        </div>
      </header>
      <main className="@container mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 md:px-8 lg:px-10 lg:py-10 xl:max-w-7xl 2xl:max-w-[90rem]">{children}</main>
    </div>
  );
}
