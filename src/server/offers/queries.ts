import { sql } from "kysely";
import { withSession, type SessionUser } from "../auth/session";

export type Candidate = { registration_id: string; student_id: string; full_name: string; register_number: string; department_code: string };
export type OfferRow = {
  selection_id: string; student_id: string; full_name: string; register_number: string; department_code: string; offer_status: string; offered_ctc_lpa: string | null;
  response_deadline: Date | null; issued_at: Date | null; responded_at: Date | null; withdrawal_reason: string | null; letter_file_id: string | null; placement_status: string | null;
};
export type PlacementRow = {
  selection_id: string; drive_id: string; job_title: string; company_name: string; student_id: string; full_name: string; register_number: string; department_code: string; status: string;
  joined_on: string; designation: string | null; note: string | null; evidence_file_id: string; recorded_at: Date; decided_by_name: string | null; decided_at: Date | null; decision_reason: string | null; overridden: boolean;
};
export type Funnel = { selected: number; offers_issued: number; offers_accepted: number; joining_recorded: number; placements_verified: number };

export const selectCandidates = (s: SessionUser, drive: string) => withSession(s, async (t) => (await sql<Candidate>`SELECT * FROM offers.select_candidates(${drive}::uuid)`.execute(t)).rows);
export const offersForDrive = (s: SessionUser, drive: string) => withSession(s, async (t) => (await sql<OfferRow>`SELECT * FROM offers.list_for_drive(${drive}::uuid)`.execute(t)).rows);
export const listPlacements = (s: SessionUser, status: string | null) => withSession(s, async (t) => (await sql<PlacementRow>`SELECT * FROM offers.list_placements(${status})`.execute(t)).rows);
export const funnel = (s: SessionUser) => withSession(s, async (t) => (await sql<Funnel>`SELECT * FROM offers.funnel()`.execute(t)).rows[0]);

export type MyOffer = { id: string; job_title: string; company_name: string; offer_status: string; offered_ctc_lpa: string | null; response_deadline: Date | null; issued_at: Date | null; responded_at: Date | null; withdrawal_reason: string | null; placement_status: string | null };
const MY_COLS = sql`s.id, d.job_title, d.company_name, s.offer_status, s.offered_ctc_lpa::text AS offered_ctc_lpa, s.response_deadline, s.issued_at, s.responded_at, s.withdrawal_reason, pl.status AS placement_status`;

/** The signed-in student's own selections (RLS limits this to their rows). */
export const myOffers = (s: SessionUser) => withSession(s, async (t) => (await sql<MyOffer>`SELECT ${MY_COLS} FROM selections s JOIN drives d ON d.id = s.drive_id LEFT JOIN placements pl ON pl.selection_id = s.id ORDER BY s.selected_at DESC`.execute(t)).rows);

export async function myOffer(s: SessionUser, id: string) {
  return withSession(s, async (t) => {
    const offer = (await sql<MyOffer>`SELECT ${MY_COLS} FROM selections s JOIN drives d ON d.id = s.drive_id LEFT JOIN placements pl ON pl.selection_id = s.id WHERE s.id = ${id}`.execute(t)).rows[0];
    if (!offer) return null;
    const files = (await sql<{ id: string; kind: string; original_name: string; uploaded_at: Date }>`SELECT id, kind, original_name, uploaded_at FROM selection_files WHERE selection_id = ${id} ORDER BY uploaded_at DESC`.execute(t)).rows;
    const placement = (await sql<{ status: string; joined_on: string; designation: string | null; decision_reason: string | null; decided_at: Date | null }>`SELECT status, joined_on::text AS joined_on, designation, decision_reason, decided_at FROM placements WHERE selection_id = ${id}`.execute(t)).rows[0] ?? null;
    return { offer, files, placement };
  });
}

/** Selections that still have no offer issued (officer follow-up). */
export async function unissuedCount(s: SessionUser) {
  return withSession(s, async (t) => Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM selections WHERE offer_status = 'NOT_ISSUED'`.execute(t)).rows[0].n));
}
