"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "./nav";

/** Highlights the section you are in. The longest matching link wins, so "/college" does not light up on "/college/drives". */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const path = (href: string) => href.split("?")[0];   // shared links carry ?as=; the section is the path
  const matches = items.filter((n) => pathname === path(n.href) || pathname.startsWith(`${path(n.href)}/`));
  const current = matches.sort((a, b) => path(b.href).length - path(a.href).length)[0]?.href;
  // Group consecutive items under a small heading.
  const groups: { name: string; items: NavItem[] }[] = [];
  for (const n of items) {
    const name = n.group ?? "";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(n); else groups.push({ name, items: [n] });
  }
  return (
    <nav aria-label="Main" className="flex flex-col gap-y-5">
      {groups.map((g) => (
        <div key={`${g.name}-${g.items[0].href}`} className="flex flex-col gap-0.5">
          {g.name ? <p className="px-3 pb-1 text-xs font-medium text-nav-foreground/60">{g.name}</p> : null}
          {g.items.map((n) => {
            const on = n.href === current;
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={on ? "page" : undefined}
                className={`rounded-xl px-3 py-2 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${on ? "bg-brand font-semibold text-brand-foreground" : "hover:bg-white/10 hover:text-white"}`}
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
