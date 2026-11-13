"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { MAX_ANNOUNCEMENT_CHARS, toFormValues, verifyExtraction } from "@/lib/ai-extract";
import { driveFormSchema, istToIso } from "@/lib/drives";
import { uuidSchema } from "@/lib/validation";
import { dbMessage, firstErrors, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { AiError, extractAnnouncement } from "../ai/extract";
import { allow } from "../auth/rate-limit";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession } from "../auth/session";
import { aiConfig } from "../config";
import { driveFormOptions } from "./queries";

const SCALARS = ["companyId", "title", "description", "location", "type", "ctc", "ctcNote", "bond", "qualification", "openings", "deadline", "interview", "instructions", "minCgpa", "minTenth", "minTwelfth", "minDiploma", "maxBacklogs", "maxArrears"] as const;
const refresh = () => revalidatePath("/placement", "layout");
const arr = (ids: (string | number)[], cast: string) => (ids.length ? sql`ARRAY[${sql.join(ids.map((x) => sql`${x}::${sql.raw(cast)}`))}]::${sql.raw(cast)}[]` : sql`'{}'::${sql.raw(cast)}[]`);

async function officer() { await assertSameOrigin(); return requireRole("PLACEMENT_OFFICER"); }

export async function saveDriveAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const idRaw = str(fd, "id");
  const id = idRaw ? uuidSchema.safeParse(idRaw) : null;
  if (id && !id.success) return { error: GENERIC_ERROR };
  const values: Record<string, string> = Object.fromEntries(SCALARS.map((k) => [k, str(fd, k, k === "description" || k === "instructions" ? 4200 : 1200)]));
  const multi = { departments: fd.getAll("departments").map(String), years: fd.getAll("years").map(String), degrees: fd.getAll("degrees").map(String) };
  const r = driveFormSchema.safeParse({ ...values, ...multi });
  const keep = { ...values, departments: multi.departments.join(","), years: multi.years.join(","), degrees: multi.degrees.join(",") };
  if (!r.success) return { error: "Please correct the highlighted fields.", fieldErrors: firstErrors(r.error), values: keep };
  const v = r.data;
  let savedId = "";
  try {
    savedId = await withSession(s, async (t) => (await sql<{ id: string }>`SELECT placement.save_drive(${id?.data ?? null}::uuid, ${v.companyId}::uuid, ${v.title}, ${v.description ?? null}, ${v.location ?? null}, ${v.type}, ${v.ctc ?? null}::numeric, ${v.ctcNote ?? null},
      ${v.bond ?? null}, ${v.qualification ?? null}, ${v.openings ?? null}::int, ${v.deadline ? istToIso(v.deadline) : null}::timestamptz, ${v.interview ?? null}, ${v.instructions ?? null},
      ${arr(v.departments, "uuid")}, ${arr(v.years, "int")}, ${arr(v.degrees, "text")}, ${v.minCgpa ?? null}::numeric, ${v.minTenth ?? null}::numeric, ${v.minTwelfth ?? null}::numeric, ${v.minDiploma ?? null}::numeric,
      ${v.maxBacklogs ?? null}::int, ${v.maxArrears ?? null}::int) AS id`.execute(t)).rows[0].id);
  } catch (e) {
    return { error: dbMessage(e), values: keep };
  }
  refresh();
  if (!id) redirect(`/placement/drives/${savedId}?created=1`);
  return { ok: "Draft saved.", values: keep };
}

export async function publishDriveAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  try {
    await withSession(s, (t) => sql`SELECT placement.publish_drive(${id.data}::uuid)`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  redirect(`/placement/drives/${id.data}?notice=published`);
}

export async function setDriveStatusAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const to = z.enum(["DRAFT", "CLOSED", "ARCHIVED"]).safeParse(str(fd, "to"));
  if (!id.success || !to.success) return { error: GENERIC_ERROR };
  try {
    await withSession(s, (t) => sql`SELECT placement.set_drive_status(${id.data}::uuid, ${to.data})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e) };
  }
  refresh();
  redirect(`/placement/drives/${id.data}?notice=${{ DRAFT: "unpublished", CLOSED: "closed", ARCHIVED: "archived" }[to.data]}`);
}

// ── optional AI helper: pre-fills the draft form from an announcement; saves nothing, publishes nothing, decides nothing ──

export async function extractDriveAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  if (!aiConfig().enabled) return { error: "The AI assistant is not configured for this installation." };
  const text = str(fd, "announcement", MAX_ANNOUNCEMENT_CHARS + 50).trim();
  if (text.length < 20) return { error: "Paste the announcement text first.", values: { announcement: text } };
  if (text.length > MAX_ANNOUNCEMENT_CHARS) return { error: `The announcement is longer than ${MAX_ANNOUNCEMENT_CHARS} characters. Paste the important part.`, values: { announcement: text.slice(0, MAX_ANNOUNCEMENT_CHARS) } };
  if (!(await allow("ai-extract", s.userId, 20, 3600))) return { error: "Too many requests. Please wait a while and try again.", values: { announcement: text } };
  try {
    const raw = await extractAnnouncement(text);
    const checked = verifyExtraction(text, raw);
    const opts = await driveFormOptions(s);
    const { values, notes } = toFormValues(checked.accepted, opts);
    const accepted = checked.fields.filter((f) => f.status === "VERIFIED").length;
    await withSession(s, (t) => sql`SELECT placement.log_ai_extraction(${text.length}::int, ${accepted}::int, ${checked.fields.length - accepted}::int)`.execute(t));
    return {
      ok: `${accepted} field(s) were found in the announcement and checked. Review them, then use them in the form below.`,
      values: { ...values, announcement: text },
      notes: [...notes, ...checked.issues.map((i) => `${i.kind === "MISSING" ? "Missing" : i.kind === "UNCERTAIN" ? "Uncertain" : i.kind === "CONTRADICTORY" ? "Contradictory" : "Ignored"} — ${i.note}`)],
      table: { headers: ["Field", "Value", "Check", "Quoted from the announcement"], rows: checked.fields.map((f) => [f.label, f.shown, f.status === "VERIFIED" ? "Found in the text" : f.status === "UNSUPPORTED" ? "Not in the text — ignored" : "Not valid — ignored", f.quote ?? ""]) },
    };
  } catch (e) {
    if (e instanceof AiError) return { error: e.message, values: { announcement: text } };
    console.error("AI extraction failed:", (e as Error).message);
    return { error: GENERIC_ERROR, values: { announcement: text } };
  }
}
