"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CATEGORIES_FOR } from "@/lib/notifications";
import { dbMessage, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { assertSameOrigin } from "../auth/request";
import { requireSession, withSession } from "../auth/session";

export async function markAllReadAction(): Promise<void> {
  await assertSameOrigin();
  const s = await requireSession();
  await withSession(s, (t) => sql`SELECT notifications.mark_all_read()`.execute(t));
  revalidatePath("/", "layout");
  redirect("/notifications?notice=all-read");
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
