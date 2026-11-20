/**
 * Profile completion: a fixed checklist, each item worth a fixed number of points (100 in total). The database view
 * `student_profile_completion` (migration 0025) computes the same flags and score; a test compares the two so they cannot drift.
 * It is guidance and a coordinator worklist only: eligibility never reads it.
 */
export type CompletionFlags = { contact: boolean; academics: boolean; semesters: boolean; document: boolean; career: boolean; achievement: boolean };
export type CompletionKey = keyof CompletionFlags;

export const COMPLETION_ITEMS: { key: CompletionKey; label: string; weight: number; todo: string; href: string }[] = [
  { key: "contact", label: "Contact details", weight: 15, todo: "Add your phone number and personal email.", href: "/student/profile" },
  { key: "academics", label: "Verified academic record", weight: 40, todo: "Submit your academic details and get them verified.", href: "/student/academics" },
  { key: "semesters", label: "Semester results", weight: 10, todo: "Add your semester-wise results to your academic record.", href: "/student/academics" },
  { key: "document", label: "Supporting document", weight: 10, todo: "Upload a mark sheet or certificate.", href: "/student/documents" },
  { key: "career", label: "Career interest", weight: 10, todo: "Ask your coordinator to record your career interest.", href: "/student/profile" },
  { key: "achievement", label: "Verified achievement", weight: 15, todo: "Add an achievement and get it verified.", href: "/student/achievements" },
];

export const completionScore = (f: CompletionFlags) => COMPLETION_ITEMS.reduce((n, i) => n + (f[i.key] ? i.weight : 0), 0);
export const missingItems = (f: CompletionFlags) => COMPLETION_ITEMS.filter((i) => !f[i.key]);

/** Filter bands used by the coordinator and administrator student lists. */
export const COMPLETION_BANDS: Record<string, { label: string; min: number; max: number }> = {
  low: { label: "Below 50%", min: 0, max: 49 }, mid: { label: "50% to 79%", min: 50, max: 79 }, high: { label: "80% to 99%", min: 80, max: 99 }, full: { label: "Complete (100%)", min: 100, max: 100 },
};
export const isBand = (v: unknown): v is keyof typeof COMPLETION_BANDS => typeof v === "string" && Object.hasOwn(COMPLETION_BANDS, v);
