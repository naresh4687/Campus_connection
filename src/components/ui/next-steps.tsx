import Link from "next/link";

export type NextStep = { text: string; href: string };

/**
 * The first thing to do on a dashboard, made big and obvious, with anything else that is waiting listed under it.
 * Renders nothing when there is nothing to do. All items stay in one list so assistive technology reads them together.
 * Drawn on ink in both themes, like the landing page's dark band, raised off the page.
 */
export function NextSteps({ items }: { items: NextStep[] }) {
  if (items.length === 0) return null;
  const [first, ...rest] = items;
  return (
    <section aria-labelledby="next-step" className="rise overflow-hidden rounded-2xl bg-[#101210] text-[#eef3e8] ring-1 ring-white/10 neu-raise">
      <div className="p-5 sm:p-6">
        <h2 id="next-step" className="flex items-center gap-2 text-[#a3e14e]">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#a3e14e]" />Next step
        </h2>
        <ul aria-label="Needs your attention" className="mt-3 space-y-4">
          <li>
            <Link href={first.href} className="group flex flex-wrap items-center justify-between gap-4 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#a3e14e]">
              <span className="max-w-2xl text-xl font-bold leading-snug sm:text-2xl">{first.text}</span>
              <span aria-hidden="true" className="inline-flex h-10 items-center rounded-full bg-[#a3e14e] px-5 text-sm font-semibold text-[#101210] transition-transform duration-150 group-hover:translate-x-0.5 group-active:scale-95">Open</span>
            </Link>
          </li>
          {rest.length > 0 ? (
            <li className="border-t border-white/12 pt-4">
              <p className="text-sm font-semibold text-[#a0a996]">Also waiting</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {rest.map((t) => <li key={t.text}><Link href={t.href} className="underline decoration-white/30 underline-offset-4 hover:decoration-white">{t.text}</Link></li>)}
              </ul>
            </li>
          ) : null}
        </ul>
      </div>
    </section>
  );
}
