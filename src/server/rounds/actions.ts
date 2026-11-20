"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { istToIso } from "@/lib/drives";
import { ROUND_KINDS } from "@/lib/rounds";
import { uuidSchema } from "@/lib/validation";
import { dbMessage, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession } from "../auth/session";

const back = (drive: string, notice: string) => redirect(`/placement/drives/${drive}/rounds?notice=${notice}`);
const refresh = () => { revalidatePath("/placement", "layout"); revalidatePath("/student", "layout"); };
async function officer() { await assertSameOrigin(); return requireRole("PLACEMENT_OFFICER"); }

export async function saveRoundAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const drive = uuidSchema.safeParse(str(fd, "driveId"));
  const idRaw = str(fd, "id");
  const id = idRaw ? uuidSchema.safeParse(idRaw) : null;
  if (!drive.success || (id && !id.success)) return { error: GENERIC_ERROR };
  const values = { name: str(fd, "name", 200), kind: str(fd, "kind"), at: str(fd, "at"), venue: str(fd, "venue", 400), instructions: str(fd, "instructions", 2200) };
  const fieldErrors: Record<string, string> = {};
  if (values.name.trim().length < 2) fieldErrors.name = "Enter the round name.";
  if (!z.enum(ROUND_KINDS.map((k) => k.value) as [string, ...string[]]).safeParse(values.kind).success) fieldErrors.kind = "Choose the round type.";
  if (values.venue.length > 300) fieldErrors.venue = "Keep this under 300 characters.";
  if (values.instructions.length > 2000) fieldErrors.instructions = "Keep this under 2000 characters.";
  let at: string | null = null;
  if (values.at) { at = istToIso(values.at); if (!at) fieldErrors.at = "Enter a valid date and time."; }
  if (Object.keys(fieldErrors).length) return { error: "Please correct the highlighted fields.", fieldErrors, values };
  try {
    await withSession(s, (t) => sql`SELECT rounds.save_round(${id?.data ?? null}::uuid, ${drive.data}::uuid, ${values.name}, ${values.kind}, ${at}::timestamptz, ${values.venue || null}, ${values.instructions || null})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values };
  }
  refresh();
  back(drive.data, id ? "round-saved" : "round-added");
}

export async function deleteRoundAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const drive = uuidSchema.safeParse(str(fd, "driveId")); const id = uuidSchema.safeParse(str(fd, "id"));
  if (!drive.success || !id.success) return { error: GENERIC_ERROR };
  try { await withSession(s, (t) => sql`SELECT rounds.delete_round(${id.data}::uuid)`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  refresh();
  back(drive.data, "round-deleted");
}

export async function setResultsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const drive = uuidSchema.safeParse(str(fd, "driveId")); const round = uuidSchema.safeParse(str(fd, "roundId"));
  const result = z.enum(["PENDING", "SELECTED", "REJECTED", "ABSENT"]).safeParse(str(fd, "result"));
  const regs = fd.getAll("regs").map(String);
  if (!drive.success || !round.success) return { error: GENERIC_ERROR };
  if (!result.success) return { error: "Choose the result to apply." };
  if (regs.length === 0) return { error: "Tick at least one student." };
  if (!regs.every((r) => uuidSchema.safeParse(r).success)) return { error: GENERIC_ERROR };
  try {
    await withSession(s, (t) => sql`SELECT rounds.set_results(${round.data}::uuid, ARRAY[${sql.join(regs.map((r) => sql`${r}::uuid`))}]::uuid[], ${result.data}, ${str(fd, "note", 600) || null})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values: { note: str(fd, "note", 600) } };
  }
  refresh();
  back(drive.data, "results-saved");
}

export async function releaseRoundAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await officer();
  const drive = uuidSchema.safeParse(str(fd, "driveId")); const round = uuidSchema.safeParse(str(fd, "roundId"));
  if (!drive.success || !round.success) return { error: GENERIC_ERROR };
  if (str(fd, "confirm") !== "yes") return { error: "Tick the box to confirm that you want to release these results." };
  try { await withSession(s, (t) => sql`SELECT rounds.release_round(${round.data}::uuid)`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  refresh();
  back(drive.data, "released");
}
