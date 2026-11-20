"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { achievementSchema } from "@/lib/achievements";
import { reasonSchema, uuidSchema } from "@/lib/validation";
import { dbMessage, firstErrors, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession } from "../auth/session";

// Coordinator decisions deliberately revalidate nothing: any revalidation re-renders the open queue, which would drop the decided card (and its outcome message)
// at once. Every portal page is rendered per request, so the next visit to any page already shows the decision.
const refresh = () => { revalidatePath("/student", "layout"); revalidatePath("/coordinator", "layout"); revalidatePath("/college", "layout"); };
const FIELDS = ["kind", "title", "date", "description", "link"] as const;

export async function addAchievementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("STUDENT");
  const values = Object.fromEntries(FIELDS.map((k) => [k, str(fd, k, k === "description" ? 800 : 400)]));
  const r = achievementSchema.safeParse(values);
  if (!r.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(r.error), values };
  const v = r.data;
  try {
    await withSession(s, (t) => sql`SELECT achievements.add(${v.kind}, ${v.title}, ${v.date}::date, ${v.description ?? null}, ${v.link ?? null})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  refresh();
  return { ok: "Added. A coordinator of your department will review it." };
}

export async function reviseAchievementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("STUDENT");
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  const values = Object.fromEntries(FIELDS.map((k) => [k, str(fd, k, k === "description" ? 800 : 400)]));
  const r = achievementSchema.safeParse(values);
  if (!r.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(r.error), values };
  const v = r.data;
  try {
    await withSession(s, (t) => sql`SELECT achievements.revise(${id.data}::uuid, ${v.kind}, ${v.title}, ${v.date}::date, ${v.description ?? null}, ${v.link ?? null})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  refresh();
  return { ok: "Sent for review. Your verified entry stays as it is until a coordinator verifies the change." };
}

export async function withdrawAchievementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("STUDENT");
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  try {
    await withSession(s, (t) => sql`SELECT achievements.withdraw(${id.data}::uuid)`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  return { ok: "Withdrawn." };
}

export async function verifyAchievementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("COORDINATOR");
  const id = uuidSchema.safeParse(str(fd, "id"));
  const note = str(fd, "note", 600).trim();
  if (!id.success) return { error: GENERIC_ERROR };
  if (note.length > 500) return { error: "Keep the note under 500 characters.", values: { note } };
  try {
    await withSession(s, (t) => sql`SELECT achievements.verify(${id.data}::uuid, ${note || null})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values: { note } };
  }
  return { ok: "Verified." };
}

export async function rejectAchievementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("COORDINATOR");
  const id = uuidSchema.safeParse(str(fd, "id"));
  const reason = reasonSchema.safeParse(str(fd, "reason", 600));
  if (!id.success) return { error: GENERIC_ERROR };
  if (!reason.success) return { error: reason.error.issues[0].message, values: { reason: str(fd, "reason", 600) } };
  if (reason.data.length > 500) return { error: "Keep the reason under 500 characters.", values: { reason: reason.data } };
  try {
    await withSession(s, (t) => sql`SELECT achievements.reject(${id.data}::uuid, ${reason.data})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values: { reason: reason.data } };
  }
  return { ok: "Returned. The student can see your reason." };
}
