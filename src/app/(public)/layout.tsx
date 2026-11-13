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
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2.5 font-display text-lg font-bold tracking-tight"><Logo />CampusConnect</Link>
          <nav aria-label="Main" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {LINKS.map((l) => <Link key={l.href} href={l.href} className="text-muted transition-colors hover:text-foreground">{l.label}</Link>)}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <ThemeSwitch />
            <Link href="/login" className="inline-flex h-10 items-center rounded-xl border border-border bg-surface px-4 font-semibold transition-colors hover:bg-tint">Sign in</Link>
            <Link href="/apply" className="inline-flex h-10 items-center rounded-xl bg-primary px-4 font-semibold text-primary-foreground shadow-[0_6px_16px_-8px_var(--primary)] transition hover:-translate-y-px">Apply as a college</Link>
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
        </div>
      </footer>
    </div>
  );
}
