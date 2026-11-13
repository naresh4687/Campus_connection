import type { DriveCounts } from "@/server/registrations/queries";

/** Aggregate numbers only — no student-level data. Eligible/needs-data/not-eligible are computed live by the engine over the college's students. */
export function DriveCountsView({ c }: { c: DriveCounts }) {
  const items: [string, number][] = [["Eligible", c.eligible], ["Needs verified data", c.needs_data], ["Not eligible", c.not_eligible], ["Registered", c.registered], ["Withdrawn", c.withdrawn]];
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5" aria-label="Drive counts">
      {items.map(([k, v]) => (<div key={k} className="rounded-xl border border-border bg-surface p-3"><dt className="text-muted">{k}</dt><dd className="text-xl font-semibold">{v}</dd></div>))}
    </dl>
  );
}
