import { sql } from "kysely";
import { config } from "../config";
import { db } from "../db";
import { clientIp } from "./request";
import { hmac } from "./tokens";

/** Fixed-window limiter backed by PostgreSQL (auth.rate_limit_check). Returns true when the call is allowed. */
export async function allow(scope: string, subject: string, max: number, windowSeconds: number): Promise<boolean> {
  const key = hmac(config().AUTH_PEPPER, `${scope}:${subject}`);
  const r = await sql<{ ok: boolean }>`SELECT auth.rate_limit_check(${key}, ${max}, ${windowSeconds}) AS ok`.execute(db());
  return r.rows[0]?.ok === true;
}

/** Per-IP limit, applied only when we know the real client IP (trusted proxy configured). */
export async function allowIp(scope: string, max: number, windowSeconds: number): Promise<boolean> {
  const ip = await clientIp();
  return ip ? allow(`ip:${scope}`, ip, max, windowSeconds) : true;
}
