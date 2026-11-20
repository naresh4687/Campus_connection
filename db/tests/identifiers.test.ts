import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { withOwner } from "./helpers";
import { appDb, closeAppDb, code, createStudentRecord, defaultDepartment, inspect, seedTwoColleges, studentInput, uniq, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World; let deptA: string; let deptB: string;
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, appDb());
const regOf = async (id: string) => (await inspect<{ r: string }>("SELECT register_number::text AS r FROM students WHERE id = $1", [id]))[0].r;
const num = () => `${Math.floor(10 + Math.random() * 89)}ai${String(Math.floor(Math.random() * 900) + 100)}${uniq("x").slice(2, 5)}`;

beforeAll(async () => { w = await seedTwoColleges(); deptA = await defaultDepartment(w.A.admin, w.A.collegeId); deptB = await defaultDepartment(w.B.admin, w.B.collegeId); });
afterAll(async () => { await closeAppDb(); });

describe("canonical register numbers (migration 0029)", () => {
  it("a student created as 23ai000 is stored as 23AI000, whatever wrote it", async () => {
    const id = await createStudentRecord(w.A.admin, studentInput(deptA, { register: "23ai000" + uniq("").slice(1, 4) }));
    const r = await regOf(id); expect(r).toBe(r.toUpperCase()); expect(r.startsWith("23AI000")).toBe(true);
  });
  it("editing a student's register number canonicalizes it, and the internal id does not change", async () => {
    const id = await createStudentRecord(w.A.admin, studentInput(deptA));
    const reg = num().toLowerCase();
    await as(w.A.admin, (t) => sql`SELECT students.update_student(${id}::uuid, ${deptA}::uuid, ${reg}, 'Asha Rao', ${`e${uniq("m")}@example.test`}, null, null, 'B.E.', null, 2022, 2026)`.execute(t));
    expect(await regOf(id)).toBe(reg.toUpperCase());
  });
  it("another casing of an existing register number is refused as a duplicate in the same college, but allowed in another college", async () => {
    const base = ("zz" + uniq("q").slice(2, 8)).toLowerCase();
    await createStudentRecord(w.A.admin, studentInput(deptA, { register: base }));
    for (const variant of [base.toUpperCase(), base[0].toUpperCase() + base.slice(1), ` ${base} `])
      expect(await code(createStudentRecord(w.A.admin, studentInput(deptA, { register: variant })))).toBe("23505");
    const other = await createStudentRecord(w.B.admin, studentInput(deptB, { register: base }));
    expect(await regOf(other)).toBe(base.toUpperCase());
  });
  it("direct SQL cannot store a non-canonical value either: the trigger fixes it and the constraint backs it up", async () => {
    const id = await createStudentRecord(w.A.admin, studentInput(deptA));
    const reg = ("dd" + uniq("w").slice(2, 8)).toLowerCase();
    await withOwner(async (c) => { await c.query("BEGIN"); try { await c.query("SET LOCAL ROLE cc_auth"); await c.query("UPDATE students SET register_number = $2 WHERE id = $1", [id, reg]); expect((await c.query("SELECT register_number::text AS r FROM students WHERE id = $1", [id])).rows[0].r).toBe(reg.toUpperCase()); } finally { await c.query("ROLLBACK"); } });
    const names = await inspect<{ conname: string }>("SELECT conname FROM pg_constraint WHERE conname = 'students_register_canonical'"); expect(names).toHaveLength(1);
  });
});

describe("normalizing existing data", () => {
  // The migration owner is itself under row-level security, so row work is done as cc_auth (the role the vetted functions run as) after the table changes.
  it("rewrites old mixed-case rows, keeps their ids, and reports no conflicts (the case-insensitive unique key already forbids them)", async () => {
    const id = await createStudentRecord(w.A.admin, studentInput(deptA));
    const reg = ("old" + uniq("z").slice(2, 7)).toLowerCase();
    await withOwner(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("ALTER TABLE students DROP CONSTRAINT students_register_canonical");
        await c.query("ALTER TABLE students DISABLE TRIGGER students_a_canonical");
        await c.query("SET LOCAL ROLE cc_auth");
        await c.query("UPDATE students SET register_number = $2 WHERE id = $1", [id, reg]);
        expect((await c.query("SELECT register_number::text AS r FROM students WHERE id = $1", [id])).rows[0].r).toBe(reg);       // the old, lower-case state
        expect((await c.query("SELECT count(*)::int AS n FROM app.identifier_conflicts()")).rows[0].n).toBe(0);
        expect((await c.query("SELECT app.apply_identifier_normalization() AS n")).rows[0].n).toBeGreaterThanOrEqual(1);
        expect((await c.query("SELECT register_number::text AS r FROM students WHERE id = $1", [id])).rows[0].r).toBe(reg.toUpperCase());
      } finally { await c.query("ROLLBACK"); }
    });
  });
  it("two records that would collapse into one identifier stop the backfill: nothing is changed, merged or deleted", async () => {
    const a = await createStudentRecord(w.A.admin, studentInput(deptA));
    const b = await createStudentRecord(w.A.admin, studentInput(deptA));
    await withOwner(async (c) => {
      await c.query("BEGIN");
      try {
        // A full-width spelling is a different citext value but the same NFKC identifier: the case the plain unique key cannot see.
        await c.query("ALTER TABLE students DROP CONSTRAINT students_register_canonical");
        await c.query("ALTER TABLE students DROP CONSTRAINT students_register_number_check");
        await c.query("ALTER TABLE students DISABLE TRIGGER students_a_canonical");
        await c.query("SET LOCAL ROLE cc_auth");
        await c.query("UPDATE students SET register_number = 'ＣＯＮＦ９９９' WHERE id = $1", [a]);
        await c.query("UPDATE students SET register_number = 'CONF999' WHERE id = $1", [b]);
        const conflicts = (await c.query("SELECT * FROM app.identifier_conflicts() WHERE canonical = 'CONF999'")).rows;
        expect(conflicts).toHaveLength(1); expect(conflicts[0].record_ids.slice().sort()).toEqual([a, b].sort());
        await c.query("SAVEPOINT s");
        await expect(c.query("SELECT app.apply_identifier_normalization()")).rejects.toThrow(/identifier conflict/);
        await c.query("ROLLBACK TO s");
        expect((await c.query("SELECT register_number::text AS r FROM students WHERE id = $1", [a])).rows[0].r).toBe("ＣＯＮＦ９９９");   // untouched
      } finally { await c.query("ROLLBACK"); }
    });
  });
});
