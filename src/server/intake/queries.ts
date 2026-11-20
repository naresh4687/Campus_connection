import { sql } from "kysely";
import { fieldsSchema, type Fields, type Warning, warningsSchema } from "@/lib/intake/catalog";
import { findDuplicates, type Duplicate } from "@/lib/intake/duplicates";
import { uuidSchema } from "@/lib/validation";
import { withSession, type SessionUser } from "../auth/session";

export type IntakeRecord = {
  id: string; status: string; error_note: string | null; source_text: string; source_type: string; submitted_at: Date; provider: string | null; model_id: string | null; extraction_version: string | null;
  fields: Fields; warnings: Warning[]; pending: { fields: Fields; warnings: Warning[]; provider: string; model: string } | null; drive_id: string | null; drive_status: string | null; source_hash: string;
};

export async function getIntake(s: SessionUser, id: string): Promise<IntakeRecord | null> {
  if (!uuidSchema.safeParse(id).success) return null;
  return withSession(s, async (t) => {
    const r = (await sql<{ id: string; status: string; error_note: string | null; source_text: string; source_type: string; submitted_at: Date; provider: string | null; model_id: string | null; extraction_version: string | null; fields: unknown; extraction: { warnings?: unknown } | null; pending: unknown; drive_id: string | null; drive_status: string | null; source_hash: string }>`
      SELECT i.id, i.status, i.error_note, i.source_text, i.source_type, i.submitted_at, i.provider, i.model_id, i.extraction_version, i.fields, i.extraction, i.pending, i.drive_id, d.status AS drive_status, i.source_hash
        FROM drive_intakes i LEFT JOIN drives d ON d.id = i.drive_id WHERE i.id = ${id}`.execute(t)).rows[0];
    if (!r) return null;
    const fields = fieldsSchema.safeParse(r.fields); const warnings = warningsSchema.safeParse(r.extraction?.warnings ?? []);
    const pend = r.pending as { fields?: unknown; warnings?: unknown; provider?: string; model?: string } | null;
    const pf = pend ? fieldsSchema.safeParse(pend.fields) : null;
    return { ...r, fields: fields.success ? fields.data : {}, warnings: warnings.success ? warnings.data : [],
      pending: pend && pf?.success ? { fields: pf.data, warnings: warningsSchema.safeParse(pend.warnings ?? []).data ?? [], provider: pend.provider ?? "", model: pend.model ?? "" } : null };
  });
}

/** Possible duplicates among this college's drives and earlier announcements (RLS keeps this to the officer's own college). */
export async function duplicatesFor(s: SessionUser, input: { company?: string | null; title?: string | null; years?: number[]; sourceHash: string; sourceText: string; selfIntake?: string; selfDrive?: string | null }): Promise<Duplicate[]> {
  return withSession(s, async (t) => {
    const drives = (await sql<{ id: string; company_name: string; job_title: string; status: string; years: number[]; application_deadline: Date | null }>`
      SELECT d.id, d.company_name, d.job_title, d.status, coalesce(c.passing_years, '{}') AS years, d.application_deadline FROM drives d LEFT JOIN drive_criteria c ON c.drive_id = d.id ORDER BY d.created_at DESC LIMIT 500`.execute(t)).rows;
    const intakes = (await sql<{ id: string; source_hash: string; source_text: string; drive_id: string | null; status: string; submitted_at: Date }>`
      SELECT id, source_hash, source_text, drive_id, status, submitted_at FROM drive_intakes ORDER BY submitted_at DESC LIMIT 200`.execute(t)).rows;
    return findDuplicates(input, drives, intakes);
  });
}

export async function intakeOfDrive(s: SessionUser, driveId: string): Promise<string | null> {
  return withSession(s, async (t) => (await sql<{ id: string }>`SELECT id FROM drive_intakes WHERE drive_id = ${driveId} AND status = 'READY' LIMIT 1`.execute(t)).rows[0]?.id ?? null);
}
