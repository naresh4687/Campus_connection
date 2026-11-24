import Link from "next/link";

/** A single live number. `testId` keeps the label-based id used by tests. */
export function StatTile({ label, value, href, hint }: { label: string; value: number | string; href?: string; hint?: string }) {
  const body = (
    <div className={`h-full card p-3.5 transition-colors sm:p-5 duration-150 ${href ? "hover:bg-tint" : ""}`}>
      <p className="text-xs text-muted sm:text-sm">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums sm:mt-2 sm:text-3xl" data-testid={`stat-${label}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
  return href ? <Link href={href} className="block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{body}</Link> : body;
}
