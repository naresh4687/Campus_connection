import { toCsv } from "./csv";

/** One student of a drive's departments, as the database reports it (eligibility is the engine's result, never computed here). */
export type PartRow = {
  student_id: string; full_name: string; register_number: string; department_id: string; department_code: string; contact_email: string | null; phone: string | null; has_account: boolean;
  eligibility: string; registration_status: string | null; evidence_status: string | null;
};
export type Bucket = "REGISTERED" | "PENDING" | "NOT_REGISTERED";
export const bucketOf = (r: Pick<PartRow, "registration_status">): Bucket => (r.registration_status === "REGISTERED" ? "REGISTERED" : r.registration_status === "PENDING_EXTERNAL" ? "PENDING" : "NOT_REGISTERED");

export const VIEWS = ["not-registered", "registered", "pending", "all"] as const;
export type View = (typeof VIEWS)[number];
export const VIEW_LABEL: Record<View, string> = { "not-registered": "Not registered", registered: "Registered", pending: "Started, screenshot not uploaded", all: "Everyone" };
export const WHO = ["eligible", "needs-data", "not-eligible", "any"] as const;
export type Who = (typeof WHO)[number];
export const WHO_LABEL: Record<Who, string> = { eligible: "Eligible", "needs-data": "Needs verified data", "not-eligible": "Not eligible", any: "Any eligibility" };
const ELIG: Record<Exclude<Who, "any">, string> = { eligible: "ELIGIBLE", "needs-data": "NEEDS_DATA", "not-eligible": "NOT_ELIGIBLE" };
export const ELIGIBILITY_TEXT: Record<string, string> = { ELIGIBLE: "Eligible", NEEDS_DATA: "Needs verified data", NOT_ELIGIBLE: "Not eligible" };

export const parseView = (v: string | undefined): View => ((VIEWS as readonly string[]).includes(v ?? "") ? (v as View) : "not-registered");
export const parseWho = (v: string | undefined, view: View): Who => ((WHO as readonly string[]).includes(v ?? "") ? (v as Who) : view === "not-registered" || view === "pending" ? "eligible" : "any");

export function filterRows(rows: PartRow[], view: View, who: Who): PartRow[] {
  return rows.filter((r) => {
    const b = bucketOf(r);
    if (view === "registered" && b !== "REGISTERED") return false;
    if (view === "not-registered" && b !== "NOT_REGISTERED") return false;
    if (view === "pending" && b !== "PENDING") return false;
    return who === "any" || r.eligibility === ELIG[who];
  });
}

export type Counts = { students: number; eligible: number; registered: number; pending: number; notRegistered: number; needsData: number; notEligible: number };
/** Who is left to chase: eligible students with no completed registration. */
export function countRows(rows: PartRow[]): Counts & { toChase: number } {
  const c = { students: rows.length, eligible: 0, registered: 0, pending: 0, notRegistered: 0, needsData: 0, notEligible: 0, toChase: 0 };
  for (const r of rows) {
    const b = bucketOf(r);
    if (r.eligibility === "ELIGIBLE") c.eligible++; else if (r.eligibility === "NEEDS_DATA") c.needsData++; else c.notEligible++;
    if (b === "REGISTERED") c.registered++; else if (b === "PENDING") c.pending++; else c.notRegistered++;
    if (r.eligibility === "ELIGIBLE" && b !== "REGISTERED") c.toChase++;
  }
  return c;
}

export const registrationText = (r: Pick<PartRow, "registration_status" | "evidence_status">) =>
  r.registration_status === "REGISTERED" ? (r.evidence_status === "REJECTED" || r.evidence_status === "RESUBMISSION_REQUIRED" ? "Registered (new screenshot needed)" : "Registered")
  : r.registration_status === "PENDING_EXTERNAL" ? "Started, screenshot not uploaded" : r.registration_status === "WITHDRAWN" ? "Withdrawn" : "Not registered";

/** Spreadsheet-safe (csvCell neutralises formulas). Names and numbers come from student records; nothing is added or guessed. */
export function participationCsv(rows: PartRow[]): string {
  return toCsv([["Register number", "Name", "Department", "Personal email", "Phone", "Has account", "Eligibility", "Registration"],
    ...rows.map((r) => [r.register_number, r.full_name, r.department_code, r.contact_email ?? "", r.phone ?? "", r.has_account ? "Yes" : "No", ELIGIBILITY_TEXT[r.eligibility] ?? r.eligibility, registrationText(r)])]);
}
