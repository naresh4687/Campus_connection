import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import { Pool } from "pg";
import { config } from "../config";
import { ContextMismatchError, requestContextSchema, type RequestContext } from "./context";

/** Table typings are added by each phase's migrations. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Database {}

export function createDb(connectionString: string, max = 10): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, max }) }),
  });
}

let shared: Kysely<Database> | undefined;
/** Runtime connection (role cc_app: no superuser, no BYPASSRLS, no DDL). */
export function db(): Kysely<Database> {
  shared ??= createDb(config().DATABASE_URL);
  return shared;
}

/**
 * The ONLY sanctioned way for feature code to touch tenant data.
 * Opens a transaction and sets app.user_id with a transaction-local setting, so nothing can leak to another request that reuses the pooled connection.
 * RLS policies read this context via app.current_*().
 */
export async function withTenantTx<T>(
  ctx: RequestContext,
  fn: (trx: Transaction<Database>) => Promise<T>,
  database: Kysely<Database> = db(),
): Promise<T> {
  const c = requestContextSchema.parse(ctx);
  return database.transaction().execute(async (trx) => {
    await sql`SELECT set_config('app.user_id', ${c.userId}, true)`.execute(trx);
    // Role and college come from the database, never from the caller. Verify they agree with the session.
    const derived = await sql<{ role: string | null; college_id: string | null }>`
      SELECT app.current_role() AS role, app.current_college_id()::text AS college_id`.execute(trx);
    const d = derived.rows[0];
    if (d?.role !== c.role || (d.college_id ?? null) !== c.collegeId) throw new ContextMismatchError();
    return fn(trx);
  });
}
