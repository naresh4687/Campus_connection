import Link from "next/link";
import type { ReactNode } from "react";
import { InstallCard } from "@/components/pwa/install-card";
import { SignOutForm } from "@/components/pwa/sign-out-form";
import { logoutAction } from "@/server/auth/actions";
import { type SessionUser } from "@/server/auth/session";
import { NAV } from "./nav";
import { NavLinks } from "./nav-links";
import { PortalChrome } from "./portal-chrome";
import { Logo } from "@/components/ui/logo";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { unreadCount } from "@/server/notifications/queries";
import { scopedHref, slotOfPath } from "@/lib/portals";

const ROLE_LABEL = {
  PLATFORM_SUPER_ADMIN: "Platform administrator",
  COLLEGE_ADMIN: "College administrator",
  PLACEMENT_OFFICER: "Placement officer",
  COORDINATOR: "Department coordinator",
  STUDENT: "Student",
} as const;

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";

const BELL = "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0";

/**
 * Sidebar from tablet width up (md), a compact top bar with a Menu on phones. It is one <header>, so the landmark and its
 * contents stay the same at every size.
 */
export async function PortalShell({ session, children }: { session: SessionUser; children: ReactNode }) {
  const unread = session.role === "PLATFORM_SUPER_ADMIN" ? 0 : await unreadCount(session).catch(() => 0);
  // Shared pages (Account, Notifications) carry this area, so they open as this account when several are signed in.
  const nav = NAV[session.role].map((n) => (slotOfPath(n.href) ? n : { ...n, href: scopedHref(n.href, session.slot) }));
  const notifications = scopedHref("/notifications", session.slot);
  const hasInbox = session.role !== "PLATFORM_SUPER_ADMIN";

  return (
    <div className="portal-scope flex min-h-full flex-1 flex-col bg-background md:flex-row">
      <header className="flex flex-col bg-nav px-4 py-3 text-nav-foreground print:hidden md:sticky md:top-0 md:h-dvh md:w-60 md:shrink-0 md:overflow-y-auto md:px-4 md:py-5 lg:w-64">
        <PortalChrome
          brand={<Link href={nav[0]?.href ?? "/"} className="flex min-w-0 items-center gap-2.5 rounded-lg text-base font-bold tracking-tight text-white [font-stretch:112%] focus-visible:outline-2 focus-visible:outline-brand"><Logo /><span className="truncate">CampusConnect</span></Link>}
          quick={hasInbox ? (
            <Link href={notifications} aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`} className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-brand">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={BELL} /></svg>
              {unread > 0 ? <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-5 rounded-full bg-accent px-1.5 text-center text-[11px] font-bold leading-5 text-[#101210]">{unread}</span> : null}
            </Link>
          ) : null}
        >
          <NavLinks items={nav} />
          <div className="mt-auto flex flex-col gap-3">
            {hasInbox ? (
              <Link href={notifications} className="flex items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                <span className="flex items-center gap-2.5">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={BELL} /></svg>
                  Notifications
                </span>
                {unread > 0 ? <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-[#101210]" data-testid="unread-count">{unread}<span className="sr-only"> unread</span></span> : null}
              </Link>
            ) : null}
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 p-3 text-sm">
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-brand-foreground">{initials(session.fullName)}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate font-semibold text-white">{session.fullName}</span>
                <span className="block truncate text-xs opacity-80">{ROLE_LABEL[session.role]}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <ThemeSwitch tone="nav" />
              <SignOutForm action={logoutAction} slot={session.slot} className="flex-1">
                <button type="submit" className="inline-flex h-10 w-full items-center justify-center rounded-full border border-white/15 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">Sign out</button>
              </SignOutForm>
            </div>
          </div>
        </PortalChrome>
      </header>
      <main className="portal-main portal-bg @container mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 md:px-8 lg:px-10 lg:py-10 xl:max-w-7xl 2xl:max-w-[90rem]"><InstallCard />{children}</main>
    </div>
  );
}
