"use server";

import { createHash } from "node:crypto";
import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { driveFormSchema } from "@/lib/drives";
import { EXTRACTION_VERSION, FIELDS, MAX_SOURCE_CHARS, MIN_SOURCE_CHARS, extractionSchema, type Fields } from "@/lib/intake/catalog";
import { applyChoices, applyEdits, readiness, toDriveValues, type Posted } from "@/lib/intake/edit";
import { uuidSchema } from "@/lib/validation";
import { dbMessage, firstErrors, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { runExtraction } from "../ai/pipeline";
import { allow } from "../auth/rate-limit";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession, type SessionUser } from "../auth/session";
import { driveFormOptions } from "../drives/queries";
import { saveDriveDraft } from "../drives/save";
import { getIntake } from "./queries";

const refresh = () => revalidatePath("/placement", "layout");
async function officer() { await assertSameOrigin(); return requireRole("PLACEMENT_OFFICER"); }
const reviewUrl = (id: string) => `/placement/drives/ai/${id}`;
const TYPES = ["PASTED", "EMAIL", "WHATSAPP", "OTHER"] as const;

/** The college's own departments: announcement text is mapped onto these, never onto invented ones. */
async function context(s: SessionUser) {
  const { departments } = await driveFormOptions(s);
  return { now: new Date(), departments };
}

/**
 * Turns the SETTLED fields into the ordinary drive draft (create or update) through the one audited drive function, and links it to the intake.
 * Returns a message when the draft could not be made or updated; the intake itself is already saved either way. Never publishes.
 */
async function syncDraft(s: SessionUser, intakeId: string, fields: Fields, driveId: string | null, departments: { id: string; code: string; name: string }[]): Promise<{ driveId: string | null; problem?: string }> {
  const m = toDriveValues(fields, { departments });
  if (!m.canCreate) return { driveId, problem: driveId ? "Add the company, job title and employment type to update the drive draft." : undefined };
  const r = driveFormSchema.safeParse({ ...m.values, departments: m.values.departments ? m.values.departments.split(",") : [], years: m.values.years ? m.values.years.split(",") : [], degrees: m.values.degrees ? m.values.degrees.split(",") : [] });
  if (!r.success) return { driveId, problem: `The drive draft was not updated: ${Object.values(firstErrors(r.error))[0]}` };
  try {
    const id = await withSession(s, async (t) => {
      const saved = await saveDriveDraft(t, driveId, r.data);
      if (saved !== driveId) await sql`SELECT placement.save_intake_fields(${intakeId}::uuid, ${JSON.stringify(fields)}::jsonb, ${saved}::uuid, false)`.execute(t);
      return saved;
    });
    return { driveId: id };
  } catch (e) {
    return { driveId, problem: `The drive draft was not updated: ${dbMessage(e)}` };
  }
}

async function runAndStore(s: SessionUser, id: string, text: string): Promise<{ ok: boolean }> {
  const ctx = await context(s);
  try {
    const result = await runExtraction(text, ctx);
    const extraction = extractionSchema.parse(result.extraction);                    // validated; never raw model output
    await withSession(s, (t) => sql`SELECT placement.store_intake_result(${id}::uuid, 'READY', ${result.provider}, ${result.model}, ${EXTRACTION_VERSION}, ${JSON.stringify(extraction)}::jsonb, ${JSON.stringify(extraction.fields)}::jsonb, null)`.execute(t));
    const sync = await syncDraft(s, id, extraction.fields, null, ctx.departments);
    void sync;
    return { ok: true };
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { ok: true };             // another request finished it first
    console.error("intake extraction failed:", (e as Error).message);
    try { await withSession(s, (t) => sql`SELECT placement.store_intake_result(${id}::uuid, 'FAILED', null, null, ${EXTRACTION_VERSION}, null, null, ${"The extraction failed. Your announcement is saved. Try again, or fill the form yourself."})`.execute(t)); } catch { /* the source is already stored */ }
    return { ok: false };
  }
}

export async function startIntakeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const text = str(fd, "announcement", MAX_SOURCE_CHARS + 50).replace(/\0/g, "").replace(/\r\n?/g, "\n").trim();     // NUL bytes cannot be stored and are never part of an announcement
  const keep = { announcement: text };
  const key = uuidSchema.safeParse(str(fd, "key"));
  if (!key.success) return { error: "Please reload the page and try again.", values: keep };
  if (text.length < MIN_SOURCE_CHARS) return { error: "Paste the company’s announcement first.", values: keep };
  if (text.length > MAX_SOURCE_CHARS) return { error: `The announcement is longer than ${MAX_SOURCE_CHARS} characters. Paste the important part, or split it into two drives.`, values: { announcement: text.slice(0, MAX_SOURCE_CHARS) } };
  const type = z.enum(TYPES).catch("PASTED").parse(str(fd, "sourceType"));
  if (!(await allow("intake-extract", s.userId, 30, 3600))) return { error: "Too many requests. Please wait a while and try again.", values: keep };
  const hash = createHash("sha256").update(text).digest("hex");
  let id = ""; let status = "";
  try {
    const row = (await withSession(s, (t) => sql<{ id: string; status: string; created: boolean }>`SELECT * FROM placement.create_intake(${key.data}::uuid, ${text}, ${hash}, ${type})`.execute(t))).rows[0];
    id = row.id; status = row.status;
  } catch (e) {
    return { error: dbMessage(e), values: keep };
  }
  if (status === "PENDING" || status === "FAILED") await runAndStore(s, id, text);     // a retried request for a finished intake just opens it
  refresh();
  redirect(reviewUrl(id));
}

export async function retryIntakeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  if (!(await allow("intake-extract", s.userId, 30, 3600))) return { error: "Too many requests. Please wait a while and try again." };
  const rec = await getIntake(s, id.data);
  if (!rec || (rec.status !== "FAILED" && rec.status !== "PENDING")) return { error: GENERIC_ERROR };
  const r = await runAndStore(s, id.data, rec.source_text);
  refresh();
  if (!r.ok) return { error: "The extraction failed again. Your announcement is still saved." };
  redirect(reviewUrl(id.data));
}

/** Runs the extraction again and keeps the result aside. Nothing the officer has entered is touched until they pick values from the comparison. */
export async function reextractAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  if (!(await allow("intake-extract", s.userId, 30, 3600))) return { error: "Too many requests. Please wait a while and try again." };
  const rec = await getIntake(s, id.data);
  if (!rec || rec.status !== "READY" || rec.drive_status === "PUBLISHED") return { error: GENERIC_ERROR };
  try {
    const ctx = await context(s);
    const result = await runExtraction(rec.source_text, ctx);
    const extraction = extractionSchema.parse(result.extraction);
    await withSession(s, (t) => sql`SELECT placement.store_intake_pending(${id.data}::uuid, ${result.provider}, ${result.model}, ${EXTRACTION_VERSION}, ${JSON.stringify({ fields: extraction.fields, warnings: extraction.warnings, provider: result.provider, model: result.model })}::jsonb)`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  return { ok: "The announcement was read again. Compare the results below; nothing you entered was changed." };
}

function postedFrom(fd: FormData): Record<string, Posted> {
  const out: Record<string, Posted> = {};
  for (const def of FIELDS) {
    const multi = def.kind === "departments" || def.kind === "years" || def.kind === "degrees";
    const raw = multi ? fd.getAll(`f.${def.key}`).map(String) : str(fd, `f.${def.key}`, (def.max ?? 1000) + 500);
    out[def.key] = { raw, confirm: fd.get(`c.${def.key}`) === "yes" };
  }
  return out;
}

export async function saveIntakeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  const rec = await getIntake(s, id.data);
  if (!rec || rec.status !== "READY") return { error: GENERIC_ERROR };
  if (rec.drive_status && rec.drive_status !== "DRAFT") return { error: "This drive has already left draft. Unpublish it first to edit it." };
  const ctx = await context(s);
  const { fields, errors } = applyEdits(rec.fields, postedFrom(fd), ctx);
  if (Object.keys(errors).length) return { error: "Please correct the highlighted fields. Nothing was saved.", fieldErrors: errors };
  try {
    await withSession(s, (t) => sql`SELECT placement.save_intake_fields(${id.data}::uuid, ${JSON.stringify(fields)}::jsonb, null, false)`.execute(t));
  } catch (e) { return { error: dbMessage(e) }; }
  const sync = await syncDraft(s, id.data, fields, rec.drive_id, ctx.departments);
  refresh();
  return sync.problem ? { ok: "Your changes are saved.", notes: [sync.problem] } : { ok: sync.driveId ? "Saved to the draft drive." : "Saved. The drive draft is created once the company, job title and employment type are filled in." };
}

export async function applyPendingAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  const rec = await getIntake(s, id.data);
  if (!rec || rec.status !== "READY" || !rec.pending || (rec.drive_status && rec.drive_status !== "DRAFT")) return { error: GENERIC_ERROR };
  const keys = fd.getAll("take").map(String).filter((k) => FIELDS.some((f) => f.key === k));
  const fields = applyChoices(rec.fields, rec.pending.fields, keys);
  try {
    await withSession(s, (t) => sql`SELECT placement.save_intake_fields(${id.data}::uuid, ${JSON.stringify(fields)}::jsonb, null, true)`.execute(t));
  } catch (e) { return { error: dbMessage(e) }; }
  const ctx = await context(s);
  const sync = await syncDraft(s, id.data, fields, rec.drive_id, ctx.departments);
  refresh();
  // The comparison panel disappears once it is applied, so the result is shown on the reloaded page instead of inside the panel.
  if (sync.problem) return { ok: undefined, error: sync.problem };
  redirect(`${reviewUrl(id.data)}?applied=${keys.length}`);
}

export async function discardIntakeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  try { await withSession(s, (t) => sql`SELECT placement.discard_intake(${id.data}::uuid)`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  refresh();
  redirect("/placement/drives/new");
}

/**
 * The only way an AI-assisted drive becomes visible to students: a placement officer posts this form after seeing the preview and ticking the
 * confirmation. It re-checks readiness on the server, writes the reviewed fields to the draft, then calls the same publish function as manual drives
 * (eligibility, notifications and audit run from there). The extraction code never calls this.
 */
export async function publishIntakeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  if (fd.get("confirm") !== "yes") return { error: "Tick the box to confirm that you checked the preview." };
  const rec = await getIntake(s, id.data);
  if (!rec || rec.status !== "READY") return { error: GENERIC_ERROR };
  if (rec.drive_status && rec.drive_status !== "DRAFT") return { error: "This drive is not a draft." };
  const ctx = await context(s);
  const ready = readiness(rec.fields, ctx);
  if (!ready.ready) return { error: "This drive is not ready to publish yet.", notes: ready.errors.map((e) => e.message) };
  const sync = await syncDraft(s, id.data, rec.fields, rec.drive_id, ctx.departments);
  if (!sync.driveId || sync.problem) return { error: sync.problem ?? "The drive draft could not be created.", notes: [] };
  try {
    await withSession(s, (t) => sql`SELECT placement.publish_drive(${sync.driveId}::uuid)`.execute(t));
  } catch (e) { return { error: dbMessage(e) }; }
  refresh();
  redirect(`/placement/drives/${sync.driveId}?notice=published`);
}
