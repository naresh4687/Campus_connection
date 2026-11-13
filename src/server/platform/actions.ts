"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { COMMERCIAL_STATUSES, collegeApplicationSchema, emailField, inquirySchema, reasonSchema, uuidSchema } from "@/lib/validation";
import { db } from "../db";
import { allow, allowIp } from "../auth/rate-limit";
import { assertSameOrigin } from "../auth/request";
import { dbMessage, firstErrors, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { invitationLink } from "../auth/links";
import { requireRole, withSession } from "../auth/session";
import { hashToken, newToken } from "../auth/tokens";

export type PlatformState = ActionState;

const RATE_ERROR = "Too many requests. Please wait a while and try again.";
const GENERIC = GENERIC_ERROR;
const INVITE_TTL_SECONDS = 7 * 24 * 3600;

// ───────────────────────── public actions ─────────────────────────

const APPLY_FIELDS = ["name", "officialEmail", "address", "state", "district", "website", "contactPerson", "phone", "collegeType", "approxStudents"] as const;

export async function submitApplicationAction(_prev: PlatformState, fd: FormData): Promise<PlatformState> {
  await assertSameOrigin();
  const values = Object.fromEntries(APPLY_FIELDS.map((k) => [k, str(fd, k, 600)]));
  // Honeypot: real users never see or fill this field. Bots get a plausible redirect and nothing is stored.
  if (str(fd, "contactUrl")) redirect(`/apply/status?ref=${newToken()}&new=1`);

  const parsed = collegeApplicationSchema.safeParse(values);
  if (!parsed.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(parsed.error), values };
  const a = parsed.data;

  if (!(await allowIp("apply", 5, 3600)) || !(await allow("apply-email", a.officialEmail, 3, 86400)) || !(await allow("apply-global", "all", 200, 3600))) {
    return { error: RATE_ERROR, values };
  }

  const token = newToken();
  try {
    await sql`SELECT platform.submit_application(${hashToken(token)}, ${a.name}, ${a.officialEmail}, ${a.address}, ${a.state}, ${a.district},
      ${a.website}, ${a.contactPerson}, ${a.phone}, ${a.collegeType}, ${a.approxStudents})`.execute(db());
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return { error: "An application for this official email address is already on file. Contact us if it needs to be changed.", values };
    }
    if ((e as { code?: string }).code === "23514") return { error: "Some details were not accepted. Please check them and try again.", values };
    throw e;
  }
  redirect(`/apply/status?ref=${token}&new=1`);
}

export async function submitInquiryAction(_prev: PlatformState, fd: FormData): Promise<PlatformState> {
  await assertSameOrigin();
  const values = { name: str(fd, "name", 200), email: str(fd, "email", 300), organization: str(fd, "organization", 300), message: str(fd, "message", 3000) };
  if (str(fd, "contactUrl")) return { ok: "Thank you — your message was received." };
  const parsed = inquirySchema.safeParse(values);
  if (!parsed.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(parsed.error), values };
  const i = parsed.data;
  if (!(await allowIp("inquiry", 5, 3600)) || !(await allow("inquiry-email", i.email, 5, 86400)) || !(await allow("inquiry-global", "all", 300, 3600))) {
    return { error: RATE_ERROR, values };
  }
  await sql`SELECT platform.submit_inquiry(${i.name}, ${i.email}, ${i.organization ?? null}, ${i.message})`.execute(db());
  return { ok: "Thank you — your message was received. Replies are sent manually, so please allow a few days." };
}

// ───────────────────────── platform administrator actions ─────────────────────────

async function admin() {
  await assertSameOrigin();
  return requireRole("PLATFORM_SUPER_ADMIN");
}
const refresh = () => revalidatePath("/platform", "layout");

export async function startReviewAction(_p: PlatformState, fd: FormData): Promise<PlatformState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC };
  try {
    await withSession(s, (t) => sql`SELECT platform.start_review(${id.data}::uuid)`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  return { ok: "Review started." };
}

export async function approveApplicationAction(_p: PlatformState, fd: FormData): Promise<PlatformState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const email = emailField.safeParse(str(fd, "adminEmail"));
  if (!id.success) return { error: GENERIC };
  if (!email.success) return { error: "Enter a valid email address for the college administrator.", values: { adminEmail: str(fd, "adminEmail") } };
  const token = newToken();
  try {
    // One transaction: if the invitation cannot be created, the approval is rolled back.
    await withSession(s, async (t) => {
      const c = await sql<{ id: string }>`SELECT platform.approve_application(${id.data}::uuid) AS id`.execute(t);
      await sql`SELECT auth.create_invitation(${email.data}, 'COLLEGE_ADMIN', ${c.rows[0].id}::uuid, ${hashToken(token)}, ${INVITE_TTL_SECONDS})`.execute(t);
    });
  } catch (e) {
    return { error: dbMessage(e), values: { adminEmail: email.data } };
  }
  refresh();
  return { ok: "Application approved. The college workspace was created.", invite: { link: await invitationLink(token), email: email.data, expires: "expires in 7 days" } };
}

export async function rejectApplicationAction(_p: PlatformState, fd: FormData): Promise<PlatformState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const reason = reasonSchema.safeParse(str(fd, "reason"));
  if (!id.success) return { error: GENERIC };
  if (!reason.success) return { error: reason.error.issues[0].message, values: { reason: str(fd, "reason") } };
  try {
    await withSession(s, (t) => sql`SELECT platform.reject_application(${id.data}::uuid, ${reason.data})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values: { reason: reason.data } };
  }
  refresh();
  return { ok: "Application rejected. The applicant will see the reason on their status page." };
}

export async function setCommercialStatusAction(_p: PlatformState, fd: FormData): Promise<PlatformState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const status = z.enum(COMMERCIAL_STATUSES).safeParse(str(fd, "status"));
  const note = str(fd, "note", 1000);
  if (!id.success || !status.success) return { error: GENERIC };
  try {
    await withSession(s, (t) => sql`SELECT platform.set_commercial_status(${id.data}::uuid, ${status.data}, ${note || null})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values: { note } };
  }
  refresh();
  return { ok: "Commercial status recorded." };
}

export async function setCollegeAccessAction(_p: PlatformState, fd: FormData): Promise<PlatformState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const status = z.enum(["ACTIVE", "SUSPENDED"]).safeParse(str(fd, "status"));
  if (!id.success || !status.success) return { error: GENERIC };
  let reason: string | null = null;
  if (status.data === "SUSPENDED") {
    const r = reasonSchema.safeParse(str(fd, "reason"));
    if (!r.success) return { error: r.error.issues[0].message, values: { reason: str(fd, "reason") } };
    reason = r.data;
  }
  try {
    await withSession(s, (t) => sql`SELECT platform.set_college_access(${id.data}::uuid, ${status.data}, ${reason})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values: { reason: reason ?? "" } };
  }
  refresh();
  return { ok: status.data === "SUSPENDED" ? "College suspended. All of its users were signed out and cannot sign in." : "College reactivated." };
}

export async function issueAdminInvitationAction(_p: PlatformState, fd: FormData): Promise<PlatformState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const email = emailField.safeParse(str(fd, "adminEmail"));
  if (!id.success) return { error: GENERIC };
  if (!email.success) return { error: "Enter a valid email address.", values: { adminEmail: str(fd, "adminEmail") } };
  const token = newToken();
  try {
    await withSession(s, (t) => sql`SELECT auth.create_invitation(${email.data}, 'COLLEGE_ADMIN', ${id.data}::uuid, ${hashToken(token)}, ${INVITE_TTL_SECONDS})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values: { adminEmail: email.data } };
  }
  refresh();
  return { ok: "Invitation created. Any earlier unused invitation for this email is now invalid.", invite: { link: await invitationLink(token), email: email.data, expires: "expires in 7 days" }, values: { adminEmail: email.data } };
}

export async function handleInquiryAction(_p: PlatformState, fd: FormData): Promise<PlatformState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC };
  try {
    await withSession(s, (t) => sql`SELECT platform.handle_inquiry(${id.data}::uuid)`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  return { ok: "Marked as handled." };
}
