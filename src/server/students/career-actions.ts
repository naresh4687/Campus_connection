"use server";

import { revalidatePath } from "next/cache";
import { sql } from "kysely";
import { isCareerCode } from "@/lib/career";
import { uuidSchema } from "@/lib/validation";
import { dbMessage, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { allow } from "../auth/rate-limit";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession } from "../auth/session";

/**
 * A coordinator moves one or more students to a career category, with a reason. The database decides who may (only a
 * coordinator currently assigned to every selected student's department) and records the history; nothing here is trusted.
 */
export async function setCareerPreferenceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("COORDINATOR");
  const preference = str(fd, "preference", 40);
  const reason = str(fd, "reason", 300).trim();
  const ids = [...new Set(fd.getAll("ids").map(String))];
  if (ids.length === 0) return { error: "Select at least one student." };
  if (ids.length > 200) return { error: "Select at most 200 students at a time." };
  if (!ids.every((i) => uuidSchema.safeParse(i).success) || !isCareerCode(preference)) return { error: GENERIC_ERROR };
  if (reason.length < 3) return { error: "Give a short reason (at least 3 characters)." };
  if (!(await allow("career-preference", s.userId, 60, 3600))) return { error: "Too many changes. Please wait a while and try again." };
  try {
    const n = Number((await withSession(s, (t) => sql<{ n: number }>`SELECT students.set_career_preference(ARRAY[${sql.join(ids.map((i) => sql`${i}::uuid`))}]::uuid[], ${preference}, ${reason}) AS n`.execute(t))).rows[0].n);
    revalidatePath("/coordinator", "layout");
    return { ok: n === 0 ? "No change: every selected student already has this preference." : `Updated ${n} student${n === 1 ? "" : "s"}.` };
  } catch (e) {
    return { error: dbMessage(e) };
  }
}
