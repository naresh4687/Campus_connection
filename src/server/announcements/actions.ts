"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { contentSchema, parseRegisterNumbers, parseYears, SOURCES, toDbFields, type AudienceInput } from "@/lib/announcements";
import { uuidSchema } from "@/lib/validation";
import { dbMessage, firstErrors, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession, type SessionUser } from "../auth/session";
import { CATEGORY_LABEL, KIND_OF, type Category } from "@/lib/composer/classify";
import { extractAnnouncement, prefill } from "@/lib/composer/extract";
import { FIELDS_FOR } from "@/lib/announcements";
import { MAX_SOURCE_CHARS, MIN_SOURCE_CHARS } from "@/lib/intake/catalog";
import { matchStudents } from "./queries";

/** Officers and coordinators only. The database re-checks everything (ownership, departments, drives) whatever this layer does. */
async function staff() { await assertSameOrigin(); return requireRole("PLACEMENT_OFFICER", "COORDINATOR"); }
const basePath = (s: SessionUser) => (s.role === "COORDINATOR" ? "/coordinator/announcements" : "/placement/announcements");
const refresh = () => { revalidatePath("/placement", "layout"); revalidatePath("/coordinator", "layout"); revalidatePath("/student", "layout"); };
const KEYS = ["kind", "title", "company_name", "drive_id", "priority", "display_mode", "summary", "original_message", "event_date", "event_time", "venue", "instructions", "consent_deadline", "expires_at", "action_link", "stages", "batches"] as const;
const read = (fd: FormData) => Object.fromEntries(KEYS.map((k) => [k, str(fd, k, k === "original_message" ? 20050 : 5100)]));

type Built = { audience?: AudienceInput; error?: string; fieldErrors?: Record<string, string>; table?: NonNullable<Extract<ActionState, object>["table"]> };

/** Turns the audience part of the form into the object the database function cleans and checks. Named students are matched by register number; any number that does not match stops the save. */
async function readAudience(s: SessionUser, fd: FormData): Promise<Built> {
  const source = str(fd, "aud_source", 30);
  if (!(SOURCES as readonly string[]).includes(source)) return { fieldErrors: { aud_source: "Choose who should receive this." } };
  const departments = fd.getAll("aud_departments").map(String).filter((d) => uuidSchema.safeParse(d).success);
  const yearsText = str(fd, "aud_years", 100).trim();
  const years = yearsText ? parseYears(yearsText) : [];
  if (years === null) return { fieldErrors: { aud_years: "Enter passing years such as 2026, 2027." } };
  const a: AudienceInput = { source: source as AudienceInput["source"], departments, years };
  if (source === "CAREER") a.career = str(fd, "aud_career", 40);
  if (source === "DRIVE_REGISTERED" || source === "DRIVE_SHORTLISTED" || source === "DRIVE_SELECTED") a.drive = str(fd, "aud_drive", 40);
  if (source === "NAMED") {
    const numbers = parseRegisterNumbers(str(fd, "aud_named", 20000));
    if (!numbers.length) return { fieldErrors: { aud_named: "Enter at least one register number." } };
    const found = await matchStudents(s, numbers);
    const foundSet = new Set(found.map((f) => f.register_number.toLowerCase()));
    const missing = numbers.filter((n) => !foundSet.has(n.toLowerCase()));
    if (missing.length) return { error: "Some register numbers did not match a student you may address. Nothing was saved. Fix or remove them and save again.", table: { headers: ["Register number", "Result"], rows: missing.map((m) => [m, "No matching student"]) } };
    if (fd.get("aud_named_confirmed") !== "yes") return { fieldErrors: { aud_named_confirmed: "Tick the box to confirm these students." }, table: { headers: ["Register number", "Name", "Department"], rows: found.map((f) => [f.register_number, f.full_name, f.department_code]) } };
    a.students = found.map((f) => f.student_id); a.named_confirmed = true;
  }
  return { audience: a };
}

export async function saveAnnouncementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await staff();
  const values = read(fd);
  const idRaw = str(fd, "id", 40);
  const id = idRaw ? uuidSchema.safeParse(idRaw) : null;
  if (id && !id.success) return { error: GENERIC_ERROR, values };
  const r = contentSchema.safeParse(values);
  if (!r.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(r.error), values };
  const db = toDbFields(r.data);
  if (db.error) return { error: db.error, values };
  const aud = await readAudience(s, fd);
  if (aud.error || aud.fieldErrors) return { error: aud.error ?? "Please correct the highlighted fields.", fieldErrors: aud.fieldErrors, table: aud.table, values: { ...values, ...Object.fromEntries([...fd.entries()].filter(([k, v]) => k.startsWith("aud_") && typeof v === "string") as [string, string][]) } };
  let savedId = "";
  try {
    savedId = await withSession(s, async (t) => (await sql<{ id: string }>`
      SELECT announcements.save(${id?.success ? id.data : null}::uuid, ${JSON.stringify(db.fields)}::jsonb, ${JSON.stringify(aud.audience)}::jsonb, ${str(fd, "reason", 500) || null}, ${fd.get("notify") === "yes"}) AS id`.execute(t)).rows[0].id);
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  refresh();
  if (!id) redirect(`${basePath(s)}/${savedId}?created=1`);
  return { ok: "Saved." };
}

export async function publishAnnouncementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await staff();
  const id = uuidSchema.safeParse(str(fd, "id", 40));
  if (!id.success) return { error: GENERIC_ERROR };
  if (fd.get("confirm") !== "yes") return { error: "Tick the box to confirm that you checked the preview and the audience." };
  let n = 0;
  try { n = await withSession(s, async (t) => (await sql<{ n: number }>`SELECT announcements.publish(${id.data}::uuid) AS n`.execute(t)).rows[0].n); } catch (e) { return { error: dbMessage(e) }; }
  refresh();
  redirect(`${basePath(s)}/${id.data}?published=${n}`);
}

export async function archiveAnnouncementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await staff();
  const id = uuidSchema.safeParse(str(fd, "id", 40));
  if (!id.success) return { error: GENERIC_ERROR };
  try { await withSession(s, (t) => sql`SELECT announcements.archive(${id.data}::uuid)`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  refresh();
  redirect(basePath(s));
}

const ANNOUNCEMENT_CATEGORIES = ["ON_CAMPUS_DRIVE", "RECRUITMENT_PROCESS", "TRAINING_VENUE", "ALTERNATE_ROLE_CONSENT", "GENERAL"] as const;
const titleFrom = (text: string, category: Category) => {
  const first = text.split("\n").map((l) => l.replace(/[*_~]/g, "").trim()).find((l) => l.length >= 3) ?? "";
  return (first.slice(0, 120) || CATEGORY_LABEL[category]).trim();
};

/**
 * Saves a pasted message as an ANNOUNCEMENT draft of the type staff confirmed. A new drive is never created here (drives go through the officer-only
 * AI drive intake), so a coordinator cannot reach drive creation through this door. The message is kept exactly as pasted; nothing is published
 * or sent, and no audience is chosen for the staff member. The same message from the same person within ten minutes opens the existing draft.
 */
export async function composeAnnouncementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await staff();
  const text = str(fd, "message", MAX_SOURCE_CHARS + 50).replace(/\0/g, "").replace(/\r\n?/g, "\n").trim();
  const keep = { message: text };
  if (text.length < MIN_SOURCE_CHARS) return { error: "Paste the message first.", values: keep };
  if (text.length > MAX_SOURCE_CHARS) return { error: `The message is longer than ${MAX_SOURCE_CHARS} characters. Paste the important part.`, values: { message: text.slice(0, MAX_SOURCE_CHARS) } };
  const category = str(fd, "category", 40);
  if (category === "NEW_DRIVE") return { error: s.role === "PLACEMENT_OFFICER" ? "A new drive is created through AI-assisted drive creation, not as an announcement." : "Only placement officers can create placement drives. Choose an announcement type, or ask a placement officer.", values: keep };
  if (!(ANNOUNCEMENT_CATEGORIES as readonly string[]).includes(category)) return { error: "Choose the type of this message.", values: keep };
  const cat = category as (typeof ANNOUNCEMENT_CATEGORIES)[number];
  const kept = text;
  let id = "";
  try {
    id = await withSession(s, async (t) => {
      const same = (await sql<{ id: string }>`SELECT id FROM announcements WHERE created_by = ${s.userId}::uuid AND original_message = ${kept} AND status <> 'ARCHIVED' AND created_at > now() - interval '10 minutes' ORDER BY created_at DESC LIMIT 1`.execute(t)).rows[0];
      if (same) return same.id;
      // Read the message: only settled values are pre-filled, and only fields that apply to this type of announcement. The draft is never published and has no audience.
      const drives = (await sql<{ id: string; company_name: string; job_title: string; status: string }>`SELECT * FROM announcements.linkable_drives()`.execute(t)).rows;
      const x = extractAnnouncement(text, cat, { now: new Date(), drives });
      const kind = KIND_OF[cat]; const applies = new Set<string>([...FIELDS_FOR[kind], "company_name", "title", "summary", "drive_id"]);
      const filled = Object.fromEntries(Object.entries(prefill(x)).filter(([k, v]) => applies.has(k) && v !== null && v !== undefined));
      const fields = { ...filled, kind, title: (filled.title as string | undefined) ?? titleFrom(text, cat), original_message: kept, display_mode: filled.summary ? "BOTH" : "ORIGINAL", priority: "NORMAL" };
      const made = (await sql<{ id: string }>`SELECT announcements.save(null::uuid, ${JSON.stringify(fields)}::jsonb, null::jsonb, null, false) AS id`.execute(t)).rows[0].id;
      await sql`SELECT announcements.save_extraction(${made}::uuid, ${JSON.stringify(x)}::jsonb, 'patterns', 'ann-1')`.execute(t);
      return made;
    });
  } catch (e) {
    return { error: dbMessage(e), values: keep };
  }
  refresh();
  redirect(`${basePath(s)}/${id}?created=1&composed=1`);
}
