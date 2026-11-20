"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbMessage, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession } from "../auth/session";
import { uuidSchema } from "@/lib/validation";

/** A coordinator (or officer) records that a student is placed in a company with the package in LPA. A coordinator's record waits for an officer's verification. */
export async function recordPlacementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("COORDINATOR", "PLACEMENT_OFFICER");
  const company = uuidSchema.safeParse(str(fd, "company")); const student = uuidSchema.safeParse(str(fd, "student"));
  const ctc = Number(str(fd, "ctc", 12).replace(/,/g, "."));
  const joined = str(fd, "joined", 12);
  const offer = str(fd, "offer", 12) === "ACCEPTED" ? "ACCEPTED" : "OFFERED";
  const values = { student: str(fd, "student"), ctc: str(fd, "ctc", 12), joined, note: str(fd, "note", 300), offer };
  if (!company.success) return { error: GENERIC_ERROR, values };
  if (!student.success) return { error: "Choose the student.", values };
  if (!Number.isFinite(ctc) || ctc <= 0) return { error: "Enter the package in LPA (for example 6.5).", values };
  try {
    await withSession(s, (t) => sql`SELECT placement.record_manual_placement(${company.data}::uuid, ${student.data}::uuid, ${ctc}::numeric, ${joined && /^\d{4}-\d{2}-\d{2}$/.test(joined) ? joined : null}::date, ${values.note || null}, ${offer})`.execute(t));
  } catch (e) { return { error: dbMessage(e), values }; }
  revalidatePath("/coordinator", "layout"); revalidatePath("/placement", "layout");
  redirect(`${s.role === "COORDINATOR" ? "/coordinator" : "/placement"}/companies/${company.data}?recorded=1`);
}

export async function reviewPlacementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("PLACEMENT_OFFICER");
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  const verify = fd.get("decision") === "verify";
  try { await withSession(s, (t) => sql`SELECT placement.review_manual_placement(${id.data}::uuid, ${verify}, ${str(fd, "note", 300) || null})`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  revalidatePath("/placement", "layout"); revalidatePath("/coordinator", "layout");
  redirect(`/placement/placements?reviewed=${verify ? "verified" : "rejected"}`);
}

/** Officer: mark an offer accepted (the database refuses if the student already accepted another), or put it back to "got offer". */
export async function setOfferStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("PLACEMENT_OFFICER");
  const id = uuidSchema.safeParse(str(fd, "id")); const company = str(fd, "company");
  const status = str(fd, "status", 12) === "ACCEPTED" ? "ACCEPTED" : "OFFERED";
  if (!id.success) return { error: GENERIC_ERROR };
  try { await withSession(s, (t) => sql`SELECT placement.set_offer_status(${id.data}::uuid, ${status})`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  revalidatePath("/placement", "layout"); revalidatePath("/coordinator", "layout");
  redirect(`/placement/companies/${company}?updated=${status === "ACCEPTED" ? "accepted" : "offered"}`);
}

export async function withdrawOfferAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("PLACEMENT_OFFICER");
  const id = uuidSchema.safeParse(str(fd, "id")); const company = str(fd, "company");
  if (!id.success) return { error: GENERIC_ERROR };
  try { await withSession(s, (t) => sql`SELECT placement.withdraw_manual_offer(${id.data}::uuid, ${str(fd, "note", 300) || null})`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  revalidatePath("/placement", "layout"); revalidatePath("/coordinator", "layout");
  redirect(`/placement/companies/${company}?updated=withdrawn`);
}

export type BatchRow = { student: string; ctc: string; offer: string; joined?: string; note?: string };
export type BatchResult = { added: number; failed: { student: string; message: string }[]; error?: string };

/**
 * Records several students' offers for one company in one go. Each student is saved on its own, so one refusal (an unknown package, a second acceptance, a duplicate)
 * never loses the others: the result lists exactly which students were added and which were refused and why.
 */
export async function recordOffersBatchAction(company: string, rows: BatchRow[]): Promise<BatchResult> {
  await assertSameOrigin();
  const s = await requireRole("COORDINATOR", "PLACEMENT_OFFICER");
  const co = uuidSchema.safeParse(company);
  if (!co.success || !Array.isArray(rows) || rows.length === 0 || rows.length > 100) return { added: 0, failed: [], error: "Add at least one student." };
  let added = 0; const failed: BatchResult["failed"] = [];
  for (const r of rows) {
    const st = uuidSchema.safeParse(String(r.student ?? ""));
    const ctc = Number(String(r.ctc ?? "").replace(/,/g, "."));
    if (!st.success) { failed.push({ student: String(r.student ?? ""), message: "Unknown student." }); continue; }
    if (!Number.isFinite(ctc) || ctc <= 0) { failed.push({ student: st.data, message: "Enter the package in LPA (for example 6.5)." }); continue; }
    const joined = typeof r.joined === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.joined) ? r.joined : null;
    try {
      await withSession(s, (t) => sql`SELECT placement.record_manual_placement(${co.data}::uuid, ${st.data}::uuid, ${ctc}::numeric, ${joined}::date, ${String(r.note ?? "").slice(0, 300) || null}, ${r.offer === "ACCEPTED" ? "ACCEPTED" : "OFFERED"})`.execute(t));
      added++;
    } catch (e) { failed.push({ student: st.data, message: dbMessage(e) }); }
  }
  if (added) { revalidatePath("/placement", "layout"); revalidatePath("/coordinator", "layout"); }
  return { added, failed };
}
