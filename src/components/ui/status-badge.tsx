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
const STYLE: Record<string, { chip: string; dot: string }> = {
  success: { chip: "bg-brand/55 text-foreground", dot: "bg-foreground" },
  warning: { chip: "bg-warning/14 text-warning", dot: "bg-warning" },
  danger: { chip: "bg-danger/12 text-danger", dot: "bg-danger" },
  neutral: { chip: "bg-muted/12 text-muted", dot: "bg-muted" },
};

export const humanize = (v: string) => v.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function StatusBadge({ value, label }: { value: string; label?: string }) {
  const t = STYLE[TONE[value] ?? "neutral"];
  return (
    <span className={`badge inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.chip}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {label ?? humanize(value)}
    </span>
  );
}
