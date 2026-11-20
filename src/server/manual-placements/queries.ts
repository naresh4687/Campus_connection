import { sql } from "kysely";
import { withSession, type SessionUser } from "../auth/session";

export type CompanyChoice = { id: string; name: string; industry: string | null };
export const companyChoices = (s: SessionUser) => withSession(s, async (t) => (await sql<CompanyChoice>`SELECT * FROM placement.company_choices()`.execute(t)).rows);

export type ManualPlacement = { id: string; company_id: string; company_name: string; student_id: string; full_name: string; register_number: string; department_code: string; ctc_lpa: string; joined_on: Date | null; note: string | null; status: string; recorded_role: string; recorded_at: Date; review_note: string | null; offer_status: string };
export const manualPlacements = (s: SessionUser, company: string | null, onlyPending = false) =>
  withSession(s, async (t) => (await sql<ManualPlacement>`SELECT * FROM placement.manual_placements(${company}::uuid, ${onlyPending})`.execute(t)).rows);

export type PickableStudent = { id: string; full_name: string; register_number: string; department_code: string; passing_year: number; offers: number; accepted_company: string | null };
/** The students the caller may record (an officer: everyone; a coordinator: their departments), with each one's offer count and accepted company. */
export const recordableStudents = (s: SessionUser) => withSession(s, async (t) => (await sql<PickableStudent>`SELECT * FROM placement.recordable_students()`.execute(t)).rows);
