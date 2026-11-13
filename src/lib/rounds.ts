export const ROUND_KINDS = [
  { value: "APTITUDE", label: "Aptitude / online test" }, { value: "TECHNICAL", label: "Technical interview" },
  { value: "GROUP_DISCUSSION", label: "Group discussion" }, { value: "HR", label: "HR interview" }, { value: "OTHER", label: "Other" },
] as const;
export const roundKindLabel = (v: string) => ROUND_KINDS.find((k) => k.value === v)?.label ?? v;
export const RESULT_LABEL: Record<string, string> = { PENDING: "No decision yet", SELECTED: "Selected", REJECTED: "Not selected", ABSENT: "Absent" };
export const RESULT_TONE: Record<string, string> = { PENDING: "PENDING", SELECTED: "APPROVED", REJECTED: "REJECTED", ABSENT: "NOT_STARTED" };
