"use server";

import { sql } from "kysely";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { normalizeEmail } from "@/lib/normalize";
import { uuidSchema } from "@/lib/validation";
import { dbMessage, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { db, withTenantTx } from "../db";
import { allow } from "./rate-limit";
import { assertSameOrigin } from "./request";
import { contextOf, currentTokenHash, requireSession } from "./session";
import { dummyHash, hashPassword, newPasswordSchema, verifyPassword } from "./password";

const RATE = "Too many attempts. Please wait a few minutes and try again.";

/** Asks the people above you to approve a password change. Nothing changes until one of them approves; you then choose the new password yourself. */
export async function requestPasswordChangeAction(): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireSession();
  if (!(await allow("password-request", s.userId, 5, 3600))) return { error: RATE };
  try { await withTenantTx(contextOf(s), (t) => sql`SELECT auth.request_password_change()`.execute(t), db()); } catch (e) { return { error: dbMessage(e) }; }
  revalidatePath("/account");
  return { ok: "Your request was sent. You will be notified when it is approved." };
}

export async function decidePasswordRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireSession();
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  const approve = fd.get("decision") === "approve";
  try { await withTenantTx(contextOf(s), (t) => sql`SELECT auth.decide_password_request(${id.data}::uuid, ${approve})`.execute(t), db()); } catch (e) { return { error: dbMessage(e) }; }
  revalidatePath("/account/password-requests");
  redirect(`/account/password-requests?decided=${approve ? "approve" : "decline"}`);          // the row leaves the list, so the confirmation is shown by the reloaded page
}

/** The page an approval notification opens: new password twice, no current password (a person above you approved it). One use, within 24 hours. */
export async function completePasswordRequestAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireSession();
  const id = uuidSchema.safeParse(str(fd, "id"));
  const parsed = z.object({ password: newPasswordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] }).safeParse(Object.fromEntries(fd));
  if (!id.success || !parsed.success) return { error: parsed.success ? GENERIC_ERROR : parsed.error.issues[0]?.message ?? "Check the form and try again." };
  if (!(await allow("password-complete", s.userId, 5, 15 * 60))) return { error: RATE };
  const keep = await currentTokenHash();
  const hash = await hashPassword(parsed.data.password);
  try { await withTenantTx(contextOf(s), (t) => sql`SELECT auth.complete_password_request(${id.data}::uuid, ${hash}, ${keep})`.execute(t), db()); } catch (e) { return { error: dbMessage(e) }; }
  redirect("/account?notice=password-changed");
}

/** Own name and sign-in email. The current password is required, because the email is how you sign in. */
export async function updateProfileAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireSession();
  const name = str(fd, "name", 140).trim(); const email = normalizeEmail(str(fd, "email", 260)) ?? "";
  if (!(await allow("profile-update", s.userId, 8, 15 * 60))) return { error: RATE, values: { name, email } };
  const r = await sql<{ password_hash: string }>`SELECT password_hash FROM auth.get_login_user(${s.email})`.execute(db());
  if (!(await verifyPassword(r.rows[0]?.password_hash ?? (await dummyHash()), str(fd, "current", 128)))) return { error: "Your current password is incorrect.", values: { name, email } };
  try { await withTenantTx(contextOf(s), (t) => sql`SELECT auth.update_own_profile(${name}, ${email}::citext)`.execute(t), db()); } catch (e) { return { error: dbMessage(e), values: { name, email } }; }
  revalidatePath("/account");
  return { ok: "Saved. Use the new email the next time you sign in.", values: { name, email } };
}
