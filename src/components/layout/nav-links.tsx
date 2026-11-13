"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "./nav";

/** Highlights the section you are in. The longest matching link wins, so "/college" does not light up on "/college/drives". */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const matches = items.filter((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));
  const current = matches.sort((a, b) => b.href.length - a.href.length)[0]?.href;
  // Group consecutive items under a small heading (shown in the sidebar only; the stacked mobile header stays a flat list).
  const groups: { name: string; items: NavItem[] }[] = [];
  for (const n of items) {
    const name = n.group ?? "";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(n); else groups.push({ name, items: [n] });
  }
  return (
    <nav aria-label="Main" className="flex flex-wrap gap-x-1 gap-y-1 lg:flex-col lg:flex-nowrap lg:gap-y-4">
      {groups.map((g) => (
        <div key={`${g.name}-${g.items[0].href}`} className="flex flex-wrap gap-1 lg:flex-col">
          {g.name ? <p className="hidden px-3 text-xs font-semibold uppercase tracking-wider text-nav-foreground/70 lg:block">{g.name}</p> : null}
          {g.items.map((n) => {
            const on = n.href === current;
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={on ? "page" : undefined}
                className={`rounded-xl px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${on ? "bg-white/15 font-semibold text-white" : "hover:bg-white/10 hover:text-white"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
