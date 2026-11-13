import { createHmac, timingSafeEqual } from "node:crypto";
import { appBaseUrl } from "../auth/links";
import { config } from "../config";

// The student sign-up link is a signed value: <collegeId>.<version>.<signature>. Nothing secret is stored; the database keeps the on/off switch and the version,
// so rotating the version makes every older link useless. The link can only ever ask for an account (a person must still approve it).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sign = (college: string, version: number) => createHmac("sha256", config().AUTH_PEPPER).update(`join|${college}|${version}`).digest("base64url").slice(0, 32);

export const joinToken = (college: string, version: number) => `${college}.${version}.${sign(college, version)}`;
export const joinLink = async (college: string, version: number) => `${await appBaseUrl()}/join/${joinToken(college, version)}`;

export function parseJoinToken(token: string | undefined): { college: string; version: number } | null {
  const m = /^([0-9a-f-]{36})\.(\d{1,6})\.([A-Za-z0-9_-]{32})$/.exec(token ?? "");
  if (!m || !UUID.test(m[1])) return null;
  const version = Number(m[2]);
  const a = Buffer.from(m[3]); const b = Buffer.from(sign(m[1], version));
  return a.length === b.length && timingSafeEqual(a, b) ? { college: m[1], version } : null;
}
