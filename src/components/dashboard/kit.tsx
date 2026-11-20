import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Building blocks for the dashboards: soft raised cards with an icon header, a gauge, small stat cards, a trend line, progress rows, a pipeline and a tinted
 * "needs attention" card. Plain SVG/HTML (no client JavaScript, no inline styles). Colours are the site theme's tokens only.
 */
const ICONS: Record<string, string> = {
  users: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.2a3 3 0 0 1 0 5.6",
  building: "M4 20V6l8-3 8 3v14M9 20v-4h6v4M8 9h.01M12 9h.01M16 9h.01M8 12.5h.01M12 12.5h.01M16 12.5h.01",
  briefcase: "M4 8h16v11H4zM9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M4 13h16",
  check: "M5 12.5l4.5 4.5L19 7.5",
  shield: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z M9 12l2 2 4-4",
  file: "M7 3h7l4 4v14H7zM14 3v4h4M9.5 12h5M9.5 15.5h5",
  calendar: "M5 6h14v14H5zM5 10h14M9 3v4M15 3v4",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0",
  alert: "M12 4l9 16H3zM12 10v4M12 17h.01",
  chart: "M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-7",
  grad: "M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  upload: "M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19h14",
};
export function Icon({ name, className = "h-5 w-5" }: { name: keyof typeof ICONS | string; className?: string }) {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[name] ?? ICONS.chart} /></svg>;
}

/** A raised card with the icon-tile header used throughout the dashboards. */
export function DashCard({ title, icon, id, action, children, tone, className = "" }: { title: string; icon?: string; id: string; action?: ReactNode; children: ReactNode; tone?: "attention"; className?: string }) {
  return (
    <section aria-labelledby={id} className={`card p-5 ${tone === "attention" ? "bg-[color-mix(in_srgb,var(--accent)_13%,var(--surface))]" : ""} ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 max-w-full items-center gap-3">
          {icon ? <span aria-hidden="true" className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl neu-inset ${tone === "attention" ? "text-accent" : ""}`}><Icon name={icon} className="h-[18px] w-[18px]" /></span> : null}
          <h2 id={id} className="truncate">{title}</h2>
        </div>
        {action ? <div className="min-w-0 max-w-full text-sm [overflow-wrap:anywhere]">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A small raised control-looking pill (date, filter label, link). */
export function Pill({ children, href }: { children: ReactNode; href?: string }) {
  const cls = "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium neu-raise-sm";
  return href ? <Link href={href} className={`${cls} hover:text-foreground`}>{children}</Link> : <span className={cls}>{children}</span>;
}

/** Semicircle gauge: the share `value / of` as a percentage, with a tick scale and a caption. Shows an en dash when there is nothing to measure. */
export function Gauge({ title, value, of, caption, link }: { title: string; value: number; of: number; caption: string; link?: ReactNode }) {
  const pct = of > 0 ? Math.min(100, Math.round((value / of) * 100)) : null;
  const ticks = Array.from({ length: 41 }, (_, i) => { const a = Math.PI - (i / 40) * Math.PI; const r1 = 49; const r2 = i % 10 === 0 ? 43 : 45.5; return { x1: 60 + r1 * Math.cos(a), y1: 60 - r1 * Math.sin(a), x2: 60 + r2 * Math.cos(a), y2: 60 - r2 * Math.sin(a), major: i % 10 === 0 }; });
  return (
    <figure aria-label={title} className="space-y-1">
      <div className="mb-1 flex items-center justify-between gap-3"><figcaption className="text-sm font-bold">{title}</figcaption>{link ? <span className="text-sm">{link}</span> : null}</div>
      <svg viewBox="0 0 120 70" className="mx-auto w-full max-w-[17rem]" aria-hidden="true" focusable="false">
        {ticks.map((t, i) => <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} strokeWidth={t.major ? 0.9 : 0.5} className="stroke-foreground/35" />)}
        <path d="M 14 60 A 46 46 0 0 1 106 60" fill="none" strokeWidth="7" strokeLinecap="round" pathLength={100} className="stroke-tint" />
        {pct ? <path d="M 14 60 A 46 46 0 0 1 106 60" fill="none" strokeWidth="7" strokeLinecap="round" pathLength={100} strokeDasharray={`${pct} 100`} className="stroke-brand" /> : null}
        <text x="60" y="52" textAnchor="middle" className="fill-foreground text-[17px] font-bold">{pct === null ? "–" : pct}<tspan className="text-[8px] font-semibold">{pct === null ? "" : "%"}</tspan></text>
        <text x="60" y="63" textAnchor="middle" className="fill-muted text-[5.5px]">{caption}</text>
      </svg>
      <p className="text-center text-xs text-muted"><span className="tabular-nums font-semibold text-foreground">{value}</span> of <span className="tabular-nums">{of}</span></p>
    </figure>
  );
}

/** A small stat card: icon tile, label, number. `id` puts the `stat-<label>` test id on the number. */
export function MiniStat({ icon, label, value, href, id, hint }: { icon: string; label: string; value: number | string; href?: string; id?: boolean; hint?: string }) {
  const body = (
    <>
      <span aria-hidden="true" className="inline-flex h-8 w-8 items-center justify-center rounded-lg neu-inset"><Icon name={icon} className="h-4 w-4" /></span>
      <p className="mt-2 min-h-[2.1em] text-[0.68rem] font-medium leading-tight text-muted [overflow-wrap:break-word]">{label}</p>
      <p className="mt-0.5 text-2xl font-bold leading-none tabular-nums" data-testid={id ? `stat-${label}` : undefined}>{value}</p>
      {hint ? <p className="mt-1 text-[0.7rem] text-muted">{hint}</p> : null}
    </>
  );
  return href ? <Link href={href} className="card block h-full min-w-0 p-2.5 hover:bg-tint focus-visible:outline-2 focus-visible:outline-primary">{body}</Link> : <div className="card h-full min-w-0 p-2.5">{body}</div>;
}

/** A trend line over a short series, with the peak called out in words beneath. */
export function LineChart({ title, points, unit, empty = "Nothing recorded in this period." }: { title: string; points: { label: string; value: number }[]; unit: string; empty?: string }) {
  const max = Math.max(1, ...points.map((p) => p.value)); const total = points.reduce((a, p) => a + p.value, 0);
  const W = 300; const H = 96; const n = Math.max(points.length - 1, 1);
  const xy = points.map((p, i) => ({ ...p, x: 6 + (i / n) * (W - 12), y: H - 10 - (p.value / max) * (H - 24) }));
  const peak = xy.reduce((a, b) => (b.value > a.value ? b : a), xy[0]);
  const line = xy.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <figure aria-label={title} className="space-y-2">
      <figcaption className="text-sm font-bold">{title}</figcaption>
      {points.length === 0 || total === 0 ? <p className="text-sm text-muted">{empty}</p> : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden="true" focusable="false">
            {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H - 10 - f * (H - 24)} y2={H - 10 - f * (H - 24)} className="stroke-border" strokeDasharray="2 3" strokeWidth="0.6" />)}
            <path d={`${line} L${xy[xy.length - 1].x},${H - 10} L${xy[0].x},${H - 10} Z`} className="fill-brand/25" />
            <path d={line} fill="none" strokeWidth="4.2" strokeLinejoin="round" strokeLinecap="round" className="stroke-foreground/15" />
            <path d={line} fill="none" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" className="stroke-[var(--chart-1,#a3e14e)]" />
            <circle cx={peak.x} cy={peak.y} r="3.2" className="fill-brand stroke-foreground" strokeWidth="1.2" />
          </svg>
          <div className="flex justify-between text-[0.7rem] text-muted"><span>{fmt(points[0].label)}</span><span>{fmt(points[Math.floor(points.length / 2)].label)}</span><span>{fmt(points[points.length - 1].label)}</span></div>
          <p className="text-xs text-muted">Peak: <strong className="tabular-nums text-foreground">{peak.value}</strong> {unit} on {fmt(peak.label)} · <span className="tabular-nums">{total}</span> in total</p>
        </>)}
    </figure>
  );
}

export type ProgressRow = { label: string; value: number; of: number; href?: string; note?: string };
/** Rows of "label — bar — value — percent", like a bed-status list. */
export function ProgressRows({ title, rows, empty = "Nothing to show yet." }: { title: string; rows: ProgressRow[]; empty?: string }) {
  return (
    <div className="divide-y divide-border" role="group" aria-label={title}>
      {rows.length === 0 ? <p className="text-sm text-muted">{empty}</p> : rows.map((r) => {
        const pct = r.of > 0 ? Math.min(100, Math.round((r.value / r.of) * 100)) : 0;
        return (
          <div key={r.label} className="grid grid-cols-[minmax(0,6.5rem)_1fr_auto] items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
            <span className="truncate" title={r.label}>{r.href ? <Link href={r.href} className="underline decoration-border underline-offset-2">{r.label}</Link> : r.label}</span>
            <svg className="h-2.5 w-full" aria-hidden="true" focusable="false"><rect className="fill-tint" width="100%" height="10" rx="5" /><rect className="fill-brand" width={`${pct}%`} height="10" rx="5" /></svg>
            <span className="text-right tabular-nums text-xs"><strong>{r.value}</strong>/{r.of} <span className="text-muted">{r.of > 0 ? `${pct}%` : "–"}</span>{r.note ? <span className="sr-only"> {r.note}</span> : null}</span>
          </div>);
      })}
    </div>
  );
}

/** The hero: a row of labelled stage chips joined by a line (the funnel or a student's journey). Each chip's number carries the `stat-<label>` test id when `ids` is set. */
export function Pipeline({ label, stages, ids, footnote }: { label: string; stages: { label: string; value: number; icon: string; note?: string }[]; ids?: boolean; footnote?: string }) {
  return (
    <div role="group" aria-label={label} className="space-y-3">
      <ol className="relative grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(6.6rem,1fr))]">
        {stages.map((s, i) => (
          <li key={s.label} className="relative flex">
            {i < stages.length - 1 ? <span aria-hidden="true" className="absolute left-[calc(50%+2.2rem)] right-[-1rem] top-7 hidden h-0.5 bg-border sm:block" /> : null}
            <div className="card relative flex w-full flex-col items-center gap-1.5 p-3 text-center">
              <span aria-hidden="true" className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-brand text-brand-foreground neu-raise-sm"><Icon name={s.icon} className="h-5 w-5" /></span>
              <span className="text-xs font-medium text-muted">{s.label}</span>
              <span className="text-2xl font-bold leading-none tabular-nums" data-testid={ids ? `stat-${s.label}` : undefined}>{s.value}</span>
              <span className="min-h-[1.1em] text-[0.7rem] text-muted">{s.note ?? " "}</span>
            </div>
          </li>))}
      </ol>
      {footnote ? <p className="text-xs text-muted">{footnote}</p> : null}
    </div>
  );
}

export type Attention = { label: string; value: number; href: string; icon: string };
/** The tinted card: three counts that need someone's action, each a link. */
export function AttentionTiles({ items }: { items: Attention[] }) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Needs attention">
      {items.map((a) => (
        <li key={a.label}>
          <Link href={a.href} className="card block p-3 text-center hover:bg-tint focus-visible:outline-2 focus-visible:outline-primary">
            <span aria-hidden="true" className="mx-auto inline-flex h-8 w-8 items-center justify-center rounded-lg neu-inset"><Icon name={a.icon} className="h-4 w-4" /></span>
            <span className="mt-1 block text-2xl font-bold leading-none tabular-nums">{a.value}</span>
            <span className="mt-1 block text-xs text-muted">{a.label}</span>
          </Link>
        </li>))}
    </ul>
  );
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
/** A list of people or items: initials badge, two lines, and a status chip on the right. */
export function PersonList({ rows, empty = "Nothing yet." }: { rows: { key: string; name: string; sub: string; right?: ReactNode; meta?: string }[]; empty?: string }) {
  return rows.length === 0 ? <p className="text-sm text-muted">{empty}</p> : (
    <ul className="divide-y divide-border" aria-label="List">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
          <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground neu-raise-sm">{initials(r.name)}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{r.name}</span><span className="block truncate text-xs text-muted">{r.sub}</span></span>
          <span className="max-w-[45%] min-w-0 shrink text-right text-xs text-muted [overflow-wrap:anywhere] [&_span]:whitespace-normal">{r.meta ? <span className="block">{r.meta}</span> : null}{r.right}</span>
        </li>))}
    </ul>
  );
}

/** A drive that needs the student to act before a deadline: big countdown, company and role, and one clear button. Urgent (closing within two days) is tinted. */
export function DeadlineCard({ company, job, daysLeft, deadline, state, href, cta }: { company: string; job: string; daysLeft: number; deadline: string; state: string; href: string; cta: string }) {
  const urgent = daysLeft <= 2;
  return (
    <li className={`card flex flex-col gap-3 p-4 ${urgent ? "bg-[color-mix(in_srgb,var(--accent)_13%,var(--surface))]" : ""}`}>
      <div className="flex items-start gap-3">
        <div className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border ${urgent ? "border-accent" : "border-border"} bg-surface text-center`} aria-hidden="true">
          <span className="text-2xl font-bold leading-none tabular-nums">{daysLeft <= 0 ? "!" : daysLeft}</span>
          <span className="mt-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-muted">{daysLeft <= 0 ? "today" : daysLeft === 1 ? "day left" : "days left"}</span>
        </div>
        <div className="min-w-0">
          <p className="truncate font-bold">{company}</p>
          <p className="truncate text-sm text-muted">{job}</p>
          <p className="mt-1 text-xs"><span className="sr-only">{daysLeft <= 0 ? "Closes today. " : `Closes in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. `}</span>Apply by {deadline}</p>
        </div>
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{state}</p>
      <Link href={href} className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">{cta}</Link>
    </li>
  );
}
