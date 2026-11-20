import { z } from "zod";
import { canonicalIdentifier } from "./normalize";
import { httpUrl } from "./validation";

export const KINDS = ["ON_CAMPUS_DRIVE", "INTERVIEW_SCHEDULE", "RECRUITMENT_UPDATE", "TRAINING_VENUE", "SHORTLIST_UPDATE", "ALTERNATE_ROLE_CONSENT", "REGISTRATION_REMINDER", "PLACEMENT_INSTRUCTIONS", "GENERAL"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABEL: Record<Kind, string> = {
  ON_CAMPUS_DRIVE: "On-campus drive schedule", INTERVIEW_SCHEDULE: "Interview schedule", RECRUITMENT_UPDATE: "Recruitment process update", TRAINING_VENUE: "Training and venue details",
  SHORTLIST_UPDATE: "Shortlisted candidate update", ALTERNATE_ROLE_CONSENT: "Alternate role / consent", REGISTRATION_REMINDER: "Registration reminder", PLACEMENT_INSTRUCTIONS: "Placement instructions", GENERAL: "General placement announcement",
};
export const isKind = (v: unknown): v is Kind => typeof v === "string" && (KINDS as readonly string[]).includes(v);

/** Which optional fields apply to which kind. The editor shows only these; the database enforces the few that are required to publish. */
export type OptionalField = "event_date" | "event_time" | "venue" | "stages" | "batches" | "consent_deadline" | "action_link" | "instructions";
const EVENT: OptionalField[] = ["event_date", "event_time", "venue", "instructions", "action_link"];
export const FIELDS_FOR: Record<Kind, OptionalField[]> = {
  ON_CAMPUS_DRIVE: [...EVENT, "stages"], INTERVIEW_SCHEDULE: [...EVENT, "stages"], RECRUITMENT_UPDATE: [...EVENT, "stages"],
  TRAINING_VENUE: ["event_date", "event_time", "venue", "batches", "instructions"], SHORTLIST_UPDATE: [...EVENT, "stages"],
  ALTERNATE_ROLE_CONSENT: ["consent_deadline", "action_link", "instructions", "event_date", "event_time", "venue"], REGISTRATION_REMINDER: ["event_date", "action_link", "instructions"],
  PLACEMENT_INSTRUCTIONS: ["event_date", "action_link", "instructions"], GENERAL: ["event_date", "action_link", "instructions"],
};
export const REQUIRED_NOTE: Partial<Record<Kind, string>> = {
  ON_CAMPUS_DRIVE: "Needs the event date to publish.", INTERVIEW_SCHEDULE: "Needs the event date to publish.", TRAINING_VENUE: "Needs a venue, or a venue for each batch, to publish.",
  ALTERNATE_ROLE_CONSENT: "Needs a consent deadline, and goes only to named students or the shortlisted students of a drive. Say clearly whether any full-time employment is conditional.",
};

export const PRIORITIES = ["NORMAL", "HIGH", "URGENT"] as const;
export const PRIORITY_LABEL: Record<string, string> = { NORMAL: "Normal", HIGH: "Important", URGENT: "Urgent" };
export const DISPLAY_MODES = ["SUMMARY", "ORIGINAL", "BOTH"] as const;
export const DISPLAY_LABEL: Record<string, string> = { SUMMARY: "Students see the summary", ORIGINAL: "Students see the original message", BOTH: "Students see the summary and the original message" };

export const SOURCES = ["ALL", "CAREER", "DRIVE_REGISTERED", "DRIVE_SHORTLISTED", "DRIVE_SELECTED", "NAMED"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<Source, string> = {
  ALL: "All students (narrowed below)", CAREER: "Students by career interest", DRIVE_REGISTERED: "Students registered for a drive", DRIVE_SHORTLISTED: "Shortlisted students of a drive (selected in a round)",
  DRIVE_SELECTED: "Selected students of a drive", NAMED: "Named students (by register number)",
};
export const STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", PUBLISHED: "Published", UPDATED: "Updated", ARCHIVED: "Archived", EXPIRED: "Expired" };
/** The label shown for a stored status: "Updated" = published with a later version; "Expired" = published past its expiry. */
export function displayStatus(a: { status: string; version: number; expires_at: Date | string | null }, now = Date.now()): string {
  if (a.status === "PUBLISHED" && a.expires_at && new Date(a.expires_at).getTime() <= now) return "EXPIRED";
  if (a.status === "PUBLISHED" && a.version > 1) return "UPDATED";
  return a.status;
}

/** A date-time typed in the form (India time) to an absolute timestamp. */
export function istToIso(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+05:30`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) < "2000-01-01" ? null : d.toISOString();
}
/** The reverse, for filling the form. */
export function isoToIstInput(v: Date | string | null | undefined): string {
  if (!v) return "";
  const d = new Date(new Date(v).getTime() + 5.5 * 3600_000);
  return d.toISOString().slice(0, 16);
}

/** One recruitment stage per line; blank lines ignored. */
export const parseStages = (v: string) => v.split("\n").map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").trim()).filter(Boolean);
/** One batch per line: "Batch 1 | CC1 and CC2" or "Batch 1 | CC1 and CC2 | bring your ID". */
export function parseBatches(v: string): { ok: { name: string; venue: string; note: string | null }[]; bad: string[] } {
  const ok: { name: string; venue: string; note: string | null }[] = []; const bad: string[] = [];
  for (const line of v.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [name, venue, ...rest] = line.split("|").map((p) => p.trim());
    if (!name || !venue) bad.push(line); else ok.push({ name, venue, note: rest.join(" | ") || null });
  }
  return { ok, bad };
}
export const stagesToText = (s: unknown) => (Array.isArray(s) ? s.map(String).join("\n") : "");
export const batchesToText = (b: unknown) => (Array.isArray(b) ? (b as { name: string; venue: string; note?: string | null }[]).map((x) => [x.name, x.venue, x.note].filter(Boolean).join(" | ")).join("\n") : "");

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const opt = (max: number, msg: string) => z.preprocess(blank, z.string().trim().max(max, msg).optional());
const dateOnly = z.preprocess(blank, z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.").refine((v) => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= "2000-01-01" && v <= "2100-12-31"; }, "Enter a real date.").optional());
const dateTime = z.preprocess(blank, z.string().trim().refine((v) => istToIso(v) !== null, "Enter a date and time.").optional());

export const contentSchema = z.object({
  kind: z.enum(KINDS, "Choose the type of announcement."),
  title: z.string().trim().min(3, "The title must be at least 3 characters.").max(150, "Keep the title under 150 characters."),
  company_name: opt(120, "Keep the company name under 120 characters."),
  drive_id: z.preprocess(blank, z.uuid("Choose a drive from the list.").optional()),
  priority: z.enum(PRIORITIES, "Choose a priority."),
  display_mode: z.enum(DISPLAY_MODES, "Choose what students will see."),
  summary: opt(5000, "Keep the summary under 5000 characters."),
  original_message: opt(20000, "The original message can be at most 20000 characters."),
  event_date: dateOnly, event_time: opt(40, "Keep the time under 40 characters."), venue: opt(200, "Keep the venue under 200 characters."),
  instructions: opt(3000, "Keep the instructions under 3000 characters."), consent_deadline: dateTime, expires_at: dateTime,
  action_link: z.preprocess(blank, httpUrl.max(500).optional()),
  stages: z.string().max(3000).default(""), batches: z.string().max(5000).default(""),
});
export type ContentInput = z.infer<typeof contentSchema>;

/** The JSON the database function takes: every key is sent, so a cleared field really clears. Fields that do not apply to the type are cleared too. */
export function toDbFields(c: ContentInput): { fields: Record<string, unknown>; error?: string } {
  const applies = new Set<string>(FIELDS_FOR[c.kind]);
  const batches = parseBatches(applies.has("batches") ? c.batches : "");
  if (batches.bad.length) return { fields: {}, error: `Each batch needs a name and its own venue, separated by "|". Check: ${batches.bad[0]}` };
  return {
    fields: {
      kind: c.kind, title: c.title, company_name: c.company_name ?? null, drive_id: c.drive_id ?? null, priority: c.priority, display_mode: c.display_mode,
      summary: c.summary ?? null, original_message: c.original_message ?? null,
      event_date: applies.has("event_date") ? c.event_date ?? null : null, event_time: applies.has("event_time") ? c.event_time ?? null : null, venue: applies.has("venue") ? c.venue ?? null : null,
      instructions: applies.has("instructions") ? c.instructions ?? null : null, action_link: applies.has("action_link") ? c.action_link ?? null : null,
      consent_deadline: applies.has("consent_deadline") && c.consent_deadline ? istToIso(c.consent_deadline) : null, expires_at: c.expires_at ? istToIso(c.expires_at) : null,
      stages: applies.has("stages") ? parseStages(c.stages) : [], batches: batches.ok,
    },
  };
}

export type AudienceInput = { source: Source; departments: string[]; years: number[]; career?: string; drive?: string; students?: string[]; named_confirmed?: boolean };
export function parseYears(v: string): number[] | null {
  const parts = v.split(/[,\s]+/).filter(Boolean);
  const ys = parts.map(Number);
  return ys.every((y) => Number.isInteger(y) && y >= 2000 && y <= 2100) ? [...new Set(ys)] : null;
}
export const parseRegisterNumbers = (v: string) => [...new Set(v.split(/[\s,;]+/).map((x) => canonicalIdentifier(x)).filter((x): x is string => x !== null))].slice(0, 500);

/** Warnings shown while editing. They never change a value. */
export function warnings(c: { event_date?: string | null; consent_deadline?: Date | string | null; expires_at?: Date | string | null }, now = Date.now()): string[] {
  const w: string[] = [];
  const today = new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);
  if (c.event_date && c.event_date < today) w.push("The event date is in the past.");
  if (c.consent_deadline && new Date(c.consent_deadline).getTime() <= now) w.push("The consent deadline has passed.");
  if (c.expires_at && new Date(c.expires_at).getTime() <= now) w.push("The expiry time has passed.");
  if (c.event_date) {
    const wd = new Date(`${c.event_date}T00:00:00Z`).getUTCDay();
    if (wd === 0) w.push("The event date is a Sunday. Check it.");
  }
  return w;
}
