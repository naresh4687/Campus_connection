import { sql } from "kysely";
import { withSession, type SessionUser } from "../auth/session";

export type MyErasure = { status: "PENDING" | "CANCELLED" | "DECLINED" | "ERASED"; requested_at: Date; decided_at: Date | null; decision_reason: string | null };
export const myErasure = (s: SessionUser) => withSession(s, async (t) =>
  (await sql<MyErasure>`SELECT status, requested_at, decided_at, decision_reason FROM erasure_requests ORDER BY requested_at DESC LIMIT 1`.execute(t)).rows[0] ?? null);

export type ErasureRow = { id: string; status: "PENDING" | "DECLINED" | "ERASED"; requested_at: Date; decided_at: Date | null; decided_by_name: string | null; full_name: string; register_number: string; files_left: number };
export const erasureList = (s: SessionUser) => withSession(s, async (t) => (await sql<ErasureRow>`SELECT * FROM privacy.erasure_list()`.execute(t)).rows);
