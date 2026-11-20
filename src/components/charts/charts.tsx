import type { ReactNode } from "react";

/**
 * Charts for dashboards: plain SVG and HTML, no chart library, no client JavaScript and no inline style attributes (the CSP forbids them).
 * Every chart prints its exact numbers next to the graphic and has a text alternative, so nothing depends on seeing the colours.
 */
export type Tone = "ink" | "lime" | "grey" | "red" | "amber";
const FILL: Record<Tone, string> = { ink: "fill-[var(--chart-1,#a3e14e)]", lime: "fill-brand", grey: "fill-muted/45", red: "fill-danger", amber: "fill-warning" };
const STROKE: Record<Tone, string> = { ink: "stroke-[var(--chart-1,#a3e14e)]", lime: "stroke-brand", grey: "stroke-muted/45", red: "stroke-danger", amber: "stroke-warning" };
const SWATCH: Record<Tone, string> = { ink: "bg-[var(--chart-1,#a3e14e)] ring-1 ring-foreground/30", lime: "bg-brand ring-1 ring-foreground/30", grey: "bg-muted/45", red: "bg-danger", amber: "bg-warning" };

export function Legend({ items }: { items: { label: string; tone: Tone; value?: number }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
      {items.map((i) => <li key={i.label} className="flex items-center gap-1.5"><span aria-hidden="true" className={`inline-block h-2.5 w-2.5 ${SWATCH[i.tone]}`} />{i.label}{i.value !== undefined ? <span className="tabular-nums text-muted"> {i.value}</span> : null}</li>)}
    </ul>
  );
}

export type StackRow = { label: string; href?: string; parts: { label: string; value: number; tone: Tone }[] };
/** Horizontal stacked bars: one row per group (a department, a drive), the parts side by side and all rows on one scale. */
export function StackedBars({ title, rows, legend, empty = "Nothing to show yet." }: { title: string; rows: StackRow[]; legend: { label: string; tone: Tone }[]; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((a, p) => a + p.value, 0)));
  return (
    <figure aria-label={title} className="space-y-3">
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      {rows.length === 0 ? <p className="text-sm text-muted">{empty}</p> : (
        <ul className="space-y-2.5" aria-label={`${title} (values)`}>
          {rows.map((r) => {
            const total = r.parts.reduce((a, p) => a + p.value, 0);
            const bars = r.parts.map((p, k) => ({ ...p, w: (p.value / max) * 100, x: r.parts.slice(0, k).reduce((a, q) => a + (q.value / max) * 100, 0) }));
            return (
              <li key={r.label} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-sm @xl:grid-cols-[9rem_1fr_auto]">
                <span className="truncate" title={r.label}>{r.href ? <a href={r.href} className="underline decoration-border underline-offset-2">{r.label}</a> : r.label}</span>
                <svg className="h-3.5 w-full" aria-hidden="true" focusable="false"><rect className="fill-tint" width="100%" height="14" />
                  {bars.filter((b) => b.value > 0).map((b) => <rect key={b.label} className={FILL[b.tone]} x={`${b.x}%`} width={`${b.w}%`} height="14" />)}
                </svg>
                <span className="tabular-nums text-xs text-muted">{r.parts.map((p) => `${p.value} ${p.label.toLowerCase()}`).join(" · ")} <span className="sr-only">(total {total})</span></span>
              </li>);
          })}
        </ul>)}
      <Legend items={legend} />
    </figure>
  );
}

export type Slice = { label: string; value: number; tone: Tone };
/** A ring split into slices, with the total in the middle and every slice listed with its number. */
export function Donut({ title, slices, centre, unit = "", empty = "Nothing to show yet.", ids }: { title: string; slices: Slice[]; centre?: ReactNode; unit?: string; empty?: string; ids?: boolean }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const arcs = slices.map((s, k) => ({ ...s, pct: total ? (s.value / total) * 100 : 0, start: total ? slices.slice(0, k).reduce((a, q) => a + (q.value / total) * 100, 0) : 0 }));
  return (
    <figure aria-label={title} className="space-y-3">
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      {total === 0 ? <p className="text-sm text-muted">{empty}</p> : (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="relative h-32 w-32 shrink-0">
            <svg viewBox="-2 -2 40 40" className="h-32 w-32 -rotate-90" aria-hidden="true" focusable="false">
              <circle cx="18" cy="18" r="15.915" fill="none" strokeWidth="5" pathLength={100} className="stroke-tint" />
              {arcs.filter((a) => a.value > 0).map((a) => <circle key={a.label} cx="18" cy="18" r="15.915" fill="none" strokeWidth="5" pathLength={100} strokeDasharray={`${a.pct} ${100 - a.pct}`} strokeDashoffset={-a.start} className={STROKE[a.tone]} />)}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-tight"><span className="text-xl font-bold tabular-nums">{centre ?? total}</span><span className="text-[0.65rem] uppercase tracking-wide text-muted">{unit || "total"}</span></div>
          </div>
          <ul className="space-y-1 text-sm" aria-label={`${title} (values)`}>
            {slices.map((s) => <li key={s.label} className="flex items-center gap-2"><span aria-hidden="true" className={`inline-block h-2.5 w-2.5 ${SWATCH[s.tone]}`} /><span>{s.label}</span><span className="tabular-nums font-semibold" data-testid={ids ? `stat-${s.label}` : undefined}>{s.value}</span><span className="text-xs text-muted">{Math.round((s.value / total) * 100)}%</span></li>)}
          </ul>
        </div>)}
    </figure>
  );
}

/** Vertical columns for a short series (a count per department or per month). */
export function Columns({ title, items, tone = "ink", empty = "Nothing to show yet.", ids }: { title: string; items: { label: string; value: number; href?: string }[]; tone?: Tone; empty?: string; ids?: boolean }) {
  const max = Math.max(1, ...items.map((i) => i.value)); const n = Math.max(items.length, 1); const slot = 100 / n;
  return (
    <figure aria-label={title} className="space-y-2">
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      {items.length === 0 ? <p className="text-sm text-muted">{empty}</p> : (
        <>
          {items.every((i) => i.value === 0) ? <p className="text-sm text-muted">{empty}</p> : <svg className="h-36 w-full" aria-hidden="true" focusable="false" preserveAspectRatio="none">
            <line x1="0" x2="100%" y1="127" y2="127" className="stroke-border" />
            {items.map((i, k) => { const h = (i.value / max) * 112; return <rect key={i.label} className={FILL[tone]} x={`${k * slot + slot * 0.2}%`} width={`${slot * 0.6}%`} y={127 - h} height={h} />; })}
          </svg>}
          <ul className="grid text-center text-xs" aria-label={`${title} (values)`} data-cols={n}>
            <li className="flex flex-wrap justify-around gap-x-3 gap-y-1">
              {items.map((i) => <span key={i.label}>{i.href ? <a href={i.href} className="underline">{i.label}</a> : i.label}: <strong className="tabular-nums" data-testid={ids ? `stat-${i.label}` : undefined}>{i.value}</strong></span>)}
            </li>
          </ul>
        </>)}
    </figure>
  );
}

/** A single measured share: "11 of 24 verified" as a thin bar with the fraction written out. */
export function Meter({ label, value, of, tone = "ink" }: { label: string; value: number; of: number; tone?: Tone }) {
  const pct = of > 0 ? Math.min(100, (value / of) * 100) : 0;
  return (
    <div className="space-y-1" role="group" aria-label={label}>
      <div className="flex items-baseline justify-between gap-3 text-sm"><span>{label}</span><span className="tabular-nums"><strong>{value}</strong> <span className="text-muted">of {of}</span></span></div>
      <svg className="h-2 w-full" aria-hidden="true" focusable="false"><rect className="fill-tint" width="100%" height="8" /><rect className={FILL[tone]} width={`${pct}%`} height="8" /></svg>
    </div>
  );
}
