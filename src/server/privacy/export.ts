import { sql } from "kysely";
import { withSession, type SessionUser } from "../auth/session";

/** Internal references and file locations: meaningless (or other people's ids) outside the system. */
const HIDDEN = /^(storage_key|sha256|password_hash|ip_hash|endpoint|p256dh|auth|college_id|import_id)$|_by$|^actor_user_id$/;

/**
 * Everything held about the signed-in student, as they themselves may read it: every table with a student_id, plus their account
 * and notifications. Only columns the app may read are selected, and row-level security decides the rows, so unreleased results
 * and staff-only notes cannot appear here.
 */
export async function exportMyData(s: SessionUser) {
  return withSession(s, async (t) => {
    const columns = (await sql<{ table_name: string; column_name: string }>`
      SELECT c.relname AS table_name, a.attname AS column_name FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       WHERE c.relkind = 'r' AND has_column_privilege(c.oid, a.attnum, 'SELECT') ORDER BY c.relname, a.attnum`.execute(t)).rows;
    const tables = new Map<string, string[]>();
    for (const c of columns) tables.set(c.table_name, [...(tables.get(c.table_name) ?? []), c.column_name]);

    const read = async (table: string, key: string, value: string) => {
      const cols = (tables.get(table) ?? []).filter((c) => !HIDDEN.test(c));
      if (!cols.length) return [];
      return (await sql<Record<string, unknown>>`SELECT ${sql.join(cols.map((c) => sql.ref(c)))} FROM ${sql.table(table)} WHERE ${sql.ref(key)} = ${value}`.execute(t)).rows;
    };

    const student = (await sql<{ id: string }>`SELECT id FROM students WHERE user_id = ${s.userId}`.execute(t)).rows[0];
    if (!student) return null;
    const records: Record<string, unknown[]> = {};
    for (const [table, cols] of tables) {
      if (!cols.includes("student_id")) continue;
      const rows = await read(table, "student_id", student.id);
      if (rows.length) records[table] = rows;
    }
    const data = {
      generatedAt: new Date().toISOString(),
      account: (await read("users", "id", s.userId))[0] ?? null,
      student: (await read("students", "id", student.id))[0] ?? null,
      records,
      notifications: await read("notifications", "user_id", s.userId),
    };
    await sql`SELECT privacy.log_export()`.execute(t);
    return data;
  });
}
