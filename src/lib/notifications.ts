export const CATEGORY_LABEL: Record<string, string> = {
  DRIVES: "New placement drives", ROUNDS: "Rounds and results", OFFERS: "Selections and offers", PLACEMENT: "Placement verification",
  ACADEMICS: "Academic verification", DOCUMENTS: "Document reviews", TASKS: "Tasks waiting for you", ANNOUNCEMENTS: "Placement announcements",
};
export const CATEGORY_HELP: Record<string, string> = {
  DRIVES: "When a drive you can apply to is published.", ROUNDS: "When a round is announced or its results are released.", OFFERS: "Selection, offers, deadlines and withdrawals.",
  PLACEMENT: "Decisions on your joining record.", ACADEMICS: "When a coordinator verifies or returns your academic record.", DOCUMENTS: "When a coordinator reviews a document.", TASKS: "Submissions, offer responses and joining records that need your action.", ANNOUNCEMENTS: "Schedules, venues, instructions and updates from the placement office or your coordinator.",
};
/** Categories that can never be turned off (deadlines and decisions). Mirrors the database rule. */
export const ESSENTIAL = new Set(["OFFERS", "PLACEMENT"]);
export const CATEGORIES_FOR: Record<string, string[]> = {
  STUDENT: ["DRIVES", "ROUNDS", "OFFERS", "PLACEMENT", "ACADEMICS", "DOCUMENTS", "ANNOUNCEMENTS"], COORDINATOR: ["TASKS"], PLACEMENT_OFFICER: ["TASKS"], COLLEGE_ADMIN: [], PLATFORM_SUPER_ADMIN: [],
};
