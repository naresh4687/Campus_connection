import { z } from "zod";
import { EMPLOYMENT_TYPES, istToIso } from "./drives";

/**
 * Announcement extraction — the deterministic half. The model's output is UNTRUSTED input: every value must come with a verbatim quote
 * from the announcement, and both the quote and the value are checked here. Nothing in this file (or the model) can publish a drive,
 * decide eligibility, or write to the database; the result only pre-fills the ordinary draft form that an officer reviews and saves.
 */
export const MAX_ANNOUNCEMENT_CHARS = 8000;

const field = <T extends z.ZodType>(v: T) => z.object({ value: v, quote: z.string().max(500) }).nullable().default(null);
const issueKinds = ["MISSING", "CONTRADICTORY", "UNCERTAIN"] as const;
export const extractionSchema = z.object({
  company: field(z.string().max(200)), title: field(z.string().max(150)), location: field(z.string().max(150)),
  employmentType: field(z.string().max(40)), ctcLpa: field(z.number()), openings: field(z.number()), deadline: field(z.string().max(20)),
  minCgpa: field(z.number()), minTenth: field(z.number()), minTwelfth: field(z.number()), minDiploma: field(z.number()), maxBacklogs: field(z.number()),
  passingYears: field(z.array(z.number()).max(10)), departments: field(z.array(z.string().max(100)).max(30)), description: field(z.string().max(2000)),
  issues: z.array(z.object({ field: z.string().max(40), kind: z.enum(issueKinds), note: z.string().max(300) })).max(20).default([]),
});
export type Extraction = z.infer<typeof extractionSchema>;
export type FieldKey = Exclude<keyof Extraction, "issues">;

export const FIELD_LABEL: Record<FieldKey, string> = {
  company: "Company", title: "Job title", location: "Location", employmentType: "Employment type", ctcLpa: "CTC (LPA)", openings: "Openings", deadline: "Application deadline",
  minCgpa: "Minimum CGPA", minTenth: "Minimum 10th %", minTwelfth: "Minimum 12th %", minDiploma: "Minimum diploma %", maxBacklogs: "Maximum active backlogs",
  passingYears: "Passing years", departments: "Departments", description: "Description",
};

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s ]+/g, " ").trim();
const numText = (n: number) => { const t = String(n); return [t, n.toFixed(1), n.toFixed(2)]; };

const TYPE_WORDS: Record<string, RegExp> = {
  FULL_TIME: /full[\s-]?time|permanent|regular employee/, INTERNSHIP: /intern/, INTERNSHIP_PPO: /\bppo\b|pre[\s-]?placement/, CONTRACT: /contract/,
};

/** Is `quote` really in the announcement, and does `value` really appear inside the quote? Enum-like and "none" values use explicit, narrow matchers. */
function supported(key: FieldKey, announcement: string, quote: string, value: unknown): boolean {
  const a = norm(announcement); const q = norm(quote);
  if (q.length < 2 || !a.includes(q)) return false;
  if (key === "employmentType") return typeof value === "string" && !!TYPE_WORDS[value]?.test(q);
  if (key === "maxBacklogs" && value === 0) return /\b(no|zero|nil|without)\b[^.]{0,30}backlog|backlog[^.]{0,20}\b(not allowed|nil|zero|0)\b|\b0\b[^.]{0,20}backlog/.test(q);
  if (key === "deadline" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return true;   // normalised by the model; only the quote's existence is checked (the value is then range-checked)
  const present = (x: unknown): boolean => (typeof x === "number" ? numText(x).some((t) => new RegExp(`(^|[^0-9.])${t.replace(".", "\\.")}([^0-9]|\\.(?![0-9])|$)`).test(q)) : typeof x === "string" ? q.includes(norm(x)) : false);
  if (Array.isArray(value)) return value.length > 0 && value.every(present);
  return present(value);
}

export type FieldStatus = "VERIFIED" | "UNSUPPORTED" | "INVALID";
export type Checked = { key: FieldKey; label: string; status: FieldStatus; quote: string | null; shown: string; note?: string };
export type Verified = { fields: Checked[]; issues: { field: string; kind: "MISSING" | "CONTRADICTORY" | "UNCERTAIN" | "UNSUPPORTED" | "INVALID"; note: string }[]; accepted: Partial<Record<FieldKey, unknown>> };

const rules: Partial<Record<FieldKey, (v: unknown) => string | null>> = {
  ctcLpa: (v) => (typeof v === "number" && v > 0 && v <= 1000 ? null : "must be between 0 and 1000 LPA"),
  openings: (v) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 100000 ? null : "must be a whole number of at least 1"),
  minCgpa: (v) => (typeof v === "number" && v >= 0 && v <= 10 ? null : "must be between 0 and 10"),
  minTenth: (v) => (typeof v === "number" && v >= 0 && v <= 100 ? null : "must be between 0 and 100"),
  minTwelfth: (v) => (typeof v === "number" && v >= 0 && v <= 100 ? null : "must be between 0 and 100"),
  minDiploma: (v) => (typeof v === "number" && v >= 0 && v <= 100 ? null : "must be between 0 and 100"),
  maxBacklogs: (v) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 20 ? null : "must be a whole number from 0 to 20"),
  passingYears: (v) => (Array.isArray(v) && v.every((y) => Number.isInteger(y) && y >= 2000 && y <= 2100) ? null : "years must be between 2000 and 2100"),
  employmentType: (v) => (EMPLOYMENT_TYPES.some((t) => t.value === v) ? null : "not a known employment type"),
  deadline: (v) => (typeof v === "string" && istToIso(v) ? (new Date(istToIso(v)!) > new Date() ? null : "is in the past") : "is not a valid date and time"),
};

const REQUIRED: FieldKey[] = ["company", "title", "employmentType", "departments", "passingYears", "openings", "deadline"];

export function verifyExtraction(announcement: string, x: Extraction): Verified {
  const fields: Checked[] = []; const issues: Verified["issues"] = []; const accepted: Verified["accepted"] = {};
  for (const key of Object.keys(FIELD_LABEL) as FieldKey[]) {
    const f = x[key] as { value: unknown; quote: string } | null;
    if (!f) continue;
    const shown = Array.isArray(f.value) ? f.value.join(", ") : String(f.value);
    if (!supported(key, announcement, f.quote, f.value)) {
      fields.push({ key, label: FIELD_LABEL[key], status: "UNSUPPORTED", quote: f.quote, shown, note: "The quoted text is not in the announcement, or the value is not in the quote. It was ignored." });
      issues.push({ field: key, kind: "UNSUPPORTED", note: `${FIELD_LABEL[key]}: not supported by the announcement text — ignored.` });
      continue;
    }
    const bad = rules[key]?.(f.value) ?? null;
    if (bad) {
      fields.push({ key, label: FIELD_LABEL[key], status: "INVALID", quote: f.quote, shown, note: `Ignored: ${bad}.` });
      issues.push({ field: key, kind: "INVALID", note: `${FIELD_LABEL[key]} ${bad} — ignored.` });
      continue;
    }
    fields.push({ key, label: FIELD_LABEL[key], status: "VERIFIED", quote: f.quote, shown });
    accepted[key] = f.value;
  }
  for (const k of REQUIRED) if (!(k in accepted)) issues.push({ field: k, kind: "MISSING", note: `${FIELD_LABEL[k]} was not found in the announcement. Fill it in yourself.` });
  for (const i of x.issues) issues.push({ field: i.field, kind: i.kind, note: i.note });
  return { fields, issues, accepted };
}

/** The accepted values as the string values of the ordinary drive form. Company and departments are matched to what exists in the college. */
export function toFormValues(accepted: Verified["accepted"], ctx: { companies: { id: string; name: string }[]; departments: { id: string; code: string; name: string }[] }) {
  const values: Record<string, string> = {}; const notes: string[] = [];
  const s = (k: string, v: unknown) => { if (v !== undefined && v !== null) values[k] = String(v); };
  if (typeof accepted.company === "string") {
    // An existing company keeps its saved spelling; a new name is simply typed in and the company is created when the drive is saved.
    const hit = ctx.companies.find((c) => norm(c.name) === norm(accepted.company as string));
    values.companyName = hit ? hit.name : (accepted.company as string);
  }
  s("title", accepted.title); s("location", accepted.location); s("type", accepted.employmentType); s("ctc", accepted.ctcLpa); s("openings", accepted.openings); s("deadline", accepted.deadline);
  s("minCgpa", accepted.minCgpa); s("minTenth", accepted.minTenth); s("minTwelfth", accepted.minTwelfth); s("minDiploma", accepted.minDiploma); s("maxBacklogs", accepted.maxBacklogs);
  s("description", accepted.description);
  if (Array.isArray(accepted.passingYears)) values.years = (accepted.passingYears as number[]).join(",");
  if (Array.isArray(accepted.departments)) {
    const ids: string[] = []; const unknown: string[] = [];
    for (const name of accepted.departments as string[]) {
      const d = ctx.departments.find((x) => norm(x.code) === norm(name) || norm(x.name) === norm(name));
      if (d) ids.push(d.id); else unknown.push(name);
    }
    if (ids.length) values.departments = ids.join(",");
    if (unknown.length) notes.push(`Not matched to a department of your college: ${unknown.join(", ")}. Choose departments yourself.`);
  }
  return { values, notes };
}

/** Parses the model's reply (plain JSON, or JSON inside a code fence). Throws a short error that is safe to show. */
export function parseModelJson(text: string): Extraction {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { throw new Error("The assistant did not return a usable answer."); }
  const r = extractionSchema.safeParse(raw);
  if (!r.success) throw new Error("The assistant’s answer was not in the expected format.");
  return r.data;
}
