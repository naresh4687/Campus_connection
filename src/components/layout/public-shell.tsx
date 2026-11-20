import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { ThemeSwitch } from "@/components/ui/theme-switch";

const LINKS = [
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/contact", label: "Contact" },
];

/** Header and footer of the public site. Used by the (public) layout and by the root not-found page. */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
        {/* Phone: logo + actions on row 1, links on row 2 (the theme switch moves to the footer). From sm: one flex row; the switch joins the header from lg, where there is room. DOM order stays logo, links, theme, actions. */}
        <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex sm:flex-wrap sm:gap-x-8">
          <Link href="/" className="col-start-1 row-start-1 flex min-w-0 items-center gap-2.5 text-base font-bold tracking-tight sm:text-[1.05rem] sm:[font-stretch:112%]"><Logo /><span className="truncate max-[359px]:sr-only">CampusConnect</span></Link>
          <nav aria-label="Main" className="col-span-2 row-start-2 flex flex-wrap justify-between gap-x-5 gap-y-1 text-sm sm:col-auto sm:justify-start sm:gap-x-6">
            {LINKS.map((l) => <Link key={l.href} href={l.href} className="inline-flex min-h-9 items-center font-medium text-muted underline-offset-[6px] transition-colors hover:text-foreground hover:underline sm:min-h-0">{l.label}</Link>)}
          </nav>
          <div className="hidden lg:ml-auto lg:block"><ThemeSwitch /></div>
          <div className="col-start-2 row-start-1 flex items-center gap-2 text-sm sm:ml-auto lg:ml-0">
            <Link href="/login" className={buttonClass("secondary", "h-10 px-4")}>Sign in</Link>
            <Link href="/apply" className={buttonClass("primary", "h-10 px-4")}><span className="sm:hidden">Apply</span><span className="hidden sm:inline">Apply as a college</span></Link>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="bg-nav text-nav-foreground">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-8 text-sm">
          <span className="flex items-center gap-2 font-semibold text-white"><Logo className="h-6 w-6" />© CampusConnect</span>
          <Link href="/privacy" className="hover:text-white hover:underline">Privacy policy</Link>
          <Link href="/terms" className="hover:text-white hover:underline">Terms of service</Link>
          <Link href="/contact" className="hover:text-white hover:underline">Contact</Link>
          {/* Phones and tablets: the header has no room for it, so it lives here (the header copy shows from lg). */}
          <div className="lg:hidden"><ThemeSwitch tone="nav" /></div>
        </div>
      </footer>
    </div>
  );
}
