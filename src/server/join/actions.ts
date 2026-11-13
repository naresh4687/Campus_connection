"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DEGREES } from "@/lib/students";
import { uuidSchema } from "@/lib/validation";
import { dbMessage, firstErrors, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { allow, allowIp } from "../auth/rate-limit";
import { assertSameOrigin, clientIpHash } from "../auth/request";
import { hashPassword, newPasswordSchema } from "../auth/password";
import { requireRole, withSession } from "../auth/session";
import { db } from "../db";
import { parseJoinToken } from "./link";

const KEEP = ["fullName", "registerNumber", "collegeEmail", "personalEmail", "phone", "departmentId", "degree", "admissionYear", "passingYear"] as const;
const year = (label: string) => z.string().trim().regex(/^\d{4}$/, `Choose ${label}.`).transform(Number);

const joinSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name.").max(120),
  registerNumber: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9/._-]{2,29}$/, "Enter your register number (letters, digits, / . _ - only)."),
  collegeEmail: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter your college email address.")),
  personalEmail: z.string().trim().toLowerCase().max(254).refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address, or leave this empty."),
  phone: z.string().trim().regex(/^[0-9+() -]{7,20}$/, "Enter your mobile number (digits, spaces, + and - only)."),
  departmentId: z.uuid("Choose your department."),
  degree: z.enum(DEGREES, "Choose your degree."),
  admissionYear: year("the year you joined"),
  passingYear: year("the year you will finish"),
  password: newPasswordSchema,
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] })
  .refine((v) => v.passingYear > v.admissionYear && v.passingYear <= v.admissionYear + 8, { message: "The finishing year must be 1–8 years after the year you joined.", path: ["passingYear"] });

/** Public: asks for an account. Nothing becomes usable until the administrator or the department's coordinator approves. */
export async function submitJoinAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const token = str(fd, "token", 200);
  const link = parseJoinToken(token);
  const values: Record<string, string> = Object.fromEntries(KEEP.map((k) => [k, str(fd, k, 300)]));
  if (!link) return { error: "This sign-up link is not valid. Ask your college for a new one.", values };
  const r = joinSchema.safeParse({ ...Object.fromEntries(fd), token: undefined });
  if (!r.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(r.error), values };
  const v = r.data;
  if (!(await allowIp("join", 30, 3600)) || !(await allow("join-college", link.college, 120, 3600)) || !(await allow("join-email", v.collegeEmail, 5, 3600))) return { error: "Too many attempts. Please wait a while and try again.", values };
  try {
    await sql`SELECT students.submit_join_request(${link.college}::uuid, ${link.version}::int, ${v.departmentId}::uuid, ${v.registerNumber}, ${v.fullName}, ${v.collegeEmail}, ${v.personalEmail || null}::citext, ${v.phone},
      ${v.degree}, ${v.admissionYear}::int, ${v.passingYear}::int, ${await hashPassword(v.password)}, ${await clientIpHash()})`.execute(db());
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  redirect(`/join/${token}?done=1`);
}

export async function setJoinLinkAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("COLLEGE_ADMIN");
  const mode = str(fd, "mode", 10);
  if (!["enable", "disable", "rotate"].includes(mode)) return { error: GENERIC_ERROR };
  try { await withSession(s, (t) => sql`SELECT students.set_join_link(${mode !== "disable"}, ${mode === "rotate"})`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  revalidatePath("/college/students");
  return { ok: mode === "enable" ? "The sign-up link is on." : mode === "disable" ? "The sign-up link is off. Nobody can use it until you turn it on." : "A new link was created. The old one no longer works." };
}

export async function decideJoinAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("COLLEGE_ADMIN", "COORDINATOR");
  const id = uuidSchema.safeParse(str(fd, "id")); const approve = str(fd, "decision", 8);
  if (!id.success || !["approve", "reject"].includes(approve)) return { error: GENERIC_ERROR };
  const reason = str(fd, "reason", 600);
  try { await withSession(s, (t) => sql`SELECT students.decide_join_request(${id.data}::uuid, ${approve === "approve"}, ${reason || null})`.execute(t)); } catch (e) { return { error: dbMessage(e), values: { reason } }; }
  revalidatePath("/college", "layout"); revalidatePath("/coordinator", "layout");
  redirect(`${s.role === "COORDINATOR" ? "/coordinator/requests" : "/college/students/requests"}?notice=${approve === "approve" ? "approved" : "rejected"}`);
}
