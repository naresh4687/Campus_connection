import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";
import { ThemeSwitch } from "@/components/ui/theme-switch";

const LINKS = [
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/contact", label: "Contact" },
];

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/85 backdrop-blur">
        {/* Phone: logo + actions on row 1, links on row 2 (the theme switch moves to the footer). From sm: one flex row; the switch joins the header from lg, where there is room. DOM order stays logo, links, theme, actions. */}
        <div className="mx-auto grid w-full max-w-5xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex sm:flex-wrap sm:gap-x-6">
          <Link href="/" className="col-start-1 row-start-1 flex min-w-0 items-center gap-2.5 font-display text-lg font-bold tracking-tight"><Logo /><span className="max-[359px]:sr-only">CampusConnect</span></Link>
          <nav aria-label="Main" className="col-span-2 row-start-2 flex flex-wrap justify-between gap-x-5 gap-y-1 text-sm sm:col-auto sm:justify-start">
            {LINKS.map((l) => <Link key={l.href} href={l.href} className="inline-flex min-h-9 items-center text-muted transition-colors hover:text-foreground sm:min-h-0">{l.label}</Link>)}
          </nav>
          <div className="hidden lg:ml-auto lg:block"><ThemeSwitch /></div>
          <div className="col-start-2 row-start-1 flex items-center gap-2 text-sm sm:ml-auto lg:ml-0">
            <Link href="/login" className="inline-flex h-10 items-center rounded-xl border border-border bg-surface px-4 font-semibold transition-colors hover:bg-tint">Sign in</Link>
            <Link href="/apply" className="inline-flex h-10 items-center rounded-xl bg-primary px-4 font-semibold text-primary-foreground shadow-[0_6px_16px_-8px_var(--primary)] transition hover:-translate-y-px"><span className="sm:hidden">Apply</span><span className="hidden sm:inline">Apply as a college</span></Link>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted">
          <span>© CampusConnect</span>
          <Link href="/privacy" className="hover:text-foreground">Privacy policy</Link>
          <Link href="/terms" className="hover:text-foreground">Terms of service</Link>
          <Link href="/contact" className="hover:text-foreground">Contact</Link>
          {/* Phones and tablets: the header has no room for it, so it lives here (the header copy shows from lg). */}
          <div className="lg:hidden"><ThemeSwitch /></div>
        </div>
      </footer>
    </div>
  );
}
