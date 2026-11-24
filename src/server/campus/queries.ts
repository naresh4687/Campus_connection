import { sql } from "kysely";
import type { SessionUser } from "../auth/session";
import { withSession } from "../auth/session";
import type { CampusRoundStat } from "@/lib/campus";

export type CampusEventRow = {
  id: string; title: string; company_name: string; drive_id: string | null; event_at: Date; venue: string | null; status: string; rounds: number; present_first: number; open_rounds: number;
};
export const listCampusEvents = (s: SessionUser) => withSession(s, async (t) => (await sql<CampusEventRow>`
  SELECT e.id, e.title, e.company_name, e.drive_id, e.event_at, e.venue, e.status,
         (SELECT count(*)::int FROM campus_rounds r WHERE r.event_id = e.id) AS rounds,
         (SELECT count(*)::int FROM campus_attendance a JOIN campus_rounds r ON r.id = a.round_id WHERE r.event_id = e.id AND r.round_number = 1) AS present_first,
         (SELECT count(*)::int FROM campus_rounds r WHERE r.event_id = e.id AND r.status = 'OPEN') AS open_rounds
    FROM campus_events e ORDER BY (e.status = 'UPCOMING') DESC, e.event_at DESC LIMIT 200`.execute(t)).rows);

export type CampusEvent = { id: string; title: string; company_name: string; drive_id: string | null; drive_title: string | null; details: string | null; venue: string | null; event_at: Date; status: string; department_codes: string[]; passing_years: number[] };
export type CampusRound = { id: string; round_number: number; name: string; scheduled_at: Date | null; token: string; status: string; opened_at: Date | null; closed_at: Date | null };
export async function getCampusEvent(s: SessionUser, id: string) {
  return withSession(s, async (t) => {
    const event = (await sql<CampusEvent>`
      SELECT e.id, e.title, e.company_name, e.drive_id, d.job_title AS drive_title, e.details, e.venue, e.event_at, e.status, e.passing_years,
             coalesce((SELECT array_agg(dp.code::text ORDER BY dp.code) FROM departments dp WHERE dp.id = ANY (e.department_ids)), '{}') AS department_codes
        FROM campus_events e LEFT JOIN drives d ON d.id = e.drive_id WHERE e.id = ${id}::uuid`.execute(t)).rows[0];
    if (!event) return null;
    const rounds = (await sql<CampusRound>`SELECT id, round_number, name, scheduled_at, token, status, opened_at, closed_at FROM campus_rounds WHERE event_id = ${id}::uuid ORDER BY round_number`.execute(t)).rows;
    const stats = (await sql<CampusRoundStat>`SELECT * FROM campus.round_stats(${id}::uuid)`.execute(t)).rows;
    return { event, rounds, stats };
  });
}

export type RosterRow = { student_id: string; full_name: string; register_number: string; department_code: string; passing_year: number; marked_at: Date; method: string; advanced: boolean };
export const roundRoster = (s: SessionUser, roundId: string) => withSession(s, async (t) => (await sql<RosterRow>`SELECT * FROM campus.round_roster(${roundId}::uuid)`.execute(t)).rows);
export type MissingRow = { student_id: string; full_name: string; register_number: string; department_code: string; passing_year: number };
export const roundMissing = (s: SessionUser, roundId: string, q: string | null) => withSession(s, async (t) => (await sql<MissingRow>`SELECT * FROM campus.round_missing(${roundId}::uuid, ${q})`.execute(t)).rows);

export type PostedDrive = { id: string; company_name: string; job_title: string; status: string };
export const postedDrives = (s: SessionUser) => withSession(s, async (t) => (await sql<PostedDrive>`
  SELECT id, company_name, job_title, status FROM drives WHERE status IN ('PUBLISHED', 'CLOSED') ORDER BY created_at DESC LIMIT 100`.execute(t)).rows);

// ───────────── student ─────────────
export type MyCampusRow = {
  event_id: string; title: string; company_name: string; event_at: Date; venue: string | null; details: string | null; event_status: string;
  round_id: string; round_number: number; round_name: string; round_status: string; scheduled_at: Date | null; eligible: boolean; present: boolean; advanced: boolean; token: string | null;
};
export const myCampusEvents = (s: SessionUser) => withSession(s, async (t) => (await sql<MyCampusRow>`SELECT * FROM campus.my_events()`.execute(t)).rows);

export type TokenPeek = { event_id: string; title: string; company_name: string; event_at: Date; venue: string | null; round_number: number; round_name: string; round_status: string; eligible: boolean; present: boolean };
export const peekCampusToken = (s: SessionUser, token: string) => withSession(s, async (t) => (await sql<TokenPeek>`SELECT * FROM campus.peek_token(${token})`.execute(t)).rows[0] ?? null);
