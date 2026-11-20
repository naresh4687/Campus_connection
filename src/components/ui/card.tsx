import type { ReactNode } from "react";

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card card-accent px-5 pb-5 sm:px-6 sm:pb-6 [--card-pt:1.25rem]">
      {title ? <h2 className="mb-3">{title}</h2> : null}
      {children}
    </section>
  );
}
