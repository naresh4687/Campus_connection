import Link from "next/link";

export type NextStep = { text: string; href: string };

/**
 * The first thing to do on a dashboard, made big and obvious, with anything else that is waiting listed under it.
 * Renders nothing when there is nothing to do. All items stay in one list so assistive technology reads them together.
 */
export function NextSteps({ items }: { items: NextStep[] }) {
  if (items.length === 0) return null;
  const [first, ...rest] = items;
  return (
    <section aria-labelledby="next-step" className="rounded-3xl border border-primary/30 bg-tint p-5 sm:p-6">
      <h2 id="next-step" className="text-xs font-semibold uppercase tracking-wider text-primary">Next step</h2>
      <ul aria-label="Needs your attention" className="mt-2 space-y-3">
        <li>
          <Link href={first.href} className="group flex flex-wrap items-center justify-between gap-3 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
            <span className="font-display text-xl font-bold leading-snug sm:text-2xl">{first.text}</span>
            <span aria-hidden="true" className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition group-hover:-translate-y-px">Open →</span>
          </Link>
        </li>
        {rest.length > 0 ? (
          <li className="border-t border-border pt-3">
            <p className="text-sm font-semibold">Also waiting</p>
            <ul className="mt-1 space-y-1 text-sm">
              {rest.map((t) => <li key={t.text}><Link href={t.href} className="underline">{t.text}</Link></li>)}
            </ul>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
