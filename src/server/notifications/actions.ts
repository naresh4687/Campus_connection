"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CATEGORIES_FOR } from "@/lib/notifications";
import { scopedHref } from "@/lib/portals";
import { dbMessage, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { assertSameOrigin } from "../auth/request";
import { requireSession, withSession } from "../auth/session";
import { removeDevice, setPushEnabled } from "../push/subscriptions";
import { uuidSchema } from "@/lib/validation";

export async function markAllReadAction(): Promise<void> {
  await assertSameOrigin();
  const s = await requireSession();
  await withSession(s, (t) => sql`SELECT notifications.mark_all_read()`.execute(t));
  revalidatePath("/", "layout");
  redirect(scopedHref("/notifications?notice=all-read", s.slot));
}

export async function setPreferenceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireSession();
  const category = str(fd, "category", 20); const enabled = str(fd, "enabled", 5);
  if (!(CATEGORIES_FOR[s.role] ?? []).includes(category) || (enabled !== "yes" && enabled !== "no")) return { error: GENERIC_ERROR };
  try { await withSession(s, (t) => sql`SELECT notifications.set_preference(${category}, ${enabled === "yes"})`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  revalidatePath("/notifications", "layout");
  return { ok: enabled === "yes" ? "Turned on." : "Turned off." };
}

/** The account-wide switch for push alerts (devices stay registered; nothing is sent while it is off). */
export async function setPushEnabledAction(fd: FormData): Promise<void> {
  await assertSameOrigin();
  const s = await requireSession();
  if (!s.collegeId) return;
  await setPushEnabled(s, str(fd, "enabled", 5) === "yes");
  revalidatePath("/notifications", "layout");
}

/** Removes one of the caller's own devices (the database checks ownership; another person's device id matches nothing). */
export async function removePushDeviceAction(fd: FormData): Promise<void> {
  await assertSameOrigin();
  const s = await requireSession();
  const id = uuidSchema.safeParse(str(fd, "id", 40));
  if (!s.collegeId || !id.success) return;
  await removeDevice(s, id.data);
  revalidatePath("/notifications", "layout");
}
