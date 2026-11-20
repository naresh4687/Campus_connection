/**
 * Career preference: what a student is currently aiming for. It is NOT a placement status and is never used by the eligibility
 * engine, so a student interested in higher studies can still register for a drive, and a placement-interested student is not
 * "placed". The six codes are fixed (circulars and reports rely on them); colleges may rename or hide a category.
 */
export const CAREER_CODES = ["PLACEMENT", "HIGHER_STUDIES", "ENTREPRENEURSHIP", "OTHER", "UNDECIDED", "NOT_SEEKING_PLACEMENT"] as const;
export type CareerCode = (typeof CAREER_CODES)[number];

export const CAREER_DEFAULT_LABEL: Record<CareerCode, string> = {
  PLACEMENT: "Placement interested",
  HIGHER_STUDIES: "Higher studies interested",
  ENTREPRENEURSHIP: "Entrepreneurship interested",
  OTHER: "Other career path",
  UNDECIDED: "Undecided",
  NOT_SEEKING_PLACEMENT: "Not currently seeking placement",
};

export const isCareerCode = (v: unknown): v is CareerCode => typeof v === "string" && (CAREER_CODES as readonly string[]).includes(v);
export type CareerCategory = { code: CareerCode; label: string; active: boolean };
