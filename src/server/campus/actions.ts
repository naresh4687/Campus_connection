"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { istToIso } from "@/lib/drives";
import { uuidSchema } from "@/lib/validation";
import { dbMessage, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession } from "../auth/session";

const refresh = () => { revalidatePath("/placement", "layout"); revalidatePath("/student", "layout"); };
async function officer() { await assertSameOrigin(); return requireRole("PLACEMENT_OFFICER"); }
const uuidList = (fd: FormData, k: string) => fd.getAll(k).filter((v): v is string => typeof v === "string" && uuidSchema.safeParse(v).success).slice(0, 500);
const pgArray = (xs: string[]) => sql.raw(`ARRAY[${xs.map((x) => `'${x}'`).join(",")}]::uuid[]`);

/** Create an on-campus drive: a posted drive or a new company, when/where, who may attend, and the rounds. Then go to its page, where the attendance links are. */
export async function createCampusEventAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const mode = str(fd, "mode") === "posted" ? "posted" : "new";
  const drive = mode === "posted" ? uuidSchema.safeParse(str(fd, "driveId")) : null;
  const values: Record<string, string> = { mode, driveId: str(fd, "driveId"), company: str(fd, "company", 200), title: str(fd, "title", 200), details: str(fd, "details", 3200), venue: str(fd, "venue", 300), at: str(fd, "at"),
    years: str(fd, "years", 100), roundCount: str(fd, "roundCount", 3) };
  const fe: Record<string, string> = {};
  if (mode === "posted" && !drive?.success) fe.driveId = "Choose the posted drive.";
  if (mode === "new" && values.company.trim().length < 2) fe.company = "Enter the company name.";
  const at = values.at ? istToIso(values.at) : null;
  if (!at) fe.at = "Enter the date and time of the drive.";
  const names = fd.getAll("roundName").filter((v): v is string => typeof v === "string").map((v) => v.trim().slice(0, 100)).filter(Boolean).slice(0, 10);
  const times = fd.getAll("roundAt").map((v) => (typeof v === "string" ? v : ""));
  if (names.length === 0) fe.rounds = "Add at least one round.";
  const years = values.years.split(/[,\s]+/).filter(Boolean).map(Number);
  if (years.some((y) => !Number.isInteger(y) || y < 2000 || y > 2100)) fe.years = "Enter batch years such as 2027, 2028.";
  if (Object.keys(fe).length) return { error: "Please correct the highlighted fields.", fieldErrors: fe, values };
  const rounds = names.map((name, i) => ({ name, scheduled_at: times[i] ? istToIso(times[i]) : null }));
  let id: string;
  try {
    const r = await withSession(s, (t) => sql<{ id: string }>`SELECT campus.create_event(${drive?.success ? drive.data : null}::uuid, ${values.company || null}, ${values.title || null}, ${values.details || null}, ${values.venue || null},
      ${at}::timestamptz, ${pgArray(uuidList(fd, "dept"))}, ${sql.raw(`ARRAY[${years.join(",")}]::int[]`)}, ${JSON.stringify(rounds)}::jsonb) AS id`.execute(t));
    id = r.rows[0].id;
  } catch (e) { return { error: dbMessage(e), values }; }
  refresh();
  redirect(`/placement/campus/${id}?notice=created`);
}

export async function updateCampusEventAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const values = { title: str(fd, "title", 200), details: str(fd, "details", 3200), venue: str(fd, "venue", 300), at: str(fd, "at") };
  if (!id.success) return { error: GENERIC_ERROR };
  const at = istToIso(values.at);
  if (values.title.trim().length < 2) return { error: "Enter a title.", fieldErrors: { title: "Enter a title." }, values };
  if (!at) return { error: "Enter a valid date and time.", fieldErrors: { at: "Enter a valid date and time." }, values };
  try { await withSession(s, (t) => sql`SELECT campus.update_event(${id.data}::uuid, ${values.title}, ${values.details || null}, ${values.venue || null}, ${at}::timestamptz)`.execute(t)); } catch (e) { return { error: dbMessage(e), values }; }
  refresh();
  return { ok: "Saved.", values };
}

export async function setCampusEventStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const id = uuidSchema.safeParse(str(fd, "id")); const status = str(fd, "status", 20);
  if (!id.success || !["UPCOMING", "COMPLETED", "CANCELLED"].includes(status)) return { error: GENERIC_ERROR };
  try { await withSession(s, (t) => sql`SELECT campus.set_event_status(${id.data}::uuid, ${status})`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  refresh();
  return { ok: status === "COMPLETED" ? "Marked completed. Attendance is closed." : status === "CANCELLED" ? "Cancelled." : "Reopened." };
}

export async function addCampusRoundAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const id = uuidSchema.safeParse(str(fd, "id")); const name = str(fd, "name", 100).trim(); const atRaw = str(fd, "at");
  if (!id.success) return { error: GENERIC_ERROR };
  if (!name) return { error: "Enter the round name.", fieldErrors: { name: "Enter the round name." }, values: { name, at: atRaw } };
  const at = atRaw ? istToIso(atRaw) : null;
  if (atRaw && !at) return { error: "Enter a valid date and time.", fieldErrors: { at: "Enter a valid date and time." }, values: { name, at: atRaw } };
  try { await withSession(s, (t) => sql`SELECT campus.add_round(${id.data}::uuid, ${name}, ${at}::timestamptz)`.execute(t)); } catch (e) { return { error: dbMessage(e), values: { name, at: atRaw } }; }
  refresh();
  return { ok: "Round added. Its attendance link is ready." };
}

export async function setCampusRoundStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const id = uuidSchema.safeParse(str(fd, "round")); const status = str(fd, "status", 10);
  if (!id.success || !["OPEN", "CLOSED"].includes(status)) return { error: GENERIC_ERROR };
  try { await withSession(s, (t) => sql`SELECT campus.set_round_status(${id.data}::uuid, ${status})`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  refresh();
  return { ok: status === "OPEN" ? "Attendance is open. Eligible students were notified." : "Attendance closed." };
}

export async function setCampusAttendanceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const round = uuidSchema.safeParse(str(fd, "round")); const present = str(fd, "present") === "1"; const studs = uuidList(fd, "student");
  if (!round.success) return { error: GENERIC_ERROR };
  if (studs.length === 0) return { error: "Select at least one student." };
  let n = 0;
  try { n = (await withSession(s, (t) => sql<{ n: number }>`SELECT campus.set_attendance(${round.data}::uuid, ${pgArray(studs)}, ${present}) AS n`.execute(t))).rows[0].n; } catch (e) { return { error: dbMessage(e) }; }
  refresh();
  return { ok: present ? `${n} student${n === 1 ? "" : "s"} marked present.` : `${n} student${n === 1 ? "" : "s"} marked absent.` };
}

export async function setCampusAdvancementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const round = uuidSchema.safeParse(str(fd, "round")); const advance = str(fd, "advance") === "1"; const studs = uuidList(fd, "student");
  if (!round.success) return { error: GENERIC_ERROR };
  if (studs.length === 0) return { error: "Select at least one student." };
  let n = 0;
  try { n = (await withSession(s, (t) => sql<{ n: number }>`SELECT campus.set_advancement(${round.data}::uuid, ${pgArray(studs)}, ${advance}) AS n`.execute(t))).rows[0].n; } catch (e) { return { error: dbMessage(e) }; }
  refresh();
  return { ok: advance ? `${n} student${n === 1 ? "" : "s"} marked eligible for the next round.` : `${n} student${n === 1 ? "" : "s"} removed from the next round.` };
}

/** Student: mark myself present through the round's link (or the button on the list). Back to the page with the outcome. */
export async function markCampusAttendanceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("STUDENT");
  const token = str(fd, "token", 100);
  if (!/^[0-9a-f]{64}$/.test(token)) return { error: "This attendance link is not valid." };
  try { await withSession(s, (t) => sql`SELECT campus.mark_attendance(${token})`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  refresh();
  return { ok: "You are marked present." };
}

/** The roster form's three buttons share one form; a hidden `intent` field says which was pressed (a button's own name/value is not sent to function actions). */
export async function campusRosterAction(p: ActionState, fd: FormData): Promise<ActionState> {
  const intent = str(fd, "intent", 20);
  if (intent === "advance" || intent === "unadvance") { fd.set("advance", intent === "advance" ? "1" : "0"); return setCampusAdvancementAction(p, fd); }
  if (intent === "absent") { fd.set("present", "0"); return setCampusAttendanceAction(p, fd); }
  return { error: GENERIC_ERROR };
}
