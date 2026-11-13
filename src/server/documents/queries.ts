import { sql } from "kysely";
import { PAGE_SIZE } from "@/components/ui/pagination";
import { withSession, type SessionUser } from "../auth/session";

// Reads run under RLS: a student sees their own documents (incl. deleted, as history); a coordinator only ACTIVE mark sheets /
// certificates / other documents of students in their current departments. The storage key column is not readable at all.
export type Doc = {
  id: string; student_id: string; kind: string; original_name: string; content_type: string; size_bytes: number; status: string; review_status: string;
  reviewed_by_name: string | null; reviewed_at: Date | null; review_reason: string | null; uploaded_at: Date; deleted_at: Date | null; scan_status: string;
};
const COLS = sql`d.id, d.student_id, d.kind, d.original_name, d.content_type, d.size_bytes, d.status, d.review_status, d.reviewed_by_name, d.reviewed_at, d.review_reason, d.uploaded_at, d.deleted_at, d.scan_status`;

export type DocEvent = { document_id: string; event: string; actor_name: string; actor_role: string; detail: string | null; occurred_at: Date };

async function withEvents(docs: Doc[], t: Parameters<Parameters<typeof withSession>[1]>[0]) {
  if (docs.length === 0) return { docs, events: new Map<string, DocEvent[]>() };
  const ids = docs.map((d) => d.id);
  const rows = (await sql<DocEvent>`SELECT document_id, event, actor_name, actor_role, detail, occurred_at FROM document_events WHERE document_id = ANY(ARRAY[${sql.join(ids.map((i) => sql`${i}::uuid`))}]::uuid[]) ORDER BY id`.execute(t)).rows;
  const events = new Map<string, DocEvent[]>();
  for (const r of rows) events.set(r.document_id, [...(events.get(r.document_id) ?? []), r]);
  return { docs, events };
}

export async function documentsFor(s: SessionUser, studentId?: string) {
  return withSession(s, async (t) => {
    const docs = (await (studentId
      ? sql<Doc>`SELECT ${COLS} FROM documents d WHERE d.student_id = ${studentId} ORDER BY d.uploaded_at DESC`
      : sql<Doc>`SELECT ${COLS} FROM documents d ORDER BY d.uploaded_at DESC`).execute(t)).rows;
    return withEvents(docs, t);
  });
}

export type PendingDoc = Doc & { student_name: string; register_number: string; dept_code: string };
export async function pendingDocuments(s: SessionUser, page: number) {
  return withSession(s, async (t) => {
    const total = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM documents d WHERE d.status = 'ACTIVE' AND d.review_status = 'PENDING'`.execute(t)).rows[0].n);
    const rows = (await sql<PendingDoc>`
      SELECT ${COLS}, st.full_name AS student_name, st.register_number::text AS register_number, dp.code::text AS dept_code
      FROM documents d JOIN students st ON st.id = d.student_id JOIN departments dp ON dp.id = st.department_id
      WHERE d.status = 'ACTIVE' AND d.review_status = 'PENDING' ORDER BY d.uploaded_at ASC, d.id LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`.execute(t)).rows;
    return { rows, total };
  });
}

/** Documents attached as evidence, keyed by submission id. */
export async function evidenceFor(s: SessionUser, submissionIds: string[]) {
  const out = new Map<string, { id: string; original_name: string; kind: string; review_status: string }[]>();
  if (submissionIds.length === 0) return out;
  return withSession(s, async (t) => {
    const rows = (await sql<{ submission_id: string; id: string; original_name: string; kind: string; review_status: string }>`
      SELECT l.submission_id, d.id, d.original_name, d.kind, d.review_status FROM academic_submission_documents l JOIN documents d ON d.id = l.document_id
      WHERE l.submission_id = ANY(ARRAY[${sql.join(submissionIds.map((i) => sql`${i}::uuid`))}]::uuid[]) ORDER BY d.uploaded_at`.execute(t)).rows;
    for (const r of rows) out.set(r.submission_id, [...(out.get(r.submission_id) ?? []), r]);
    return out;
  });
}

export async function evidenceChoices(s: SessionUser) {
  return withSession(s, async (t) => (await sql<{ id: string; original_name: string; kind: string; review_status: string }>`
    SELECT d.id, d.original_name, d.kind, d.review_status FROM documents d WHERE d.status = 'ACTIVE' AND d.kind IN ('MARKSHEET', 'CERTIFICATE') ORDER BY d.uploaded_at DESC`.execute(t)).rows);
}
