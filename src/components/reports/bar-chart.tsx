/**
 * A horizontal bar chart drawn with plain HTML and SVG attributes (no chart library, no client JavaScript, no inline style attributes — the CSP forbids them). The exact numbers are always printed next to
 * the bars, and the chart as a whole has a text alternative, so nothing depends on seeing the colours.
 */
export function BarChart({ title, rows, unit = "" }: { title: string; rows: { label: string; value: number | null; detail: string }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <figure className="space-y-2" aria-label={title}>
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      <ul className="space-y-2" aria-label={`${title} (values)`}>
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[6rem_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[9rem_1fr_auto]">
            <span className="truncate" title={r.label}>{r.label}</span>
            <svg className="h-4 w-full" aria-hidden="true" focusable="false"><rect className="fill-background" width="100%" height="16" rx="4" /><rect className="fill-primary" width={`${r.value === null ? 0 : Math.max(2, Math.round((r.value / max) * 100))}%`} height="16" rx="4" /></svg>
            <span className="tabular-nums">{r.value === null ? "—" : `${r.value}${unit}`} <span className="text-xs text-muted">{r.detail}</span></span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
