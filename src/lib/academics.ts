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

export type SubmissionValues = { cgpa: string; tenth_percentage: string; twelfth_percentage: string | null; diploma_percentage: string | null; active_backlogs: number; historical_arrears: number };

export const fmtPct = (v: string | number | null | undefined) => (v === null || v === undefined ? "Not provided" : `${Number(v).toFixed(2)}%`);
export const fmtCgpa = (v: string | number) => Number(v).toFixed(2);

export const SUBMISSION_LABEL: Record<string, string> = { SUBMITTED: "Awaiting review", VERIFIED: "Verified", REJECTED: "Rejected", SUPERSEDED: "Superseded", WITHDRAWN: "Withdrawn" };
