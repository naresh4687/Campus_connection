import { z } from "zod";
import { DEGREES } from "./students";

export const EMPLOYMENT_TYPES = [
  { value: "FULL_TIME", label: "Full-time" }, { value: "INTERNSHIP", label: "Internship" },
  { value: "INTERNSHIP_PPO", label: "Internship with PPO" }, { value: "CONTRACT", label: "Contract" },
] as const;
export const employmentLabel = (v: string) => EMPLOYMENT_TYPES.find((t) => t.value === v)?.label ?? v;
export const DRIVE_STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", PUBLISHED: "Published", CLOSED: "Closed", ARCHIVED: "Archived" };

/** Years offered as eligible passing years: last year .. four years ahead. */
export const yearOptions = (now = new Date()) => Array.from({ length: 6 }, (_, i) => now.getFullYear() - 1 + i);

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const num = (label: string, min: number, max: number, dec = 2) =>
  z.preprocess(blank, z.string().trim().regex(new RegExp(`^\\d{1,6}(\\.\\d{1,${dec}})?$`), `${label}: enter a number${dec ? ` with at most ${dec} decimals` : ""}.`).transform(Number).refine((n) => n >= min && n <= max, `${label} must be between ${min} and ${max}.`).optional());
const int = (label: string, min: number, max: number) =>
  z.preprocess(blank, z.string().trim().regex(/^\d{1,6}$/, `${label}: enter a whole number.`).transform(Number).refine((n) => n >= min && n <= max, `${label} must be between ${min} and ${max}.`).optional());
const text = (max: number) => z.preprocess(blank, z.string().trim().max(max, `Keep this under ${max} characters.`).optional());

/** "2026-12-01T17:00" typed in the browser is interpreted as Indian Standard Time. */
export function istToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const d = new Date(`${local}:00+05:30`);
  if (Number.isNaN(d.getTime())) return null;
  // Reject impossible calendar dates (e.g. 30 February) that JavaScript would silently roll over into the next month.
  return isoToIstInput(d) === local ? d.toISOString() : null;
}
export function isoToIstInput(iso: Date | string | null): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

export const driveFormSchema = z.object({
  companyId: z.uuid("Choose a company."),
  title: z.string().trim().min(2, "Enter the job title.").max(150),
  description: text(4000), location: z.preprocess(blank, z.string().trim().min(2, "At least 2 characters.").max(150).optional()),
  type: z.enum(EMPLOYMENT_TYPES.map((t) => t.value) as [string, ...string[]], "Choose an employment type."),
  ctc: num("CTC", 0, 1000), ctcNote: text(200), bond: text(1000), qualification: text(300),
  openings: int("Openings", 1, 10000),
  deadline: z.preprocess(blank, z.string().refine((v) => istToIso(v) !== null, "Enter a valid date and time.").optional()),
  interview: text(2000), instructions: text(3000),
  minCgpa: num("Minimum CGPA", 0, 10), minTenth: num("Minimum 10th %", 0, 100), minTwelfth: num("Minimum 12th %", 0, 100), minDiploma: num("Minimum diploma %", 0, 100),
  maxBacklogs: int("Maximum active backlogs", 0, 50), maxArrears: int("Maximum historical arrears", 0, 200),
  departments: z.array(z.uuid()).max(100), years: z.array(z.coerce.number().int().min(1990).max(2110)).max(10), degrees: z.array(z.enum(DEGREES)).max(10),
});
export type DriveInput = z.infer<typeof driveFormSchema>;

/** Human-readable criteria lines, used wherever a drive is shown. Unset criteria are simply not listed — they never mean zero. */
export function criteriaLines(c: { min_cgpa: string | null; min_tenth: string | null; min_twelfth: string | null; min_diploma: string | null; max_active_backlogs: number | null; max_historical_arrears: number | null; passing_years: number[]; degrees: string[] }) {
  const out: string[] = [];
  if (c.min_cgpa !== null) out.push(`CGPA of at least ${Number(c.min_cgpa).toFixed(2)}`);
  if (c.min_tenth !== null) out.push(`10th percentage of at least ${Number(c.min_tenth).toFixed(2)}%`);
  if (c.min_twelfth !== null) out.push(`12th percentage of at least ${Number(c.min_twelfth).toFixed(2)}%`);
  if (c.min_diploma !== null) out.push(`Diploma percentage of at least ${Number(c.min_diploma).toFixed(2)}%`);
  if (c.max_active_backlogs !== null) out.push(`At most ${c.max_active_backlogs} active backlog${c.max_active_backlogs === 1 ? "" : "s"}`);
  if (c.max_historical_arrears !== null) out.push(`At most ${c.max_historical_arrears} historical arrear${c.max_historical_arrears === 1 ? "" : "s"}`);
  if (c.passing_years.length) out.push(`Passing year: ${c.passing_years.join(", ")}`);
  if (c.degrees.length) out.push(`Degree: ${c.degrees.join(", ")}`);
  return out;
}
