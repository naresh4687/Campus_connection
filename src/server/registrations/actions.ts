"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { uuidSchema } from "@/lib/validation";
import { dbMessage, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession } from "../auth/session";

async function run(fd: FormData, fn: "register" | "withdraw", notice: string): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("STUDENT");
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  try {
    await withSession(s, (t) => (fn === "register" ? sql`SELECT registrations.register(${id.data}::uuid)` : sql`SELECT registrations.withdraw(${id.data}::uuid)`).execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  revalidatePath("/student", "layout");
  revalidatePath("/placement", "layout");
  redirect(`/student/drives/${id.data}?notice=${notice}`);
}

// The server decides eligibility, deadline and status inside the database transaction; nothing the browser sends is trusted.
export const registerAction = async (_p: ActionState, fd: FormData) => run(fd, "register", "registered");
export const withdrawAction = async (_p: ActionState, fd: FormData) => run(fd, "withdraw", "withdrawn");
