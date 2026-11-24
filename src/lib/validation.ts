import { z } from "zod";
import { DEGREES } from "./degrees";
import { COLLEGE_TYPES, INDIAN_STATES } from "./india";

const clean = (max: number, min = 1) => z.string().trim().min(min).max(max);

/** Only http(s) URLs are accepted. A `javascript:` / `data:` value would become a clickable link in the admin console. */
export const httpUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === "http:" || u.protocol === "https:") && !/\s/.test(v);
    } catch {
      return false;
    }
  }, "Enter a full website address starting with http:// or https://");

export const emailField = z.string().trim().toLowerCase().min(3).max(254).pipe(z.email("Enter a valid email address."));

export const phoneField = z.string().trim().regex(/^[0-9+() -]{7,20}$/, "Enter a valid phone number (digits, spaces, + ( ) - only).");

export const collegeApplicationSchema = z.object({
  name: clean(200, 2).describe("College name"),
  officialEmail: emailField,
  address: clean(500, 5),
  state: z.enum(INDIAN_STATES, "Choose a state or union territory."),
  district: clean(100, 2),
  website: httpUrl,
  contactPerson: clean(120, 2),
  phone: phoneField,
  collegeType: z.enum(COLLEGE_TYPES.map((t) => t.value) as [string, ...string[]], "Choose a college type."),
  approxStudents: z.coerce.number("Enter a number.").int("Enter a whole number.").min(10, "Enter at least 10.").max(200000, "Enter at most 200,000."),
});
export type CollegeApplicationInput = z.infer<typeof collegeApplicationSchema>;

export const inquirySchema = z.object({
  name: clean(120, 2),
  email: emailField,
  organization: z.string().trim().max(200).optional(),
  message: clean(2000, 10),
});

export const reasonSchema = z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000, "Keep the reason under 1000 characters.");

export const COMMERCIAL_STATUSES = ["NOT_STARTED", "PENDING", "ACTIVE", "EXPIRED", "SUSPENDED"] as const;

/** Escapes LIKE wildcards so user search text is matched literally. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const uuidSchema = z.uuid();

/** Safe-to-render external link: returns the URL only for http(s), otherwise null. */
export function safeHref(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export const departmentSchema = z.object({
  name: clean(100, 2),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,11}$/, "Use 2–12 letters, digits or hyphens (e.g. CSE, ECE-2)."),
  description: z.string().trim().max(500, "Keep the description under 500 characters.").optional(),
  degree: z.enum(DEGREES, "Choose the degree this department offers."),
});

export const STAFF_ROLES = ["PLACEMENT_OFFICER", "COORDINATOR"] as const;
export const staffInviteSchema = z
  .object({ email: emailField, role: z.enum(STAFF_ROLES, "Choose a role."), departmentId: z.string().optional() })
  .superRefine((v, ctx) => {
    if (v.role !== "COORDINATOR") return;
    if (!v.departmentId || !z.uuid().safeParse(v.departmentId).success) ctx.addIssue({ code: "custom", path: ["departmentId"], message: "Choose the department this coordinator will look after." });
  });

export const collegeProfileSchema = z.object({
  address: clean(500, 5),
  district: clean(100, 2),
  state: z.enum(INDIAN_STATES, "Choose a state or union territory."),
  website: httpUrl,
  contactPerson: clean(120, 2),
  phone: phoneField,
  approxStudents: z.coerce.number("Enter a number.").int("Enter a whole number.").min(10, "Enter at least 10.").max(200000, "Enter at most 200,000."),
});
