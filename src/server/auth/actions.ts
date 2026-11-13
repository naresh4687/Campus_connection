"use server";

import { sql } from "kysely";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, withTenantTx } from "../db";
import { contextOf, currentTokenHash, endSession, HOME_PATH, requireSession, startSession } from "./session";
import { allow, allowIp } from "./rate-limit";
import { assertSameOrigin, clientIpHash } from "./request";
import { dummyHash, hashPassword, newPasswordSchema, verifyPassword } from "./password";
import { hashToken, isWellFormedToken } from "./tokens";

/** `values` echoes back NON-secret fields so the form does not lose them after an error (passwords are never echoed). */
export type FormState = { error?: string; ok?: string; values?: Record<string, string> } | undefined;

const text = (v: FormDataEntryValue | null, max = 254) => (typeof v === "string" ? v.slice(0, max) : "");

const GENERIC_LOGIN_ERROR = "Invalid email or password.";
const RATE_ERROR = "Too many attempts. Please wait a few minutes and try again.";
const TOKEN_ERROR = "This link is invalid or has expired. Ask your administrator for a new one.";

const emailSchema = z.string().trim().toLowerCase().min(3).max(254).pipe(z.email());

async function logEvent(userId: string | null, action: string, meta: Record<string, unknown> = {}) {
  await sql`SELECT auth.log_auth_event(${userId}::uuid, ${action}, ${await clientIpHash()}, ${JSON.stringify(meta)}::jsonb)`.execute(db());
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await assertSameOrigin();
  const parsed = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const values = { email: text(formData.get("email")) };
  if (!parsed.success) return { error: GENERIC_LOGIN_ERROR, values };
  const { email, password } = parsed.data;

  if (!(await allow("login-email", email, 8, 15 * 60)) || !(await allowIp("login", 60, 15 * 60))) {
    await logEvent(null, "LOGIN_BLOCKED");
    return { error: RATE_ERROR, values };
  }

  const r = await sql<{
    id: string; password_hash: string; status: string; role: string; college_id: string | null; college_active: boolean;
  }>`SELECT * FROM auth.get_login_user(${email})`.execute(db());
  const user = r.rows[0];

  // Always run one Argon2 verification so timing does not reveal whether the account exists.
  const passwordOk = await verifyPassword(user?.password_hash ?? (await dummyHash()), password);
  if (!user || !passwordOk || user.status !== "ACTIVE" || !user.college_active) {
    await logEvent(user?.id ?? null, "LOGIN_FAILED");
    return { error: GENERIC_LOGIN_ERROR, values };
  }

  await startSession(user.id);
  await logEvent(user.id, "LOGIN_SUCCEEDED");
  redirect(HOME_PATH[user.role as keyof typeof HOME_PATH]);
}

export async function logoutAction(): Promise<void> {
  await assertSameOrigin();
  const s = await endSession();
  if (s) await logEvent(s.userId, "LOGOUT");
  redirect("/login");
}

const acceptSchema = z
  .object({
    token: z.string().refine(isWellFormedToken),
    fullName: z.string().trim().min(1, "Enter your name.").max(200),
    password: newPasswordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] });

export async function acceptInvitationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await assertSameOrigin();
  const values = { fullName: text(formData.get("fullName"), 200) };
  const parsed = acceptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? TOKEN_ERROR, values };
  const { token, fullName, password } = parsed.data;
  if (!(await allow("invite-token", token, 10, 15 * 60)) || !(await allowIp("invite", 60, 15 * 60))) return { error: RATE_ERROR, values };

  try {
    await sql`SELECT * FROM auth.accept_invitation(${hashToken(token)}, ${fullName}, ${await hashPassword(password)})`.execute(db());
  } catch (e) {
    if ((e as { code?: string }).code === "P0001") return { error: TOKEN_ERROR, values };
    if ((e as { code?: string }).code === "23505") return { error: "An account with this email already exists. Try signing in.", values };
    throw e;
  }
  await endSession();                       // never leave a different account signed in in this browser
  redirect("/login?welcome=1");
}

const resetSchema = z
  .object({
    token: z.string().refine(isWellFormedToken),
    password: newPasswordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] });

export async function completePasswordResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await assertSameOrigin();
  const parsed = resetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? TOKEN_ERROR };
  const { token, password } = parsed.data;
  if (!(await allow("reset-token", token, 10, 15 * 60)) || !(await allowIp("reset", 60, 15 * 60))) return { error: RATE_ERROR };

  try {
    await sql`SELECT auth.complete_password_reset(${hashToken(token)}, ${await hashPassword(password)})`.execute(db());
  } catch (e) {
    if ((e as { code?: string }).code === "P0001") return { error: TOKEN_ERROR };
    throw e;
  }
  await endSession();
  redirect("/login?reset=1");
}

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await assertSameOrigin();
  const s = await requireSession();
  const parsed = z
    .object({ current: z.string().min(1).max(128), password: newPasswordSchema, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  if (!(await allow("change-password", s.userId, 5, 15 * 60))) return { error: RATE_ERROR };

  const r = await sql<{ password_hash: string }>`SELECT password_hash FROM auth.get_login_user(${s.email})`.execute(db());
  if (!(await verifyPassword(r.rows[0]?.password_hash ?? (await dummyHash()), parsed.data.current))) {
    return { error: "Your current password is incorrect." };
  }
  const keep = await currentTokenHash();
  const newHash = await hashPassword(parsed.data.password);
  await withTenantTx(contextOf(s), (trx) => sql`SELECT auth.change_own_password(${newHash}, ${keep})`.execute(trx));
  return { ok: "Password changed. Your other sessions were signed out." };
}
