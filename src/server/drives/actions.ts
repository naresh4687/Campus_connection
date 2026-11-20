"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { driveFormSchema } from "@/lib/drives";
import { istToIso } from "@/lib/announcements";
import { uuidSchema } from "@/lib/validation";
import { dbMessage, firstErrors, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession } from "../auth/session";
import { saveDriveDraft } from "./save";

const SCALARS = ["companyName", "title", "description", "location", "type", "ctc", "ctcNote", "bond", "qualification", "openings", "deadline", "interview", "instructions", "minCgpa", "minTenth", "minTwelfth", "minDiploma", "maxBacklogs", "maxArrears"] as const;
const refresh = () => revalidatePath("/placement", "layout");

async function officer() { await assertSameOrigin(); return requireRole("PLACEMENT_OFFICER"); }

export async function saveDriveAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const idRaw = str(fd, "id");
  const id = idRaw ? uuidSchema.safeParse(idRaw) : null;
  if (id && !id.success) return { error: GENERIC_ERROR };
  const values: Record<string, string> = Object.fromEntries(SCALARS.map((k) => [k, str(fd, k, k === "description" || k === "instructions" ? 4200 : 1200)]));
  const multi = { departments: fd.getAll("departments").map(String), years: fd.getAll("years").map(String), degrees: fd.getAll("degrees").map(String) };
  const r = driveFormSchema.safeParse({ ...values, ...multi });
  const ext = { externalEnabled: fd.get("externalEnabled") === "yes" ? "yes" : "", externalUrl: str(fd, "externalUrl", 500).trim(), externalInstructions: str(fd, "externalInstructions", 2000), externalConfirmed: fd.get("externalConfirmed") === "yes" ? "yes" : "" };
  const keep = { ...values, ...ext, departments: multi.departments.join(","), years: multi.years.join(","), degrees: multi.degrees.join(",") };
  const extErrors: Record<string, string> = {};
  if (ext.externalEnabled) {
    if (!/^https?:\/\/[^\s]{4,490}$/.test(ext.externalUrl)) extErrors.externalUrl = "Enter the company’s full registration link, starting with https://";
    if (!ext.externalConfirmed) extErrors.externalConfirmed = "Tick the box to confirm the link and the screenshot step.";
  }
  if (!r.success || Object.keys(extErrors).length) return { error: "Please correct the highlighted fields.", fieldErrors: { ...(r.success ? {} : firstErrors(r.error)), ...extErrors }, values: keep };
  const v = r.data;
  let savedId = "";
  try {
    savedId = await withSession(s, async (t) => {
      const saved = await saveDriveDraft(t, id?.data ?? null, v);
      // How students register: one click in CampusConnect, or through the company's own form followed by a screenshot of its confirmation page.
      await sql`SELECT placement.set_drive_registration(${saved}::uuid, ${ext.externalEnabled ? "EXTERNAL" : "INTERNAL"}, ${ext.externalEnabled ? ext.externalUrl : null}, ${ext.externalEnabled ? ext.externalInstructions || null : null}, ${!!ext.externalConfirmed}, true)`.execute(t);
      return saved;
    });
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

/** Extends the deadline of a published drive (placement officers only; the database checks the new time, requires a reason and records it in the audit log). */
export async function extendDeadlineAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const iso = istToIso(str(fd, "deadline", 20));
  if (!id.success || !iso) return { error: "Choose the new deadline." };
  try { await withSession(s, (t) => sql`SELECT placement.extend_deadline(${id.data}::uuid, ${iso}::timestamptz, ${str(fd, "reason", 500)})`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  refresh(); revalidatePath("/student", "layout");
  return { ok: "The deadline was extended. Registration is open again until the new time." };
}
