"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { collegeProfileSchema, departmentSchema, staffInviteSchema, uuidSchema } from "@/lib/validation";
import { dbMessage, firstErrors, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { invitationLink, resetLink } from "../auth/links";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession } from "../auth/session";
import { hashToken, newToken } from "../auth/tokens";

const INVITE_TTL_SECONDS = 7 * 24 * 3600;
const RESET_TTL_SECONDS = 24 * 3600;

async function admin() {
  await assertSameOrigin();
  return requireRole("COLLEGE_ADMIN");
}
const refresh = () => revalidatePath("/college", "layout");

// ───────────── departments ─────────────
export async function createDepartmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const values = { name: str(fd, "name", 200), code: str(fd, "code", 40), description: str(fd, "description", 700) };
  const parsed = departmentSchema.safeParse(values);
  if (!parsed.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(parsed.error), values };
  try {
    await withSession(s, (t) => sql`SELECT college.create_department(${parsed.data.name}, ${parsed.data.code}, ${parsed.data.description ?? null})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  refresh();
  return { ok: `Department ${parsed.data.code} created.` };
}

export async function updateDepartmentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const values = { name: str(fd, "name", 200), code: str(fd, "code", 40), description: str(fd, "description", 700) };
  const parsed = departmentSchema.safeParse(values);
  if (!id.success) return { error: GENERIC_ERROR };
  if (!parsed.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(parsed.error), values };
  try {
    await withSession(s, (t) => sql`SELECT college.update_department(${id.data}::uuid, ${parsed.data.name}, ${parsed.data.code}, ${parsed.data.description ?? null})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  refresh();
  return { ok: "Department saved." };
}

export async function setDepartmentStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const status = z.enum(["ACTIVE", "INACTIVE"]).safeParse(str(fd, "status"));
  if (!id.success || !status.success) return { error: GENERIC_ERROR };
  try {
    await withSession(s, (t) => sql`SELECT college.set_department_status(${id.data}::uuid, ${status.data})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  return { ok: status.data === "INACTIVE" ? "Department deactivated." : "Department reactivated." };
}

export async function assignCoordinatorAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const dept = uuidSchema.safeParse(str(fd, "departmentId"));
  const user = uuidSchema.safeParse(str(fd, "userId"));
  if (!dept.success || !user.success) return { error: "Choose a coordinator and a department." };
  try {
    await withSession(s, (t) => sql`SELECT college.assign_coordinator(${dept.data}::uuid, ${user.data}::uuid)`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  return { ok: "Coordinator assigned." };
}

export async function unassignCoordinatorAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const dept = uuidSchema.safeParse(str(fd, "departmentId"));
  const user = uuidSchema.safeParse(str(fd, "userId"));
  if (!dept.success || !user.success) return { error: GENERIC_ERROR };
  try {
    await withSession(s, (t) => sql`SELECT college.unassign_coordinator(${dept.data}::uuid, ${user.data}::uuid)`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  return { ok: "Assignment removed." };
}

// ───────────── staff ─────────────
export async function inviteStaffAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const values = { email: str(fd, "email", 300), role: str(fd, "role", 40) };
  const parsed = staffInviteSchema.safeParse(values);
  if (!parsed.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(parsed.error), values };
  const token = newToken();
  try {
    await withSession(s, (t) => sql`SELECT auth.create_invitation(${parsed.data.email}, ${parsed.data.role}, ${s.collegeId}::uuid, ${hashToken(token)}, ${INVITE_TTL_SECONDS})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  refresh();
  return { ok: "Invitation created.", invite: { link: await invitationLink(token), email: parsed.data.email, expires: "expires in 7 days" }, values: { role: parsed.data.role } };
}

export async function revokeInvitationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  try {
    await withSession(s, (t) => sql`SELECT auth.revoke_invitation(${id.data}::uuid)`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  return { ok: "Invitation revoked." };
}

export async function setStaffStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const status = z.enum(["ACTIVE", "DISABLED"]).safeParse(str(fd, "status"));
  if (!id.success || !status.success) return { error: GENERIC_ERROR };
  try {
    await withSession(s, (t) => sql`SELECT auth.set_user_status(${id.data}::uuid, ${status.data})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  return { ok: status.data === "DISABLED" ? "Account disabled. Their sessions were signed out." : "Account enabled." };
}

export async function issueResetLinkAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const email = str(fd, "email", 300);
  if (!id.success) return { error: GENERIC_ERROR };
  const token = newToken();
  try {
    await withSession(s, (t) => sql`SELECT auth.issue_password_reset(${id.data}::uuid, ${hashToken(token)}, ${RESET_TTL_SECONDS})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  return { ok: "Reset link created.", invite: { link: await resetLink(token), email, expires: "expires in 24 hours" } };
}

// ───────────── college profile ─────────────
const PROFILE_FIELDS = ["address", "district", "state", "website", "contactPerson", "phone", "approxStudents"] as const;
export async function updateProfileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const values = Object.fromEntries(PROFILE_FIELDS.map((k) => [k, str(fd, k, 600)]));
  const parsed = collegeProfileSchema.safeParse(values);
  if (!parsed.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(parsed.error), values };
  const p = parsed.data;
  try {
    await withSession(s, (t) => sql`SELECT college.update_profile(${p.address}, ${p.district}, ${p.state}, ${p.website}, ${p.contactPerson}, ${p.phone}, ${p.approxStudents})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  refresh();
  return { ok: "College profile saved.", values };
}
