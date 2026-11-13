import { sql } from "kysely";
import { withSession, type SessionUser } from "../auth/session";

export type RoundRow = { id: string; round_number: number; name: string; kind: string; scheduled_at: Date | null; venue: string | null; instructions: string | null; released_at: Date | null };
export type RosterRow = { registration_id: string; student_id: string; full_name: string; register_number: string; department_code: string; result: string };

const COLS = sql`id, round_number, name, kind, scheduled_at, venue, instructions, released_at`;

/** Staff: every round of the drive with its candidates and their current decision. */
export async function roundsWithRoster(s: SessionUser, driveId: string) {
  return withSession(s, async (t) => {
    const rounds = (await sql<RoundRow>`SELECT ${COLS} FROM drive_rounds WHERE drive_id = ${driveId} ORDER BY round_number`.execute(t)).rows;
    const out: (RoundRow & { roster: RosterRow[] })[] = [];
    for (const r of rounds) out.push({ ...r, roster: (await sql<RosterRow>`SELECT * FROM rounds.roster(${r.id}::uuid)`.execute(t)).rows });
    return out;
  });
}

/** Staff: the history of decisions for the drive (remarks included — never shown to students). */
export async function resultHistory(s: SessionUser, driveId: string) {
  return withSession(s, async (t) => (await sql<{ round_number: number; full_name: string; from_result: string | null; to_result: string; note: string | null; actor_name: string; occurred_at: Date }>`SELECT * FROM rounds.history(${driveId}::uuid)`.execute(t)).rows);
}

/** Student: the drive's rounds (schedule) with the student's own result — present only once the round is released (RLS). */
export async function myRounds(s: SessionUser, driveId: string) {
  return withSession(s, async (t) => (await sql<RoundRow & { result: string | null }>`
    SELECT dr.id, dr.round_number, dr.name, dr.kind, dr.scheduled_at, dr.venue, dr.instructions, dr.released_at, rr.result
      FROM drive_rounds dr LEFT JOIN round_results rr ON rr.round_id = dr.id WHERE dr.drive_id = ${driveId} ORDER BY dr.round_number`.execute(t)).rows);
}

export async function roundSummary(s: SessionUser, driveId: string) {
  return withSession(s, async (t) => (await sql<{ round_number: number; name: string; released_at: Date | null }>`SELECT round_number, name, released_at FROM drive_rounds WHERE drive_id = ${driveId} ORDER BY round_number`.execute(t)).rows);
}
