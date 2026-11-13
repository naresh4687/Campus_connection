import type { ReactNode } from "react";

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-6 shadow-soft">
      {title ? <h2 className="mb-3 text-lg font-semibold">{title}</h2> : null}
      {children}
    </section>
  );
}
