import { sql } from "kysely";
import type { AnnouncementExtraction } from "@/lib/composer/extract";
import { withSession, type SessionUser } from "../auth/session";

export type AnnouncementRow = {
  id: string; kind: string; title: string; company_name: string | null; drive_id: string | null; status: string; version: number; priority: string; display_mode: string;
  event_date: string | null; expires_at: Date | null; published_at: Date | null; updated_at: Date; created_by_role: string;
};
export type AnnouncementFull = AnnouncementRow & {
  original_message: string | null; summary: string | null; event_time: string | null; venue: string | null; instructions: string | null; consent_deadline: Date | null; action_link: string | null;
  stages: string[]; batches: { name: string; venue: string; note: string | null }[];
};
const LIST = sql`id, kind, title, company_name, drive_id, status, version, priority, display_mode, event_date::text AS event_date, expires_at, published_at, updated_at, created_by_role`;
const FULL = sql`${LIST}, original_message, summary, event_time, venue, instructions, consent_deadline, action_link, stages, batches`;

/** Staff: what the caller may see (an officer and the administrator: all; a coordinator: their own). RLS decides; there is no filter here on purpose. */
export const listAnnouncements = (s: SessionUser) => withSession(s, async (t) => (await sql<AnnouncementRow>`SELECT ${LIST} FROM announcements ORDER BY updated_at DESC, id LIMIT 200`.execute(t)).rows);

export type Version = { version: number; reason: string | null; edited_by_name: string; edited_at: Date; recipients_count: number; renotified: boolean; snapshot: Record<string, unknown> };
export type Audience = { source: string; departments: string[]; years: number[]; career?: string; drive?: string; students?: string[]; named_confirmed?: boolean };
export type NamedStudent = { register_number: string; student_id: string; full_name: string; department_code: string; has_account: boolean };

export async function getAnnouncementForStaff(s: SessionUser, id: string) {
  return withSession(s, async (t) => {
    const a = (await sql<AnnouncementFull>`SELECT ${FULL} FROM announcements WHERE id = ${id}::uuid`.execute(t)).rows[0];
    if (!a) return null;
    const audience = (await sql<{ audience: Audience }>`SELECT audience FROM announcement_audiences WHERE announcement_id = ${id}::uuid`.execute(t)).rows[0]?.audience ?? null;
    const versions = (await sql<Version>`SELECT version, reason, edited_by_name, edited_at, recipients_count, renotified, snapshot FROM announcement_versions WHERE announcement_id = ${id}::uuid ORDER BY version DESC`.execute(t)).rows;
    const engagement = (await sql<{ recipients: number; seen: number }>`SELECT recipients, seen FROM announcements.engagement(${id}::uuid)`.execute(t)).rows[0] ?? null;
    const named = audience?.source === "NAMED" ? (await sql<NamedStudent>`SELECT * FROM announcements.named_students(${id}::uuid)`.execute(t)).rows : [];
    let reach: { total: number; with_account: number } | null = null;
    if (audience) { try { reach = (await sql<{ total: number; with_account: number }>`SELECT total, with_account FROM announcements.audience_count(${JSON.stringify(audience)}::jsonb)`.execute(t)).rows[0] ?? null; } catch { reach = null; } }
    return { a, audience, versions, engagement, named, reach };
  });
}

export const linkableDrives = (s: SessionUser) => withSession(s, async (t) => (await sql<{ id: string; company_name: string; job_title: string; status: string }>`SELECT * FROM announcements.linkable_drives()`.execute(t)).rows);
/** The departments the caller can address: an officer all active ones; a coordinator only those they are assigned to (RLS). */
export const addressableDepartments = (s: SessionUser) => withSession(s, async (t) => (await sql<{ id: string; code: string; name: string }>`SELECT id, code::text AS code, name::text AS name FROM departments WHERE status = 'ACTIVE' ORDER BY code`.execute(t)).rows);
export const matchStudents = (s: SessionUser, numbers: string[]) => withSession(s, async (t) => (await sql<NamedStudent>`SELECT * FROM announcements.match_students(${numbers}::text[])`.execute(t)).rows);

export type StudentAnnouncement = AnnouncementRow & { seen_at: Date | null; notified_at: Date };
export const myAnnouncements = (s: SessionUser) => withSession(s, async (t) => (await sql<StudentAnnouncement>`
  SELECT a.id, a.kind, a.title, a.company_name, a.drive_id, a.status, a.version, a.priority, a.display_mode, a.event_date::text AS event_date, a.expires_at, a.published_at, a.updated_at, a.created_by_role, r.seen_at, r.notified_at
    FROM announcements a JOIN announcement_recipients r ON r.announcement_id = a.id ORDER BY a.updated_at DESC, a.id LIMIT 200`.execute(t)).rows);
export const myAnnouncement = (s: SessionUser, id: string) => withSession(s, async (t) => (await sql<AnnouncementFull & { seen_at: Date | null }>`
  SELECT a.id, a.kind, a.title, a.company_name, a.drive_id, a.status, a.version, a.priority, a.display_mode, a.event_date::text AS event_date, a.expires_at, a.published_at, a.updated_at, a.created_by_role,
         a.original_message, a.summary, a.event_time, a.venue, a.instructions, a.consent_deadline, a.action_link, a.stages, a.batches, r.seen_at
    FROM announcements a JOIN announcement_recipients r ON r.announcement_id = a.id WHERE a.id = ${id}::uuid`.execute(t)).rows[0] ?? null);
export const markSeen = (s: SessionUser, id: string) => withSession(s, (t) => sql`SELECT announcements.mark_seen(${id}::uuid)`.execute(t));

/** What the reader found when this draft was made (staff only; RLS keeps it away from students and other colleges). */
export async function getExtraction(s: SessionUser, id: string): Promise<{ extraction: AnnouncementExtraction; method: string; version: string } | null> {
  return withSession(s, async (t) => {
    const r = (await sql<{ extraction: AnnouncementExtraction; method: string; version: string }>`SELECT extraction, method, version FROM announcement_extractions WHERE announcement_id = ${id}::uuid`.execute(t)).rows[0];
    return r ?? null;
  });
}
