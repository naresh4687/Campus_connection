import Link from "next/link";
import type { ReactNode } from "react";

const LINKS = [
  { href: "/features", label: "Features" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/contact", label: "Contact" },
];

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-lg font-semibold tracking-tight">CampusConnect</Link>
          <nav aria-label="Main" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {LINKS.map((l) => <Link key={l.href} href={l.href} className="text-muted hover:text-foreground">{l.label}</Link>)}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link href="/login" className="text-muted hover:text-foreground">Sign in</Link>
            <Link href="/apply" className="inline-flex h-9 items-center rounded-md bg-primary px-3 font-medium text-primary-foreground">Apply as a college</Link>
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
