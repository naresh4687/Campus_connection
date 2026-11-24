import { z } from "zod";

export const ACADEMIC_STATUSES = ["NOT_SUBMITTED", "PENDING", "VERIFIED", "REJECTED"] as const;

/** Display labels for a student's overall academic status. */
export const ACADEMIC_LABEL: Record<string, string> = { NOT_SUBMITTED: "Not submitted", PENDING: "Awaiting review", VERIFIED: "Verified", REJECTED: "Needs correction" };

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** A number with at most two decimals in [min, max]. Text is validated before conversion so "8.255" and "1e1" are refused, not rounded. */
const decimal = (label: string, min: number, max: number) =>
  z.string().trim().regex(/^\d{1,3}(\.\d{1,2})?$/, `${label}: enter a number with at most two decimal places.`).transform(Number).refine((n) => n >= min && n <= max, `${label} must be between ${min} and ${max}.`);
const whole = (label: string, max: number) =>
  z.string().trim().regex(/^\d{1,3}$/, `${label}: enter a whole number.`).transform(Number).refine((n) => n <= max, `${label} must be at most ${max}.`);

/**
 * Optional fields are `undefined` when left blank — NEVER zero. Required counts (backlogs, arrears) must be typed explicitly,
 * so "0" is a statement the student makes, not a default.
 */
export const academicFormSchema = z
  .object({
    cgpa: decimal("CGPA", 0, 10),
    tenth: decimal("10th percentage", 0, 100),
    twelfth: z.preprocess(blank, decimal("12th percentage", 0, 100).optional()),
    diploma: z.preprocess(blank, decimal("Diploma percentage", 0, 100).optional()),
    backlogs: whole("Active backlogs", 50),
    arrears: whole("Historical arrears", 200),
    note: z.preprocess(blank, z.string().trim().max(500, "Keep the note under 500 characters.").optional()),
  })
  .refine((v) => v.twelfth !== undefined || v.diploma !== undefined, { message: "Provide your 12th percentage or your diploma percentage.", path: ["twelfth"] });
export type AcademicInput = z.infer<typeof academicFormSchema>;

export type SemesterRow = { semester: number; sgpa: string; backlogs: number };

export type SubmissionValues = { semesters?: SemesterRow[]; cgpa: string; tenth_percentage: string; twelfth_percentage: string | null; diploma_percentage: string | null; active_backlogs: number; historical_arrears: number };

export const fmtPct = (v: string | number | null | undefined) => (v === null || v === undefined ? "Not provided" : `${Number(v).toFixed(2)}%`);
export const fmtCgpa = (v: string | number) => Number(v).toFixed(2);

export const SUBMISSION_LABEL: Record<string, string> = { SUBMITTED: "Awaiting review", VERIFIED: "Verified", REJECTED: "Rejected", SUPERSEDED: "Superseded", WITHDRAWN: "Withdrawn" };

/** The college offers 8-semester programmes; the form and the parser accept semesters 1 to 8. (The database still allows up to 12, so nothing already saved is lost.) */
export const MAX_SEMESTERS = 8;
/** SGPA average vs stated CGPA: beyond this gap the reviewer and student see a (non-blocking) note. The CGPA is never computed from semesters. */
export const CGPA_GAP_WARNING = 0.5;

/**
 * Optional semester results from form fields `sem<n>_sgpa` / `sem<n>_backlogs` (n = 1..8). A semester counts only when its SGPA is typed;
 * typing backlogs without an SGPA is an error. Text is validated before conversion, like the rest of the form (no rounding, no 0 by default).
 */
export function parseSemesters(get: (key: string) => string): { rows: { semester: number; sgpa: number; backlogs: number }[]; errors: Record<string, string> } {
  const rows: { semester: number; sgpa: number; backlogs: number }[] = [];
  const errors: Record<string, string> = {};
  for (let n = 1; n <= MAX_SEMESTERS; n++) {
    const g = get(`sem${n}_sgpa`).trim(); const b = get(`sem${n}_backlogs`).trim();
    if (g === "" && b === "") continue;
    if (g === "") { errors[`sem${n}_sgpa`] = `Semester ${n}: enter the SGPA, or clear the backlogs.`; continue; }
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(g) || Number(g) > 10) { errors[`sem${n}_sgpa`] = `Semester ${n}: SGPA must be 0-10 with at most two decimals.`; continue; }
    if (b !== "" && (!/^\d{1,2}$/.test(b) || Number(b) > 20)) { errors[`sem${n}_backlogs`] = `Semester ${n}: backlogs must be a whole number 0-20.`; continue; }
    rows.push({ semester: n, sgpa: Number(g), backlogs: b === "" ? 0 : Number(b) });
  }
  return { rows, errors };
}

/** Average SGPA when at least one semester is given, else null. */
export const averageSgpa = (rows: { sgpa: string | number }[]) => (rows.length ? rows.reduce((a, r) => a + Number(r.sgpa), 0) / rows.length : null);

/** A note when the stated CGPA is far from the semesters' average; null when consistent or no semesters. */
export function cgpaGapNote(cgpa: string | number, rows: { sgpa: string | number }[]): string | null {
  const avg = averageSgpa(rows);
  if (avg === null || Math.abs(avg - Number(cgpa)) <= CGPA_GAP_WARNING) return null;
  return `The stated CGPA (${Number(cgpa).toFixed(2)}) differs from the average of the semester SGPAs (${avg.toFixed(2)}). Check both before continuing.`;
}

export type DiffableSubmission = SubmissionValues & { semesters?: SemesterRow[] };
const semText = (rows: SemesterRow[] | undefined) => (rows && rows.length ? rows.map((r) => `S${r.semester}: ${Number(r.sgpa).toFixed(2)}${r.backlogs ? ` (${r.backlogs} backlog${r.backlogs === 1 ? "" : "s"})` : ""}`).join(", ") : "None");

/** What a pending update changes compared with the verified record: label, old text, new text. Empty when nothing differs. */
export function academicChanges(before: DiffableSubmission, after: DiffableSubmission): { label: string; before: string; after: string }[] {
  const rows: [string, string, string][] = [
    ["CGPA", fmtCgpa(before.cgpa), fmtCgpa(after.cgpa)],
    ["10th percentage", fmtPct(before.tenth_percentage), fmtPct(after.tenth_percentage)],
    ["12th percentage", fmtPct(before.twelfth_percentage), fmtPct(after.twelfth_percentage)],
    ["Diploma percentage", fmtPct(before.diploma_percentage), fmtPct(after.diploma_percentage)],
    ["Active backlogs", String(before.active_backlogs), String(after.active_backlogs)],
    ["Historical arrears", String(before.historical_arrears), String(after.historical_arrears)],
    ["Semester results", semText(before.semesters), semText(after.semesters)],
  ];
  return rows.filter(([, b, a]) => b !== a).map(([label, b, a]) => ({ label, before: b, after: a }));
}
