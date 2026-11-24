import { normalizeStudentRegistrationNumber } from "./normalize";
import { z } from "zod";
import { emailField, phoneField } from "./validation";

import { DEGREES, type Degree } from "./degrees";
export { DEGREES, type Degree };

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Keys are the squashed (lower-case, letters/digits only) spelling.
const DEGREE_ALIASES: Record<string, Degree> = {
  be: "B.E.", bachelorofengineering: "B.E.", bachelorsofengineering: "B.E.",
  btech: "B.Tech", bachelorsoftechnology: "B.Tech", bachelortechnology: "B.Tech", bachelorsoftech: "B.Tech",
  me: "M.E.", masterofengineering: "M.E.",
  mtech: "M.Tech", masteroftechnology: "M.Tech",
  mca: "MCA", masterofcomputerapplications: "MCA", mastersofcomputerapplications: "MCA",
  mba: "MBA", masterofbusinessadministration: "MBA",
  bsc: "B.Sc", bachelorofscience: "B.Sc",
  msc: "M.Sc", masterofscience: "M.Sc",
  diploma: "Diploma", other: "Other",
};
for (const d of DEGREES) DEGREE_ALIASES[squash(d)] = d;

/** Maps free-text degree names (BE, b.e, Bachelor of Engineering …) to the controlled list; null if unrecognised. */
export const normalizeDegree = (raw: string): Degree | null => DEGREE_ALIASES[squash(raw)] ?? null;

// ───────────── fields and header auto-mapping ─────────────
export const STUDENT_FIELDS = [
  { key: "register_number", label: "Register number", required: true, aliases: ["register number", "reg no", "regno", "register no", "roll number", "roll no", "registration number", "enrollment number", "enrolment number"] },
  { key: "full_name", label: "Full name", required: true, aliases: ["full name", "name", "student name", "name of the student"] },
  { key: "college_email", label: "College email", required: true, aliases: ["college email", "email", "official email", "institute email", "college mail", "email id", "college email id"] },
  { key: "personal_email", label: "Personal email", required: false, aliases: ["personal email", "alternate email", "alt email", "personal mail", "gmail"] },
  { key: "phone", label: "Phone", required: false, aliases: ["phone", "mobile", "phone number", "mobile number", "contact number", "contact no", "mobile no"] },
  { key: "department", label: "Department (code or name)", required: true, aliases: ["department", "dept", "branch", "department code", "dept code", "department name"] },
  { key: "degree", label: "Degree / course", required: true, aliases: ["degree", "course", "programme", "program"] },
  { key: "specialization", label: "Specialization", required: false, aliases: ["specialization", "specialisation", "stream", "major"] },
  { key: "admission_year", label: "Admission year", required: true, aliases: ["admission year", "year of admission", "joining year", "year of joining", "batch start", "admitted year"] },
  { key: "passing_year", label: "Passing year", required: true, aliases: ["passing year", "year of passing", "graduation year", "year of graduation", "batch end", "pass out year", "passout year", "expected passing year"] },
] as const;
export type FieldKey = (typeof STUDENT_FIELDS)[number]["key"];
export type Mapping = Record<FieldKey, number | null>;

export const emptyMapping = (): Mapping => Object.fromEntries(STUDENT_FIELDS.map((f) => [f.key, null])) as Mapping;

/** Suggests a column for each field from the header names. Each column is used at most once. */
export function autoMap(headers: string[]): Mapping {
  const m = emptyMapping();
  const used = new Set<number>();
  const norm = headers.map(squash);
  for (const f of STUDENT_FIELDS) {
    const idx = norm.findIndex((h, i) => !used.has(i) && f.aliases.some((a) => squash(a) === h));
    if (idx >= 0) { m[f.key] = idx; used.add(idx); }
  }
  return m;
}

/** Returns an error message if the mapping cannot work (missing required field, column used twice, out of range). */
export function mappingProblem(m: Mapping, columnCount: number): string | null {
  const used = new Map<number, string>();
  for (const f of STUDENT_FIELDS) {
    const v = m[f.key];
    if (v === null) { if (f.required) return `Choose a column for “${f.label}”.`; continue; }
    if (!Number.isInteger(v) || v < 0 || v >= columnCount) return `The column chosen for “${f.label}” does not exist.`;
    const prev = used.get(v);
    if (prev) return `The same column is used for “${prev}” and “${f.label}”.`;
    used.set(v, f.label);
  }
  return null;
}

// ───────────── row validation ─────────────
export type DeptLookup = Map<string, { id: string; active: boolean }>;
export type ImportContext = { depts: DeptLookup; existingRegisters: Set<string>; existingEmails: Set<string> };
/** `n` is the 1-based index among DATA rows; spreadsheet row = n + 1 (the header is row 1). */
export type RowResult = { n: number; status: "VALID" | "ERROR" | "DUPLICATE"; errors: string[]; normalized: Record<string, string | number | null> | null };

const CONTROL = /[\u0000-\u001F\u007F]/;
const REGISTER = /^[A-Za-z0-9][A-Za-z0-9/._-]{2,29}$/;
/** What a typed or imported register number is stored as (the database applies the same rule): "23ai000" -> "23AI000". Unusable text is kept as typed so the validator can name the problem. */
const canonRegister = (v: string) => normalizeStudentRegistrationNumber(v) ?? v.normalize("NFKC").trim().toUpperCase();

export const deptKey = (s: string) => s.trim().toLowerCase();
export function buildDeptLookup(depts: { id: string; code: string; name: string; status: string }[]): DeptLookup {
  const m: DeptLookup = new Map();
  for (const d of depts) { const v = { id: d.id, active: d.status === "ACTIVE" }; m.set(deptKey(d.code), v); m.set(deptKey(d.name), v); }
  return m;
}

export function validateRows(rows: string[][], mapping: Mapping, ctx: ImportContext): RowResult[] {
  const seenRegister = new Map<string, number>();
  const existing = new Set([...ctx.existingRegisters].map((r) => r.toUpperCase()));
  const seenEmail = new Map<string, number>();
  return rows.map((cells, i): RowResult => {
    const n = i + 1;
    const get = (k: FieldKey) => { const c = mapping[k]; return c === null ? "" : (cells[c] ?? "").trim(); };
    const errors: string[] = [];
    if (cells.every((c) => c.trim() === "")) return { n, status: "ERROR", errors: ["The row is empty."], normalized: null };

    const register = canonRegister(get("register_number"));
    if (!REGISTER.test(register)) errors.push("Register number must be 3–30 letters, digits or / . _ -");
    const name = get("full_name");
    if (name.length < 2 || name.length > 120 || CONTROL.test(name)) errors.push("Full name must be 2–120 characters.");
    const email = emailField.safeParse(get("college_email"));
    if (!email.success) errors.push("College email is not a valid email address.");
    const personalRaw = get("personal_email");
    const personal = personalRaw ? emailField.safeParse(personalRaw) : null;
    if (personal && !personal.success) errors.push("Personal email is not a valid email address.");
    const phoneRaw = get("phone");
    if (phoneRaw && !phoneField.safeParse(phoneRaw).success) errors.push("Phone number is not valid.");
    const deptRaw = get("department");
    const dept = ctx.depts.get(deptKey(deptRaw));
    if (!deptRaw) errors.push("Department is missing.");
    else if (!dept) errors.push(`Department “${deptRaw.slice(0, 40)}” does not exist. Use a department code or name from your college.`);
    else if (!dept.active) errors.push(`Department “${deptRaw.slice(0, 40)}” is inactive.`);
    const degree = normalizeDegree(get("degree"));
    if (!degree) errors.push(`Degree “${get("degree").slice(0, 30)}” is not recognised (${DEGREES.join(", ")}).`);
    const spec = get("specialization");
    if (spec.length > 100 || CONTROL.test(spec)) errors.push("Specialization must be at most 100 characters.");
    const adm = /^\d{4}$/.test(get("admission_year")) ? Number(get("admission_year")) : NaN;
    const pas = /^\d{4}$/.test(get("passing_year")) ? Number(get("passing_year")) : NaN;
    if (!(adm >= 1990 && adm <= 2100)) errors.push("Admission year must be a 4-digit year.");
    if (!(pas >= 1990 && pas <= 2110)) errors.push("Passing year must be a 4-digit year.");
    else if (adm >= 1990 && !(pas > adm && pas <= adm + 8)) errors.push("Passing year must be after the admission year (within 8 years).");

    if (errors.length) return { n, status: "ERROR", errors, normalized: null };

    const emailV = (email as { data: string }).data;
    const regKey = register;
    const dupFile = seenRegister.get(regKey) ?? seenEmail.get(emailV);
    seenRegister.set(regKey, seenRegister.get(regKey) ?? n);
    seenEmail.set(emailV, seenEmail.get(emailV) ?? n);
    if (dupFile !== undefined) return { n, status: "DUPLICATE", errors: [`Duplicate of row ${dupFile + 1} in this file.`], normalized: null };
    const exists = [existing.has(regKey) ? "register number" : "", ctx.existingEmails.has(emailV) ? "college email" : ""].filter(Boolean);
    if (exists.length) return { n, status: "DUPLICATE", errors: [`A student with this ${exists.join(" and ")} already exists. Existing records are never changed by an import.`], normalized: null };

    return {
      n, status: "VALID", errors: [],
      normalized: {
        register_number: register, full_name: name, college_email: emailV, personal_email: personal && personal.success ? personal.data : null,
        phone: phoneRaw || null, degree: degree as Degree, specialization: spec || null, admission_year: adm, passing_year: pas, department_id: (dept as { id: string }).id,
      },
    };
  });
}

// ───────────── single-student form ─────────────
export const studentFormSchema = z.object({
  departmentId: z.uuid("Choose a department."),
  registerNumber: z.string().transform(canonRegister).pipe(z.string().regex(REGISTER, "3–30 letters, digits or / . _ -")),
  fullName: z.string().trim().min(2, "Enter the student's name.").max(120).refine((v) => !CONTROL.test(v), "Remove control characters."),
  collegeEmail: emailField,
  personalEmail: z.string().trim().max(254).optional().transform((v) => v || undefined).pipe(emailField.optional()),
  phone: z.string().trim().optional().transform((v) => v || undefined).pipe(phoneField.optional()),
  degree: z.enum(DEGREES, "Choose a degree."),
  specialization: z.string().trim().max(100).optional(),
  admissionYear: z.coerce.number("Enter the admission year.").int().min(1990).max(2100),
  passingYear: z.coerce.number("Enter the passing year.").int().min(1990).max(2110),
}).refine((v) => v.passingYear > v.admissionYear && v.passingYear <= v.admissionYear + 8, { message: "Passing year must be after the admission year (within 8 years).", path: ["passingYear"] });

export const ownContactSchema = z.object({
  phone: z.string().trim().optional().transform((v) => v || undefined).pipe(phoneField.optional()),
  personalEmail: z.string().trim().max(254).optional().transform((v) => v || undefined).pipe(emailField.optional()),
});

const profileUrl = (hosts: RegExp, what: string, example: string) =>
  z.string().trim().max(200).optional().transform((v) => v || undefined)
    .refine((v) => v === undefined || hosts.test(v), `Enter the full ${what} address, for example ${example}.`);
export const ownLinksSchema = z.object({
  github: profileUrl(/^https:\/\/(www\.)?github\.com\/[A-Za-z0-9._-]+\/?$/, "GitHub profile", "https://github.com/yourname"),
  leetcode: profileUrl(/^https:\/\/(www\.)?leetcode\.com\/(u\/)?[A-Za-z0-9._-]+\/?$/, "LeetCode profile", "https://leetcode.com/u/yourname"),
  linkedin: profileUrl(/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9._%-]+\/?$/, "LinkedIn profile", "https://www.linkedin.com/in/yourname"),
});

export const ACCOUNT_STATUSES = ["NOT_INVITED", "INVITED", "ACTIVE", "DISABLED"] as const;
