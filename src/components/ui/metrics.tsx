import Link from "next/link";
import type { ReactNode } from "react";

export type Metric = {
  label: string;
  value: number | string;
  href?: string;
  hint?: string;
  /** Shown with the signal colour when the number is above zero: something here needs someone's attention. */
  attention?: boolean;
};

const COLS: Record<number, string> = {
  1: "",
  2: "@lg:grid-cols-2",
  3: "@lg:grid-cols-3",
  4: "@lg:grid-cols-2 @3xl:grid-cols-4",
  5: "@lg:grid-cols-3 @3xl:grid-cols-5",
};

/**
 * A group of numbers in one panel, separated by hairlines (instead of one box per number). Two across on a phone; the
 * last cell spans the row when the count is odd so no gap shows. A <dl>, so each label stays tied to its number.
 * `stat-<label>` test ids sit on the bare number.
 */
export function MetricGrid({ items, label }: { items: Metric[]; label?: string }) {
  const n = Math.min(Math.max(items.length, 1), 5);
  // Its own container, so the column count follows the panel's width (half-width panels stay at fewer columns).
  return (
    <div className="@container">
    <dl aria-label={label} className={`grid grid-cols-2 gap-4 p-4 sm:p-5 [&>*:last-child:nth-child(odd)]:col-span-2 ${COLS[n]} ${n === 4 ? "@3xl:[&>*:last-child:nth-child(odd)]:col-span-1" : ""} ${n === 3 || n === 5 ? "@lg:[&>*:last-child:nth-child(odd)]:col-span-1" : ""}`}>
      {items.map((m) => {
        const hot = m.attention && Number(m.value) > 0;
        return (
          <div key={m.label} className={`relative rounded-xl p-4 neu-inset ${m.href ? "transition-colors duration-150 hover:bg-tint has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary" : ""}`}>
            <dt className="flex items-center gap-2 text-sm font-medium opacity-80 [overflow-wrap:normal]">
              {hot ? <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-accent" /> : null}
              {m.label}
            </dt>
            <dd className="mt-2 text-[1.9rem] font-bold leading-none tabular-nums">
              {m.href ? (
                <Link href={m.href} className="after:absolute after:inset-0 focus-visible:outline-none">
                  <span className="sr-only">{m.label}: </span>
                  <span data-testid={`stat-${m.label}`}>{m.value}</span>
                </Link>
              ) : <span data-testid={`stat-${m.label}`}>{m.value}</span>}
              {m.hint ? <span className="mt-1.5 block text-xs font-normal normal-case leading-normal opacity-80 [font-stretch:100%]">{m.hint}</span> : null}
            </dd>
          </div>
        );
      })}
    </dl>
    </div>
  );
}

/** A titled panel: header row (title, optional link on the right) over its content. */
export function Panel({ title, id, action, children, flush }: { title: string; id: string; action?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section aria-labelledby={id} className="card card-accent overflow-hidden [--card-pt:0rem]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pb-1 pt-5 sm:px-5 sm:pt-6">
        <h2 id={id}>{title}</h2>
        {action ? <div className="text-sm">{action}</div> : null}
      </div>
      <div className={flush ? "" : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

/** The last word of a title is highlighted with the theme's lime, as a marker stroke (the text keeps full contrast). */
function accentLast(title: string) {
  const i = title.lastIndexOf(" ");
  if (i < 0) return title;
  return <>{title.slice(0, i + 1)}<mark className="rounded-md bg-brand px-1.5 text-brand-foreground">{title.slice(i + 1)}</mark></>;
}

/** Page title, one line of context, and the page's main actions on the right. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1>{accentLast(title)}</h1>
        {description ? <p className="mt-3 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Text link styled for panel headers and lists. */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground">{children}</Link>;
}
