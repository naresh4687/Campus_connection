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

/** Step 1-3 of an external registration: the database re-checks eligibility, the deadline and duplicates and records the intent. Nothing is "registered" yet. */
export async function beginExternalAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("STUDENT");
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  try { await withSession(s, (t) => sql`SELECT * FROM registrations.begin_external(${id.data}::uuid)`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  revalidatePath("/student", "layout");
  redirect(`/student/drives/${id.data}?notice=external-started`);
}


export async function allowLateEvidenceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("PLACEMENT_OFFICER");
  const id = uuidSchema.safeParse(str(fd, "registration"));
  const hours = Number.parseInt(str(fd, "hours", 5), 10);
  if (!id.success || !Number.isInteger(hours)) return { error: GENERIC_ERROR };
  try { await withSession(s, (t) => sql`SELECT registrations.allow_late_evidence(${id.data}::uuid, ${hours}::int, ${str(fd, "note", 500)})`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  revalidatePath("/placement", "layout"); revalidatePath("/student", "layout");
  return { ok: "The student can now upload a late screenshot." };
}

/** How students register for a drive. An external link must be confirmed by the officer as the real registration form; the database also refuses to publish an unconfirmed one. */
export async function setDriveRegistrationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("PLACEMENT_OFFICER");
  const id = uuidSchema.safeParse(str(fd, "id"));
  const method = str(fd, "method", 20);
  if (!id.success || !["INTERNAL", "EXTERNAL"].includes(method)) return { error: GENERIC_ERROR };
  if (method === "EXTERNAL" && fd.get("confirmed") !== "yes") return { error: "Tick the box to confirm that this link is the real registration form.", values: { url: str(fd, "url", 500), instructions: str(fd, "instructions", 2000) } };
  try {
    await withSession(s, (t) => sql`SELECT placement.set_drive_registration(${id.data}::uuid, ${method}, ${str(fd, "url", 500) || null}, ${str(fd, "instructions", 2000) || null}, ${fd.get("confirmed") === "yes"}, ${fd.get("review") !== "no"})`.execute(t));
  } catch (e) { return { error: dbMessage(e), values: { url: str(fd, "url", 500), instructions: str(fd, "instructions", 2000) } }; }
  revalidatePath("/placement", "layout"); revalidatePath("/student", "layout");
  return { ok: method === "EXTERNAL" ? "Saved. Students will register through the company’s website and upload a screenshot." : "Saved. Students register in one click." };
}

/** Reminds the eligible students who have not registered (an officer: any department; a coordinator: their own). The database limits it to one reminder per drive and scope every six hours. */
export async function remindStudentsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("PLACEMENT_OFFICER", "COORDINATOR");
  const id = uuidSchema.safeParse(str(fd, "drive"));
  const deptRaw = str(fd, "dept", 40);
  const dept = deptRaw ? uuidSchema.safeParse(deptRaw) : null;
  if (!id.success || (dept && !dept.success)) return { error: GENERIC_ERROR };
  if (fd.get("confirm") !== "yes") return { error: "Tick the box to confirm that you want to send this reminder." };
  let n = 0;
  try { n = await withSession(s, async (t) => (await sql<{ n: number }>`SELECT registrations.remind_students(${id.data}::uuid, ${dept?.success ? dept.data : null}::uuid) AS n`.execute(t)).rows[0].n); } catch (e) { return { error: dbMessage(e) }; }
  revalidatePath("/placement", "layout"); revalidatePath("/coordinator", "layout");
  return { ok: n === 0 ? "No one needs a reminder: every eligible student in this scope has registered (or has no account yet)." : `Reminder sent to ${n} student${n === 1 ? "" : "s"}.` };
}

export async function remindCoordinatorsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("PLACEMENT_OFFICER");
  const id = uuidSchema.safeParse(str(fd, "drive"));
  if (!id.success) return { error: GENERIC_ERROR };
  if (fd.get("confirm") !== "yes") return { error: "Tick the box to confirm that you want to notify the coordinators." };
  let n = 0;
  try { n = await withSession(s, async (t) => (await sql<{ n: number }>`SELECT registrations.remind_coordinators(${id.data}::uuid) AS n`.execute(t)).rows[0].n); } catch (e) { return { error: dbMessage(e) }; }
  revalidatePath("/coordinator", "layout");
  return { ok: n === 0 ? "No department has eligible students waiting, or no coordinator is assigned." : `${n} coordinator${n === 1 ? "" : "s"} notified.` };
}
