import { StatusBadge } from "@/components/ui/status-badge";
import type { CareerCategory } from "@/lib/career";
import { fmtDateTime } from "@/lib/format";
import type { CareerHistoryRow } from "@/server/students/queries";
import type { ReactNode } from "react";

/**
 * A student's career preference and how it changed over time. `children` is the change form, given only to the staff
 * who may use it (coordinators). Career preference is not a placement status: the text says so, because people confuse them.
 */
export function CareerPanel({ current, categories, history, children }: { current: string; categories: CareerCategory[]; history: CareerHistoryRow[]; children?: ReactNode }) {
  const label = (code: string) => categories.find((c) => c.code === code)?.label ?? code;
  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge value={current === "PLACEMENT" ? "ACTIVE" : "NOT_STARTED"} label={label(current)} />
        <span className="text-muted">This is what the student is aiming for now. It is not a placement status and never blocks applying to a drive.</span>
      </p>
      {children}
      <div>
        <h3 className="text-sm font-semibold">History</h3>
        {history.length === 0 ? <p className="mt-1 text-sm text-muted">No changes yet. New students start as {label("UNDECIDED")}.</p> : (
          <ol className="mt-2 divide-y divide-border text-sm" aria-label="Career preference history">
            {history.map((h) => (
              <li key={h.id} className="py-2.5 first:pt-0 last:pb-0">
                <p><span className="font-medium">{label(h.previous)}</span> to <span className="font-medium">{label(h.new_preference)}</span></p>
                <p className="text-muted">{h.reason}</p>
                <p className="text-xs text-muted">{h.changed_by_name ?? "Staff"}, {fmtDateTime(h.changed_at)}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
