const TONE: Record<string, string> = {
  // success
  APPROVED: "success", ACTIVE: "success", HANDLED: "success", ELIGIBLE: "success", REGISTERED: "success",
  // pending / in progress
  SUBMITTED: "warning", UNDER_REVIEW: "warning", PENDING: "warning", NEW: "warning", INVITED: "warning", NEEDS_DATA: "warning",
  // negative
  REJECTED: "danger", NOT_ELIGIBLE: "danger", SUSPENDED: "danger", EXPIRED: "danger", DISABLED: "danger",
  // neutral
  NOT_STARTED: "neutral", WITHDRAWN: "neutral", NO_INVITATION: "neutral",
};
const STYLE: Record<string, string> = {
  success: "border-success/40 text-success",
  warning: "border-warning/40 text-warning",
  danger: "border-danger/40 text-danger",
  neutral: "border-border text-muted",
};

export const humanize = (v: string) => v.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function StatusBadge({ value, label }: { value: string; label?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STYLE[TONE[value] ?? "neutral"]}`}>
      {label ?? humanize(value)}
    </span>
  );
}
