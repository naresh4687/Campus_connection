import { sql } from "kysely";
import { contextOf, withSession, type SessionUser } from "./session";
import { withTenantTx } from "../db";
import { db } from "../db";

export type PendingRequest = { id: string; full_name: string; email: string; requester_role: string; department_code: string | null; requested_at: Date };
/** The requests this person may approve or decline (the database applies the hierarchy: coordinator/officer for students, college admin for staff, platform admin for college admins). */
export const pendingRequests = (s: SessionUser) => withSession(s, async (t) => (await sql<PendingRequest>`SELECT * FROM auth.pending_password_requests()`.execute(t)).rows);

export type MyRequest = { id: string; status: string; requested_at: Date; decided_by_name: string | null; expires_at: Date | null };
export const myPasswordRequest = (s: SessionUser) => withTenantTx(contextOf(s), async (t) => (await sql<MyRequest>`SELECT * FROM auth.my_password_request()`.execute(t)).rows[0] ?? null, db());
