"use server";

import { sql } from "kysely";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { matchTotp, newRecoveryCodes, newTotpSecret } from "@/lib/totp";
import { uuidSchema } from "@/lib/validation";
import { revalidatePath } from "next/cache";
import { slotOfRole } from "@/lib/portals";
import { dbMessage, GENERIC_ERROR, str, type ActionState } from "../action-utils";
import { db } from "../db";
import { openSecret, recoveryHash, sealSecret } from "./mfa";
import { dummyHash, verifyPassword } from "./password";
import { allow, allowIp } from "./rate-limit";
import { assertSameOrigin, clientIpHash } from "./request";
import { currentTokenHash, HOME_PATH, requireAccountSession, requireRole, startSession, withSession } from "./session";
import { hashToken, isWellFormedToken } from "./tokens";
import { mfaCookieName } from "./mfa-cookie";
import type { Role } from "../db/context";

const RATE = "Too many attempts. Please wait a few minutes and try again.";
const WRONG = "That code is not right. Check the time on your phone and try the newest code.";

export type MfaState = ({ error?: string; ok?: string; codes?: string[] }) | undefined;

/** The second sign-in step. The password step left a short-lived challenge cookie; nothing else identifies the account here. */
export async function verifyMfaAction(_p: MfaState, fd: FormData): Promise<MfaState> {
  await assertSameOrigin();
  const jar = await cookies();
  const token = jar.get(mfaCookieName())?.value;
  const code = str(fd, "code", 40).trim();
  if (!isWellFormedToken(token)) redirect("/login");
  if (!(await allowIp("mfa", 60, 15 * 60))) return { error: RATE };
  const row = (await sql<{ user_id: string; role: Role; secret_enc: string; last_step: string }>`SELECT * FROM auth.mfa_try_challenge(${hashToken(token)})`.execute(db())).rows[0];
  if (!row) return { error: "This sign-in attempt has expired. Go back and sign in again." };
  // Counted per account too, so starting new attempts does not give unlimited guesses.
  if (!(await allow("mfa-account", row.user_id, 10, 15 * 60))) return { error: RATE };

  const totp = /^\d[\d\s]*$/.test(code);
  const step = totp ? matchTotp(openSecret(row.secret_enc, row.user_id), code, Date.now(), Number(row.last_step)) : null;
  const done = totp && step === null ? false
    : (await sql<{ ok: boolean }>`SELECT auth.mfa_finish_challenge(${hashToken(token)}, ${step}::bigint, ${totp ? null : recoveryHash(code)}::bytea) AS ok`.execute(db())).rows[0]?.ok === true;
  const slot = slotOfRole(row.role);
  if (!done || !slot) {
    await sql`SELECT auth.log_auth_event(${row.user_id}::uuid, 'LOGIN_FAILED', ${await clientIpHash()}, '{"reason":"second_step"}'::jsonb)`.execute(db());
    return { error: totp ? WRONG : "That recovery code is not valid, or was already used." };
  }
  jar.delete(mfaCookieName());
  await startSession(row.user_id, slot);
  await sql`SELECT auth.log_auth_event(${row.user_id}::uuid, 'LOGIN_SUCCEEDED', ${await clientIpHash()}, '{"second_step":true}'::jsonb)`.execute(db());
  redirect(HOME_PATH[row.role]);
}

async function passwordOk(email: string, given: string) {
  const r = await sql<{ password_hash: string }>`SELECT password_hash FROM auth.get_login_user(${email})`.execute(db());
  return verifyPassword(r.rows[0]?.password_hash ?? (await dummyHash()), given);
}

/** Makes a new secret to scan. The password is asked for, so a borrowed open session cannot enrol someone else's phone. */
export async function startMfaSetupAction(_p: MfaState, fd: FormData): Promise<MfaState> {
  await assertSameOrigin();
  const s = await requireAccountSession();
  if (!(await allow("mfa-setup", s.userId, 8, 15 * 60))) return { error: RATE };
  if (!(await passwordOk(s.email, str(fd, "password", 128)))) return { error: "Your password is incorrect." };
  try { await withSession(s, (t) => sql`SELECT auth.mfa_start_setup(${sealSecret(newTotpSecret(), s.userId)})`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  revalidatePath("/security");
  return undefined;
}

/** Confirms the phone works, switches the second step on and shows the recovery codes once. */
export async function confirmMfaSetupAction(_p: MfaState, fd: FormData): Promise<MfaState> {
  await assertSameOrigin();
  const s = await requireAccountSession();
  if (!(await allow("mfa-confirm", s.userId, 10, 15 * 60))) return { error: RATE };
  const st = await withSession(s, async (t) => (await sql<{ pending_enc: string | null }>`SELECT pending_enc FROM auth.mfa_my_status()`.execute(t)).rows[0]);
  if (!st?.pending_enc) return { error: "Start the setup again." };
  const step = matchTotp(openSecret(st.pending_enc, s.userId), str(fd, "code", 20));
  if (step === null) return { error: WRONG };
  const codes = newRecoveryCodes();
  const hashes = codes.map((c) => recoveryHash(c).toString("hex"));
  const keep = await currentTokenHash(s);
  try { await withSession(s, (t) => sql`SELECT auth.mfa_confirm_setup(${step}::bigint, ARRAY(SELECT decode(h, 'hex') FROM unnest(${hashes}::text[]) AS h), ${keep})`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  return { ok: "Two-step sign-in is on.", codes };
}

export async function disableMfaAction(_p: MfaState, fd: FormData): Promise<MfaState> {
  await assertSameOrigin();
  const s = await requireAccountSession();
  if (!(await allow("mfa-disable", s.userId, 5, 15 * 60))) return { error: RATE };
  if (!(await passwordOk(s.email, str(fd, "password", 128)))) return { error: "Your password is incorrect." };
  try { await withSession(s, (t) => sql`SELECT auth.mfa_disable()`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  revalidatePath("/security");
  return { ok: "Two-step sign-in is off." };
}

/** For someone who lost their phone. The database decides who may reset whom. */
export async function resetMfaAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await assertSameOrigin();
  const s = await requireRole("COLLEGE_ADMIN", "PLATFORM_SUPER_ADMIN");
  const id = uuidSchema.safeParse(str(fd, "id"));
  if (!id.success) return { error: GENERIC_ERROR };
  try { await withSession(s, (t) => sql`SELECT auth.mfa_admin_reset(${id.data}::uuid)`.execute(t)); } catch (e) { return { error: dbMessage(e) }; }
  revalidatePath(s.role === "COLLEGE_ADMIN" ? "/college" : "/platform", "layout");
  return { ok: "Two-step sign-in was removed and they were signed out. They can sign in with their password." };
}
