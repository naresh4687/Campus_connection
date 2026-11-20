"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { academicFormSchema, cgpaGapNote, parseSemesters } from "@/lib/academics";
import { reasonSchema, uuidSchema } from "@/lib/validation";
import { dbMessage, firstErrors, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession } from "../auth/session";

const FIELDS = ["cgpa", "tenth", "twelfth", "diploma", "backlogs", "arrears", "note"] as const;
const refresh = () => { revalidatePath("/student", "layout"); revalidatePath("/coordinator", "layout"); revalidatePath("/college", "layout"); };

export async function submitAcademicsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("STUDENT");
  const values = Object.fromEntries(FIELDS.map((k) => [k, str(fd, k, k === "note" ? 800 : 20)]));
  const r = academicFormSchema.safeParse(values);
  if (!r.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(r.error), values };
  const v = r.data;
  const sem = parseSemesters((k) => str(fd, k, 10));
  const semValues = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`sem${i + 1}_sgpa`, `sem${i + 1}_backlogs`]).flat().map((k) => [k, str(fd, k, 10)]));
  if (Object.keys(sem.errors).length) return { error: "Please correct the semester results.", fieldErrors: sem.errors, values: { ...values, ...semValues } };
  const gap = cgpaGapNote(v.cgpa, sem.rows.map((x) => ({ sgpa: x.sgpa })));
  if (gap && str(fd, "confirm_gap") !== "yes") return { error: gap + " Tick the box to submit anyway.", fieldErrors: { confirm_gap: "Confirm to submit anyway." }, values: { ...values, ...semValues } };
  const evidence = fd.getAll("evidence").filter((x): x is string => typeof x === "string" && uuidSchema.safeParse(x).success);
  const docs = evidence.length ? sql`ARRAY[${sql.join(evidence.map((i) => sql`${i}::uuid`))}]::uuid[]` : sql`'{}'::uuid[]`;
  try {
    await withSession(s, (t) => sql`SELECT academics.submit(${v.cgpa}::numeric, ${v.tenth}::numeric, ${v.twelfth ?? null}::numeric, ${v.diploma ?? null}::numeric, ${v.backlogs}::int, ${v.arrears}::int, ${v.note ?? null}, ${docs}, ${sem.rows.length ? JSON.stringify(sem.rows) : null}::jsonb)`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  refresh();
  redirect("/student/academics?notice=submitted");
}

export async function withdrawAcademicsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("STUDENT");
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  try {
    await withSession(s, (t) => sql`SELECT academics.withdraw(${id.data}::uuid)`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  redirect("/student/academics?notice=withdrawn");
}

export async function verifyAcademicsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("COORDINATOR");
  const id = uuidSchema.safeParse(str(fd, "id"));
  const note = str(fd, "note", 600).trim();
  if (!id.success) return { error: GENERIC_ERROR };
  if (note.length > 500) return { error: "Keep the note under 500 characters.", values: { note } };
  try {
    await withSession(s, (t) => sql`SELECT academics.verify(${id.data}::uuid, ${note || null})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values: { note } };
  }
  refresh();
  return { ok: "Verified. The student's academic record is now verified." };
}

export async function rejectAcademicsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("COORDINATOR");
  const id = uuidSchema.safeParse(str(fd, "id"));
  const reason = reasonSchema.safeParse(str(fd, "reason", 600));
  if (!id.success) return { error: GENERIC_ERROR };
  if (!reason.success) return { error: reason.error.issues[0].message, values: { reason: str(fd, "reason", 600) } };
  if (reason.data.length > 500) return { error: "Keep the reason under 500 characters.", values: { reason: reason.data } };
  try {
    await withSession(s, (t) => sql`SELECT academics.reject(${id.data}::uuid, ${reason.data})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values: { reason: reason.data } };
  }
  refresh();
  return { ok: "Rejected. The student can see your reason and submit a corrected version." };
}
