import { sql } from "kysely";
import { mfaSwitchedOn } from "./mfa";
import { withSession, type SessionUser } from "./session";

/** Whether the signed-in administrator may remove this account's two-step sign-in (it has it on, and the database allows them). */
export const canResetMfa = (s: SessionUser, userId: string) =>
  mfaSwitchedOn()
    ? withSession(s, async (t) => (await sql<{ ok: boolean }>`SELECT auth.mfa_can_reset(${userId}::uuid) AS ok`.execute(t)).rows[0]?.ok === true)
    : Promise.resolve(false);
