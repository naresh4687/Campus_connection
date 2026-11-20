import Link from "next/link";

export type Stat = { label: string; value: number | string; href?: string; hint?: string; attention?: boolean };

/** A formal row of counts for the top of a section page (the detail that used to crowd the home page). The number carries the `stat-<label>` test id. */
export function StatStrip({ items, label }: { items: Stat[]; label?: string }) {
  return (
    <dl aria-label={label} className="grid grid-cols-2 gap-4 text-sm @3xl:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
      {items.map((m) => {
        const hot = m.attention && Number(m.value) > 0;
        const num = <span data-testid={`stat-${m.label}`}>{m.value}</span>;
        return (
          <div key={m.label} className="card relative p-4">
            <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted [overflow-wrap:normal]">{hot ? <span aria-hidden="true" className="h-2 w-2 bg-accent" /> : null}{m.label}</dt>
            <dd className="mt-1.5 text-2xl font-bold leading-none tabular-nums">
              {m.href ? <Link href={m.href} className="after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-primary"><span className="sr-only">{m.label}: </span>{num}</Link> : num}
              {m.hint ? <span className="mt-1.5 block text-xs font-normal leading-normal text-muted">{m.hint}</span> : null}
            </dd>
          </div>);
      })}
    </dl>
  );
}
