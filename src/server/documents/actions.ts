"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { reasonSchema, uuidSchema } from "@/lib/validation";
import { dbMessage, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession } from "../auth/session";
import { deleteObject } from "../storage/s3";

const refresh = () => { revalidatePath("/student", "layout"); revalidatePath("/coordinator", "layout"); };

/** Deletes a document the student owns. The database refuses evidence attached to an academic submission. */
export async function deleteDocumentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("STUDENT");
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  let key: string;
  try {
    key = await withSession(s, async (t) => (await sql<{ key: string }>`SELECT documents.delete_document(${id.data}::uuid) AS key`.execute(t)).rows[0].key);
  } catch (e) {
    return { error: dbMessage(e) };
  }
  // The record is already DELETED (no one can download it). Now remove the bytes; if that fails the object is orphaned, not exposed.
  try {
    await deleteObject(key);
    await withSession(s, (t) => sql`SELECT documents.mark_purged(${id.data}::uuid)`.execute(t));
  } catch (e) {
    console.error("document object removal failed:", (e as Error).message);
  }
  refresh();
  return { ok: "Document deleted." };
}

export async function reviewDocumentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("COORDINATOR");
  const id = uuidSchema.safeParse(str(fd, "id"));
  const decision = str(fd, "decision", 12);
  if (!id.success || !["VERIFIED", "REJECTED"].includes(decision)) return { error: GENERIC_ERROR };
  let reason: string | null = null;
  if (decision === "REJECTED") {
    const r = reasonSchema.safeParse(str(fd, "reason", 600));
    if (!r.success) return { error: r.error.issues[0].message, values: { reason: str(fd, "reason", 600) } };
    if (r.data.length > 500) return { error: "Keep the reason under 500 characters.", values: { reason: r.data } };
    reason = r.data;
  }
  try {
    await withSession(s, (t) => sql`SELECT documents.review(${id.data}::uuid, ${decision}, ${reason})`.execute(t));
  } catch (e) {
    return { error: dbMessage(e), values: { reason: reason ?? "" } };
  }
  refresh();
  // On the pending-documents list a reviewed item disappears, so return there with a banner (allow-listed path only: no open redirect).
  if (str(fd, "backTo", 60) === "/coordinator/documents") redirect(`/coordinator/documents?notice=${decision === "VERIFIED" ? "verified" : "rejected"}`);
  return { ok: decision === "VERIFIED" ? "Document verified." : "Document rejected. The student can see your reason." };
}
