"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { istToIso } from "@/lib/drives";
import { uuidSchema } from "@/lib/validation";
import { dbMessage, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession } from "../auth/session";

const refresh = () => { revalidatePath("/placement", "layout"); revalidatePath("/student", "layout"); revalidatePath("/college", "layout"); };
const ids = (fd: FormData, ...keys: string[]) => { const out: string[] = []; for (const k of keys) { const v = uuidSchema.safeParse(str(fd, k)); if (!v.success) return null; out.push(v.data); } return out; };
const arrayOf = (xs: string[]) => sql.raw(`ARRAY[${xs.map((x) => `'${x}'`).join(",")}]::uuid[]`);

export async function selectStudentsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin(); const s = await requireRole("PLACEMENT_OFFICER");
  const k = ids(fd, "driveId"); const regs = fd.getAll("regs").map(String);
  if (!k || !regs.every((r) => uuidSchema.safeParse(r).success)) return { error: GENERIC_ERROR };
  if (regs.length === 0) return { error: "Tick at least one student." };
  try { await withSession(s, (t) => sql`SELECT offers.select_students(${k[0]}::uuid, ${arrayOf(regs)})`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  refresh(); redirect(`/placement/drives/${k[0]}/offers?notice=selected`);
}

export async function issueOfferAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin(); const s = await requireRole("PLACEMENT_OFFICER");
  const k = ids(fd, "driveId", "selectionId"); if (!k) return { error: GENERIC_ERROR };
  const letterRaw = str(fd, "letterId"); const letter = letterRaw ? uuidSchema.safeParse(letterRaw) : null;
  if (letter && !letter.success) return { error: GENERIC_ERROR };
  const ctcRaw = str(fd, "ctc", 20).trim();
  if (ctcRaw && !/^\d{1,4}(\.\d{1,2})?$/.test(ctcRaw)) return { error: "Enter the CTC in LPA, for example 6.5.", values: { ctc: ctcRaw, deadline: str(fd, "deadline") } };
  const deadline = istToIso(str(fd, "deadline"));
  if (!deadline) return { error: "Enter the response deadline (date and time, IST).", values: { ctc: ctcRaw, deadline: str(fd, "deadline") } };
  try { await withSession(s, (t) => sql`SELECT offers.issue_offer(${k[1]}::uuid, ${ctcRaw || null}::numeric, ${deadline}::timestamptz, ${letter?.data ?? null}::uuid)`.execute(t)); } catch (e) { return { error: dbMessage(e), values: { ctc: ctcRaw, deadline: str(fd, "deadline") } }; }
  refresh(); redirect(`/placement/drives/${k[0]}/offers?notice=issued`);
}

export async function extendDeadlineAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin(); const s = await requireRole("PLACEMENT_OFFICER");
  const k = ids(fd, "driveId", "selectionId"); if (!k) return { error: GENERIC_ERROR };
  const deadline = istToIso(str(fd, "deadline")); if (!deadline) return { error: "Enter the new deadline (date and time, IST)." };
  try { await withSession(s, (t) => sql`SELECT offers.extend_deadline(${k[1]}::uuid, ${deadline}::timestamptz)`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  refresh(); redirect(`/placement/drives/${k[0]}/offers?notice=extended`);
}

export async function withdrawOfferAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin(); const s = await requireRole("PLACEMENT_OFFICER");
  const k = ids(fd, "driveId", "selectionId"); if (!k) return { error: GENERIC_ERROR };
  const reason = str(fd, "reason", 600);
  try { await withSession(s, (t) => sql`SELECT offers.withdraw_offer(${k[1]}::uuid, ${reason})`.execute(t)); } catch (e) { return { error: dbMessage(e), values: { reason } }; }
  refresh(); redirect(`/placement/drives/${k[0]}/offers?notice=withdrawn`);
}

export async function respondAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin(); const s = await requireRole("STUDENT");
  const k = ids(fd, "selectionId"); const choice = str(fd, "accept", 5);
  if (!k || (choice !== "yes" && choice !== "no")) return { error: GENERIC_ERROR };
  try { await withSession(s, (t) => sql`SELECT offers.respond(${k[0]}::uuid, ${choice === "yes"})`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  refresh(); redirect(`/student/offers/${k[0]}?notice=${choice === "yes" ? "accepted" : "declined"}`);
}

export async function recordJoiningAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin(); const s = await requireRole("STUDENT");
  const k = ids(fd, "selectionId", "fileId");
  const keep = { joinedOn: str(fd, "joinedOn", 12), designation: str(fd, "designation", 200), note: str(fd, "note", 600) };
  if (!k) return { error: "Upload your joining proof first, then record joining.", values: keep };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(keep.joinedOn)) return { error: "Enter the date you joined.", values: keep };
  try { await withSession(s, (t) => sql`SELECT offers.record_joining(${k[0]}::uuid, ${keep.joinedOn}::date, ${keep.designation || null}, ${keep.note || null}, ${k[1]}::uuid)`.execute(t)); } catch (e) { return { error: dbMessage(e), values: keep }; }
  refresh(); redirect(`/student/offers/${k[0]}?notice=joining`);
}

export async function decidePlacementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin(); const s = await requireRole("PLACEMENT_OFFICER");
  const k = ids(fd, "selectionId"); const decision = str(fd, "decision", 10);
  if (!k || !["VERIFIED", "REJECTED"].includes(decision)) return { error: GENERIC_ERROR };
  const reason = str(fd, "reason", 600);
  try { await withSession(s, (t) => sql`SELECT offers.decide_placement(${k[0]}::uuid, ${decision}, ${reason || null})`.execute(t)); } catch (e) { return { error: dbMessage(e), values: { reason } }; }
  refresh(); redirect(`/placement/placements?notice=${decision === "VERIFIED" ? "verified" : "rejected"}`);
}

export async function overridePlacementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin(); const s = await requireRole("COLLEGE_ADMIN");
  const k = ids(fd, "selectionId"); const decision = str(fd, "decision", 10);
  if (!k || !["VERIFIED", "REJECTED"].includes(decision)) return { error: GENERIC_ERROR };
  const reason = str(fd, "reason", 600);
  try { await withSession(s, (t) => sql`SELECT offers.override_placement(${k[0]}::uuid, ${decision}, ${reason})`.execute(t)); } catch (e) { return { error: dbMessage(e), values: { reason } }; }
  refresh(); redirect(`/college/placements?notice=overridden`);
}
