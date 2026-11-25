"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { uuidSchema } from "@/lib/validation";
import { dbMessage, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { dummyHash, verifyPassword } from "../auth/password";
import { allow } from "../auth/rate-limit";
import { assertSameOrigin } from "../auth/request";
import { requireRole, withSession, type SessionUser } from "../auth/session";
import { db } from "../db";
import { removeErasedFiles } from "./files";

async function student() { await assertSameOrigin(); return requireRole("STUDENT"); }
async function admin() { await assertSameOrigin(); return requireRole("COLLEGE_ADMIN"); }

export async function requestErasureAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await student();
  if (!(await allow("erasure-request", s.userId, 5, 3600))) return { error: "Too many attempts. Please wait a while and try again." };
  const r = await sql<{ password_hash: string }>`SELECT password_hash FROM auth.get_login_user(${s.email})`.execute(db());
  if (!(await verifyPassword(r.rows[0]?.password_hash ?? (await dummyHash()), str(fd, "password", 128)))) return { error: "Your password is incorrect." };
  try { await withSession(s, (t) => sql`SELECT privacy.request_erasure()`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  revalidatePath("/student/privacy");
  return { ok: "Your request was sent to the college administrator." };
}

export async function cancelErasureAction(): Promise<ActionState> {
  const s = await student();
  try { await withSession(s, (t) => sql`SELECT privacy.cancel_erasure()`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  revalidatePath("/student/privacy");
  return { ok: "Your request was cancelled." };
}

const filesMessage = async (s: SessionUser, id: string) => {
  const left = await removeErasedFiles(s, id);
  revalidatePath("/college", "layout");
  return left ? { error: `The personal data was erased, but ${left} file${left === 1 ? "" : "s"} could not be removed from storage. Use “Retry file removal”.` } : { ok: "Erased: personal data and uploaded files were removed." };
};

export async function decideErasureAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const decision = str(fd, "decision", 8);
  if (!id.success || !["approve", "decline"].includes(decision)) return { error: GENERIC_ERROR };
  const approve = decision === "approve";
  if (approve && str(fd, "confirm", 10) !== "yes") return { error: "Tick the box to confirm. Erasing cannot be undone." };
  try { await withSession(s, (t) => sql`SELECT privacy.decide_erasure(${id.data}::uuid, ${approve}, ${str(fd, "reason", 600) || null})`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  if (!approve) { revalidatePath("/college", "layout"); return { ok: "Declined. The student was told why." }; }
  return filesMessage(s, id.data);
}

export async function retryErasureFilesAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const s = await admin();
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  return filesMessage(s, id.data);
}
