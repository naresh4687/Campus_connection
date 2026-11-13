import Link from "next/link";

/** A single live number. `testId` keeps the label-based id used by tests. */
export function StatTile({ label, value, href, hint }: { label: string; value: number | string; href?: string; hint?: string }) {
  const body = (
    <div className="lift h-full rounded-2xl border border-border bg-surface p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold tabular-nums" data-testid={`stat-${label}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
  return href ? <Link href={href} className="block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{body}</Link> : body;
}
