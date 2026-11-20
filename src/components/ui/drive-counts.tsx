import { MetricGrid } from "@/components/ui/metrics";
import type { DriveCounts } from "@/server/registrations/queries";

/** Aggregate numbers only — no student-level data. Eligible/needs-data/not-eligible are computed live by the engine over the college's students. */
export function DriveCountsView({ c }: { c: DriveCounts }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <MetricGrid label="Drive counts" items={[
        { label: "Eligible", value: c.eligible },
        { label: "Needs verified data", value: c.needs_data },
        { label: "Not eligible", value: c.not_eligible },
        { label: "Registered", value: c.registered },
        { label: "Withdrawn", value: c.withdrawn },
      ]} />
    </div>
  );
}
