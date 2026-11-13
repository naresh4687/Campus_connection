import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";
import { ThemeSwitch } from "@/components/ui/theme-switch";

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-12">
      <div aria-hidden="true" className="drift pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-accent/25 blur-3xl" />
      <div aria-hidden="true" className="drift pointer-events-none absolute -bottom-28 -left-20 h-80 w-80 rounded-full bg-primary/20 blur-3xl [animation-delay:-8s]" />
      <div className="absolute right-4 top-4"><ThemeSwitch /></div>
      <div className="rise relative w-full max-w-md space-y-6">
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-bold tracking-tight"><Logo />CampusConnect</Link>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{title}</h1>
        </div>
        <div className="rounded-3xl border border-border bg-surface p-6 shadow-soft">{children}</div>
      </div>
    </main>
  );
}
