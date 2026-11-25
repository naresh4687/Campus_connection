import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { sql } from "kysely";
import { normalizeRecoveryCode } from "@/lib/totp";
import { config } from "../config";
import { db } from "../db";
import type { Role } from "../db/context";

/** Roles that must set up two-step sign-in before they can use the app. */
export const MFA_REQUIRED_ROLES: readonly Role[] = ["PLATFORM_SUPER_ADMIN", "COLLEGE_ADMIN"];

/** Two-step sign-in is built but switched off unless TWO_STEP_SIGN_IN=on. Off: nobody is asked to set it up or to enter a code. */
export const mfaSwitchedOn = () => process.env.TWO_STEP_SIGN_IN === "on";

/** The browser tests sign in many administrators without a phone; the same deliberately awkward values as the other test-only switches. */
const enforcementOff = () => process.env.AUTH_MFA_ENFORCEMENT === "off-e2e-test-server-only" && process.env.AUTH_ALLOW_INSECURE_COOKIES === "e2e-test-server-only";

export async function mfaSetupRequired(userId: string, role: Role): Promise<boolean> {
  if (!mfaSwitchedOn() || !MFA_REQUIRED_ROLES.includes(role) || enforcementOff()) return false;
  return !(await mfaEnabled(userId));
}

export async function mfaEnabled(userId: string): Promise<boolean> {
  if (!mfaSwitchedOn()) return false;
  const r = await sql<{ on: boolean }>`SELECT auth.mfa_enabled(${userId}::uuid) AS on`.execute(db());
  return r.rows[0]?.on === true;
}

// Secrets are stored encrypted (AES-256-GCM) under a key derived from AUTH_PEPPER, bound to the account they belong to.
// Changing AUTH_PEPPER therefore invalidates every enrolment (see DEPLOYMENT.md).
const key = () => Buffer.from(hkdfSync("sha256", config().AUTH_PEPPER, "campusconnect", "mfa-secret-v1", 32));

export function sealSecret(secret: string, userId: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv).setAAD(Buffer.from(userId));
  const body = Buffer.concat([c.update(secret, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

export function openSecret(sealed: string, userId: string): string {
  const raw = Buffer.from(sealed, "base64");
  const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12)).setAAD(Buffer.from(userId)).setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

export const recoveryHash = (code: string) => createHash("sha256").update(normalizeRecoveryCode(code)).digest();
