export const ROUND_SUGGESTIONS = ["Aptitude test", "Group discussion", "Technical interview", "HR interview"] as const;
export const ROUND_STATUS_LABEL: Record<string, string> = { PLANNED: "Not started", OPEN: "Attendance open", CLOSED: "Attendance closed" };
export const EVENT_STATUS_LABEL: Record<string, string> = { UPCOMING: "Upcoming", COMPLETED: "Completed", CANCELLED: "Cancelled" };
export type CampusRoundStat = { round_id: string; round_number: number; eligible: number; present: number; advanced: number };
