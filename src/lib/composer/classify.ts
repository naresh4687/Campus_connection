import { INJECTION_RE, normalizeSource } from "@/lib/intake/rules";
import type { Kind } from "@/lib/announcements";

/**
 * Decides what a pasted placement message IS before anything is created from it. The result is a SUGGESTION with reasons (each quoting the
 * message); staff always confirm or override it. Nothing here publishes, saves or addresses anyone.
 */
export const PURPOSES = ["AUTO", "NEW_DRIVE", "ON_CAMPUS_DRIVE", "INTERVIEW_UPDATE", "TRAINING_VENUE", "SHORTLIST_CONSENT", "GENERAL", "OTHER"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const PURPOSE_LABEL: Record<Purpose, string> = {
  AUTO: "Detect automatically", NEW_DRIVE: "New placement drive", ON_CAMPUS_DRIVE: "On-campus drive schedule", INTERVIEW_UPDATE: "Interview and recruitment update", TRAINING_VENUE: "Training and venue details",
  SHORTLIST_CONSENT: "Shortlisted candidate / consent update", GENERAL: "General placement announcement", OTHER: "Other placement information",
};
export const isPurpose = (v: unknown): v is Purpose => typeof v === "string" && (PURPOSES as readonly string[]).includes(v);

export type Category = "NEW_DRIVE" | "ON_CAMPUS_DRIVE" | "RECRUITMENT_PROCESS" | "TRAINING_VENUE" | "ALTERNATE_ROLE_CONSENT" | "GENERAL";
export type Destination = "DRIVE" | "ANNOUNCEMENT";
export const CATEGORY_LABEL: Record<Category, string> = {
  NEW_DRIVE: "New recruitment opportunity", ON_CAMPUS_DRIVE: "On-campus drive schedule", RECRUITMENT_PROCESS: "Recruitment process update", TRAINING_VENUE: "Training and venue information",
  ALTERNATE_ROLE_CONSENT: "Alternate role / consent", GENERAL: "General placement announcement",
};
export const DESTINATION_OF: Record<Category, Destination> = { NEW_DRIVE: "DRIVE", ON_CAMPUS_DRIVE: "ANNOUNCEMENT", RECRUITMENT_PROCESS: "ANNOUNCEMENT", TRAINING_VENUE: "ANNOUNCEMENT", ALTERNATE_ROLE_CONSENT: "ANNOUNCEMENT", GENERAL: "ANNOUNCEMENT" };
/** The announcement kind each announcement category is saved as (the schema of migration 0028). */
export const KIND_OF: Record<Exclude<Category, "NEW_DRIVE">, Kind> = { ON_CAMPUS_DRIVE: "ON_CAMPUS_DRIVE", RECRUITMENT_PROCESS: "RECRUITMENT_UPDATE", TRAINING_VENUE: "TRAINING_VENUE", ALTERNATE_ROLE_CONSENT: "ALTERNATE_ROLE_CONSENT", GENERAL: "GENERAL" };
/** What staff mean when they pick a purpose by hand. */
export const CATEGORY_OF_PURPOSE: Record<Exclude<Purpose, "AUTO">, Category> = { NEW_DRIVE: "NEW_DRIVE", ON_CAMPUS_DRIVE: "ON_CAMPUS_DRIVE", INTERVIEW_UPDATE: "RECRUITMENT_PROCESS", TRAINING_VENUE: "TRAINING_VENUE", SHORTLIST_CONSENT: "ALTERNATE_ROLE_CONSENT", GENERAL: "GENERAL", OTHER: "GENERAL" };

type Signal = { re: RegExp; w: number; why: string };
const S = (re: RegExp, w: number, why: string): Signal => ({ re, w, why });

const SIGNALS: Record<Category, Signal[]> = {
  NEW_DRIVE: [
    S(/\b(?:is|are)\s+(?:hiring|looking for|recruiting)\b|\bhiring\b|\brecruitment (?:drive|opportunity)\b|\bjob (?:opening|opportunity)\b/i, 3, "announces hiring"),
    S(/\b(?:ctc|lpa|package|salary|stipend|per month|per annum)\b/i, 2, "states pay"),
    S(/\beligib(?:le|ility)\b|\bcriteria\b|\bminimum\s+(?:cgpa|\d+\s*%)|\bcgpa\b/i, 2, "states eligibility criteria"),
    S(/\b(?:20\d\d)\s*(?:batch|passed[- ]?outs?|graduates)|\bbatch\s*(?:of\s*)?20\d\d\b/i, 2, "names an eligible batch"),
    S(/\b(?:apply|register|registration)\b[^.\n]{0,60}\b(?:link|form|here|below|before|by|on)\b|docs\.google\.com\/forms|forms\.gle\/|\bregistration (?:link|form)\b/i, 3, "asks students to apply or register"),
    S(/\b(?:job (?:role|title|description)|roles? and responsibilities|designation|skills? required|required skills)\b/i, 2, "describes a job role"),
    S(/\bfreshers?\b|\bfull[- ]time\b|\binternship\b/i, 1, "mentions employment type"),
    S(/\b(?:last date|deadline)\b[^.\n]{0,40}\b(?:apply|registration|register)\b|\b(?:apply|register)\b[^.\n]{0,40}\b(?:last date|deadline|before)\b/i, 2, "has an application deadline"),
  ],
  ON_CAMPUS_DRIVE: [
    S(/\bon[- ]?campus (?:drive|recruitment|placement|interview)\b/i, 5, "says it is an on-campus drive"),
    S(/\bpre[- ]?placement talk\b|\bPPT\b/i, 2, "mentions a pre-placement talk"),
    S(/\bregistered students?\b|\bstudents? (?:who )?(?:have )?registered\b/i, 3, "addresses registered students"),
    S(/\b(?:name of the company|company name)\s*:/i, 1, "uses the circular layout (Name of the company)"),
    S(/\b(?:venue|auditorium|seminar hall|placement cell)\b/i, 1, "gives a venue"),
    S(/\binterview process\b|\bround\s*\d|\bfinal round\b/i, 1, "lists interview rounds"),
  ],
  RECRUITMENT_PROCESS: [
    S(/\b(?:interview|test|assessment|round)\s+(?:will be|is|are)\s+(?:held|conducted|scheduled)\b|\bschedule[ds]?\b[^.\n]{0,40}\b(?:interview|round|test)\b|\binterview schedule\b/i, 3, "gives an interview or round schedule"),
    S(/\bshortlist(?:ed)?\b/i, 3, "mentions shortlisted candidates"),
    S(/\b(?:technical|hr|aptitude|coding|machine test|group discussion)\s+(?:round|interview|test)\b/i, 2, "names a recruitment round"),
    S(/\b(?:venue|timing|time|reporting time)\s+(?:has been |is |will be )?(?:changed|revised|rescheduled|postponed)|\brescheduled\b|\bpostponed\b|\bcancell?ed\b/i, 3, "changes or cancels an arrangement"),
    S(/\b(?:report|reach)\b[^.\n]{0,40}\b(?:by|at|before)\b/i, 1, "tells students when to report"),
  ],
  TRAINING_VENUE: [
    S(/\btraining\b/i, 3, "is about training"),
    S(/\b(?:venue|classroom|class room|lab|hall|room)s?\s*(?:details|allocation|:)|\bvenue details\b|\bassigned (?:classroom|venue|room)\b/i, 3, "gives venues or classrooms"),
    S(/\bbatch\s*\d+\s*[:\-–|]/i, 4, "assigns venues by batch"),
    S(/\b(?:cc|cr|lab|room|hall)[- ]?\d+\b/i, 2, "names classrooms"),
    S(/\breport to (?:their|your|the) (?:assigned )?(?:classroom|class room|venue)|ensure they report\b/i, 3, "tells students to report to a classroom"),
  ],
  ALTERNATE_ROLE_CONSENT: [
    S(/\balternate (?:role|opportunity|position|offer)\b|\balternative (?:role|opportunity|position)\b/i, 5, "offers an alternate role"),
    S(/\bconsent\b|\bwilling(?:ness)?\b|\bconfirm (?:your )?(?:interest|acceptance|willingness)\b|\bkindly (?:confirm|revert|reply)\b/i, 4, "asks for the candidate's consent"),
    S(/\bconsidered (?:earlier|previously|in the (?:previous|earlier) )|\bpreviously (?:considered|interviewed|shortlisted)\b|\bearlier (?:recruitment|process|drive)\b/i, 2, "refers to candidates from an earlier process"),
    S(/\bFTE\b|\bfull[- ]time (?:employment|conversion)\b|\bconversion\b/i, 1, "mentions possible full-time conversion"),
    S(/\bservice agreement\b|\bbond\b|\brepay(?:ment)?\b/i, 1, "states service conditions"),
  ],
  GENERAL: [
    S(/\b(?:resume|cv)\b[^.\n]{0,40}\b(?:submit|upload|update|send)\b/i, 2, "asks about resumes"),
    S(/\b(?:reminder|kindly note|important notice|instructions?|all students|dress code|punctual)\b/i, 1, "is a general notice"),
    S(/\bplacement (?:cell|office|department)\b/i, 1, "comes from the placement office"),
  ],
};

export type Reason = { category: Category; why: string; quote: string };
export type Classification = {
  category: Category; destination: Destination; confident: boolean;
  /** Plain-language explanation, quoting the message. */
  reasons: Reason[]; alternatives: { category: Category; score: number }[]; score: number;
  /** Set when the text contains instructions aimed at an AI/system rather than at students. The text is still only data. */
  injection: boolean; warnings: string[];
};

const quoteAround = (src: string, m: RegExpExecArray) => src.slice(Math.max(0, m.index - 10), Math.min(src.length, m.index + m[0].length + 30)).replace(/\s+/g, " ").trim().slice(0, 120);

/**
 * Scores each category from phrases in the message. Confident only when one category clearly leads; otherwise staff must choose.
 * A message that mentions a company is NOT a new drive: a drive needs hiring/pay/eligibility/apply signals, and schedule or consent wording pulls the other way.
 */
export function classifyMessage(raw: string): Classification {
  const src = normalizeSource(raw);
  const scores = {} as Record<Category, number>; const reasons: Reason[] = [];
  for (const cat of Object.keys(SIGNALS) as Category[]) {
    let total = 0;
    for (const sig of SIGNALS[cat]) {
      const m = new RegExp(sig.re.source, sig.re.flags.replace("g", "")).exec(src);
      if (m) { total += sig.w; reasons.push({ category: cat, why: sig.why, quote: quoteAround(src, m) }); }
    }
    scores[cat] = total;
  }
  // A consent request is an announcement even though it also mentions pay and a role.
  if (scores.ALTERNATE_ROLE_CONSENT >= 5) scores.NEW_DRIVE = Math.max(0, scores.NEW_DRIVE - 6);
  // A schedule for a named company's on-campus event is not a recruitment opportunity.
  if (scores.ON_CAMPUS_DRIVE >= 5) scores.NEW_DRIVE = Math.max(0, scores.NEW_DRIVE - 5);
  const ranked = (Object.keys(scores) as Category[]).map((c) => ({ category: c, score: scores[c] })).sort((a, b) => b.score - a.score || (a.category === "GENERAL" ? 1 : -1));
  const top = ranked[0]; const second = ranked[1];
  const category: Category = top.score >= 3 ? top.category : "GENERAL";
  const confident = top.score >= 4 && top.score - second.score >= 2;
  const warnings: string[] = [];
  if (!confident) warnings.push("The message fits more than one type, or none clearly. Please choose the type yourself.");
  const injection = INJECTION_RE.test(src);
  if (injection) warnings.push("The message contains instructions aimed at an AI assistant. They were ignored and treated as text.");
  return {
    category, destination: DESTINATION_OF[category], confident, score: top.score, injection, warnings,
    reasons: reasons.filter((r) => r.category === category).slice(0, 6),
    alternatives: ranked.filter((r) => r.category !== category && r.score > 0).slice(0, 3),
  };
}

/** A manual choice always wins over the suggestion. */
export function resolveCategory(purpose: Purpose, detected: Classification): { category: Category; destination: Destination; overridden: boolean } {
  if (purpose === "AUTO") return { category: detected.category, destination: detected.destination, overridden: false };
  const category = CATEGORY_OF_PURPOSE[purpose];
  return { category, destination: DESTINATION_OF[category], overridden: category !== detected.category };
}
