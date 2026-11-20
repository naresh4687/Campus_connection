import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { completionScore, type CompletionFlags } from "../../src/lib/completion";
import { withTenantTx } from "../../src/server/db";
import { appDb, closeAppDb, code, makeCoordinator, makeDepartment, makeStudentIn, seedTwoColleges, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
type Stu = Actor & { studentId: string };
let w: World; let dept: string; let other: string; let coord: Actor; let coordOther: Actor;
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, appDb());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(appDb()));
const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

type Row = CompletionFlags & { score: number };
const completion = async (who: Actor, studentId: string) =>
  (await as(who, (t) => sql<Row>`SELECT contact, academics, semesters, document, career, achievement, score::int AS score FROM student_profile_completion WHERE student_id = ${studentId}::uuid`.execute(t))).rows[0];

const submitVerified = async (st: Stu, semesters: unknown = null) => {
  const r = await call(st, sql`SELECT academics.submit(8.25, 90, 88, null, 0, 0, null, '{}'::uuid[], ${semesters === null ? null : JSON.stringify(semesters)}::jsonb) AS id`);
  await call(coord, sql`SELECT academics.verify(${(r.rows[0] as { id: string }).id}::uuid, null)`);
};
const addDoc = async (st: Stu, kind = "MARKSHEET") =>
  ((await call(st, sql`SELECT documents.register(${kind}, 'doc.pdf', 'application/pdf', 1000, ${hex()}, ${`c/${st.collegeId}/s/${st.studentId}/${randomUUID()}`}) AS id`)).rows[0] as { id: string }).id;
const fresh = async (label: string) => makeStudentIn(w.A.admin, dept, label);

beforeAll(async () => {
  w = await seedTwoColleges();
  dept = await makeDepartment(w.A.admin); other = await makeDepartment(w.A.admin);
  coord = await makeCoordinator(w.A.admin, [dept], "pc-c"); coordOther = await makeCoordinator(w.A.admin, [other], "pc-c2");
});
afterAll(async () => { await closeAppDb(); });

describe("profile completion view", () => {
  it("a new student has nothing done: score 0", async () => {
    const st = await fresh("pc0");
    expect(await completion(st, st.studentId)).toEqual({ contact: false, academics: false, semesters: false, document: false, career: false, achievement: false, score: 0 });
  });

  it("each item switches on by the real record, and the score always equals the TypeScript checklist", async () => {
    const st = await fresh("pc1");
    const check = async (expected: Partial<CompletionFlags>) => {
      const r = await completion(st, st.studentId);
      expect(r).toMatchObject(expected);
      expect(r.score).toBe(completionScore(r));
      return r.score;
    };
    await call(st, sql`SELECT students.update_own_contact('+91 98765 43210', 'me@example.test')`);
    expect(await check({ contact: true })).toBe(15);
    await call(st, sql`SELECT students.update_own_contact('+91 98765 43210', null)`);       // one of the two is not enough
    expect(await check({ contact: false })).toBe(0);
    await call(st, sql`SELECT students.update_own_contact('+91 98765 43210', 'me@example.test')`);

    await submitVerified(st);                                                                   // verified, no semesters
    expect(await check({ academics: true, semesters: false })).toBe(55);
    await submitVerified(st, [{ semester: 1, sgpa: 8, backlogs: 0 }]);                          // a newer verified one WITH semesters
    expect(await check({ academics: true, semesters: true })).toBe(65);

    const doc = await addDoc(st);
    expect(await check({ document: true })).toBe(75);
    await call(coord, sql`SELECT documents.review(${doc}::uuid, 'REJECTED', 'The scan is not readable')`);
    expect(await check({ document: false })).toBe(65);                                          // a rejected document does not count
    await addDoc(st, "RESUME");
    expect(await check({ document: false })).toBe(65);                                          // a résumé is not a supporting document

    await call(coord, sql`SELECT students.set_career_preference(ARRAY[${st.studentId}::uuid], 'PLACEMENT', 'Confirmed with the student')`);
    expect(await check({ career: true })).toBe(75);

    const a = (await call(st, sql`SELECT achievements.add('PROJECT', 'A project', '2025-01-01'::date, null, null) AS id`)).rows[0] as { id: string };
    expect(await check({ achievement: false })).toBe(75);                                       // awaiting review does not count
    await call(coord, sql`SELECT achievements.verify(${a.id}::uuid, null)`);
    expect(await check({ achievement: true })).toBe(90);
    await addDoc(st);
    expect(await check({ document: true })).toBe(100);
  });

  it("is visible to the student, their coordinator and the college administrator, with the same answer; nobody else sees the row", async () => {
    const st = await fresh("pc2");
    await addDoc(st);
    for (const who of [st, coord, w.A.admin]) {
      const r = await completion(who, st.studentId);
      expect(r?.document, `${who.role} sees the document flag`).toBe(true);                    // the administrator cannot read documents, yet gets the yes/no
      expect(r.score).toBe(10);
    }
    for (const who of [coordOther, w.A.officer, w.B.admin, w.B.coordinator, w.pa, await fresh("pc3")]) expect(await completion(who, st.studentId), who.role).toBeUndefined();
  });

  it("the document helper reveals nothing to callers who may not see the student", async () => {
    const st = await fresh("pc4");
    await addDoc(st);
    const ask = async (who: Actor | null) => (await call(who, sql`SELECT students.has_supporting_document(${st.studentId}::uuid) AS v`)).rows[0] as { v: boolean };
    expect((await ask(st)).v).toBe(true); expect((await ask(coord)).v).toBe(true); expect((await ask(w.A.admin)).v).toBe(true);
    for (const who of [coordOther, w.A.officer, w.B.admin, w.B.coordinator, w.pa, await fresh("pc5")]) expect((await ask(who)).v, who.role).toBe(false);
    expect((await ask(null)).v).toBe(false);                                                    // no session: a plain "no", never a hint
  });

  it("is read-only for the runtime role", async () => {
    const st = await fresh("pc6");
    for (const who of [st, coord, w.A.admin]) expect(await code(call(who, sql`UPDATE student_profile_completion SET score = 100`)), who.role).not.toBe("OK");
  });
});
