import { sql } from "kysely";
import { istToIso, type DriveInput } from "@/lib/drives";
import type { withSession } from "../auth/session";

export type Tx = Parameters<Parameters<typeof withSession>[1]>[0];
const arr = (ids: (string | number)[], cast: string) => (ids.length ? sql`ARRAY[${sql.join(ids.map((x) => sql`${x}::${sql.raw(cast)}`))}]::${sql.raw(cast)}[]` : sql`'{}'::${sql.raw(cast)}[]`);

/**
 * The drive form takes a company NAME. An existing company (matched ignoring upper/lower case) is reused; an unknown name is added through the
 * same audited function as the Companies page, with just the name (details can be filled in there later). All inside the drive's transaction.
 */
export async function resolveCompany(t: Tx, name: string): Promise<string> {
  const found = (await sql<{ id: string; status: string }>`SELECT id, status FROM companies WHERE name = ${name}::citext`.execute(t)).rows[0];
  if (found) {
    if (found.status !== "ACTIVE") throw Object.assign(new Error("This company is marked inactive. Reactivate it on the Companies page, or use a different name."), { code: "22023" });
    return found.id;
  }
  return (await sql<{ id: string }>`SELECT placement.create_company(${name}, null, null, null, null, null, null, null) AS id`.execute(t)).rows[0].id;
}

/** Creates (id null) or updates a DRAFT drive through the one audited database function that every drive write uses. Never publishes. */
export async function saveDriveDraft(t: Tx, id: string | null, v: DriveInput): Promise<string> {
  const companyId = await resolveCompany(t, v.companyName);
  return (await sql<{ id: string }>`SELECT placement.save_drive(${id}::uuid, ${companyId}::uuid, ${v.title}, ${v.description ?? null}, ${v.location ?? null}, ${v.type}, ${v.ctc ?? null}::numeric, ${v.ctcNote ?? null},
      ${v.bond ?? null}, ${v.qualification ?? null}, ${v.openings ?? null}::int, ${v.deadline ? istToIso(v.deadline) : null}::timestamptz, ${v.interview ?? null}, ${v.instructions ?? null},
      ${arr(v.departments, "uuid")}, ${arr(v.years, "int")}, ${arr(v.degrees, "text")}, ${v.minCgpa ?? null}::numeric, ${v.minTenth ?? null}::numeric, ${v.minTwelfth ?? null}::numeric, ${v.minDiploma ?? null}::numeric,
      ${v.maxBacklogs ?? null}::int, ${v.maxArrears ?? null}::int) AS id`.execute(t)).rows[0].id;
}
