import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { appDb, closeAppDb, code, inspect, makeCompany, makeCoordinator, makeDepartment, makeStudentIn, seedTwoColleges, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World; let co: string; let d1: string; let d2: string; let c1: Actor; let c2: Actor;
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, appDb());
const run = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(appDb()));
const sid = (s: Actor) => (s as Actor & { studentId: string }).studentId;
const record = (a: Actor | null, company: string, s: Actor, ctc: number | null = 6.5, offer = "OFFERED") => run(a, sql`SELECT placement.record_manual_placement(${company}::uuid, ${sid(s)}::uuid, ${ctc}::numeric, null, 'joined', ${offer}) AS id`);
const list = async (a: Actor, company: string | null = null) => (await run(a, sql`SELECT * FROM placement.manual_placements(${company}::uuid, false)`)).rows as { id: string; status: string; ctc_lpa: string }[];
let n = 0;

beforeAll(async () => { w = await seedTwoColleges(); co = await makeCompany(w.A.officer); d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin); c1 = await makeCoordinator(w.A.admin, [d1], "mp1"); c2 = await makeCoordinator(w.A.admin, [d2], "mp2"); });
afterAll(async () => { await closeAppDb(); });

describe("coordinators record placements; officers verify", () => {
  it("a coordinator records their own student with the package; it is pending, the officer is told, and only the right people can see it", async () => {
    const s = await makeStudentIn(w.A.admin, d1, `mp${++n}`);
    const r = (await record(c1, co, s)).rows[0] as { id: string };
    expect((await list(c1, co))[0]).toMatchObject({ id: r.id, status: "PENDING_VERIFICATION", ctc_lpa: "6.50" });
    expect((await list(w.A.officer)).some((x) => x.id === r.id)).toBe(true); expect((await list(w.A.admin)).some((x) => x.id === r.id)).toBe(true);
    expect((await list(c2)).some((x) => x.id === r.id)).toBe(false);                                          // another department's coordinator does not see it
    expect(await code(list(w.A.student))).toBe("42501");
    expect((await inspect<{ n: string }>("SELECT count(*)::text AS n FROM notifications WHERE user_id = $1 AND title = 'Placement recorded by a coordinator'", [w.A.officer.userId]))[0].n).not.toBe("0");
  });
  it("only students of the coordinator's departments, real companies of the college, a sensible package, and no duplicates", async () => {
    const mine = await makeStudentIn(w.A.admin, d1, `mp${++n}`); const theirs = await makeStudentIn(w.A.admin, d2, `mp${++n}`);
    expect(await code(record(c1, co, theirs))).toBe("42501");
    expect(await code(record(c1, crypto.randomUUID(), mine))).toBe("22023");
    expect(await code(record(c1, co, mine, 0))).toBe("22023"); expect(await code(record(c1, co, mine, 5000))).toBe("22023");
    await record(c1, co, mine); expect(await code(record(c1, co, mine))).toBe("23505");
    for (const who of [w.A.student, w.A.admin, null]) expect(await code(record(who, co, mine))).toBe("42501");
    const bCo = await makeCompany(w.B.officer); expect(await code(record(c1, bCo, mine))).toBe("22023");      // another college's company
  });
  it("an officer verifies or rejects (with a reason); a coordinator cannot; a rejected record can be entered again", async () => {
    const s = await makeStudentIn(w.A.admin, d1, `mp${++n}`); const r = (await record(c1, co, s)).rows[0] as { id: string };
    expect(await code(run(c1, sql`SELECT placement.review_manual_placement(${r.id}::uuid, true, null)`))).toBe("42501");
    expect(await code(run(w.A.officer, sql`SELECT placement.review_manual_placement(${r.id}::uuid, false, '')`))).toBe("22023");
    await run(w.A.officer, sql`SELECT placement.review_manual_placement(${r.id}::uuid, false, 'Package does not match the offer letter')`);
    expect((await list(c1, co)).find((x) => x.id === r.id)?.status).toBe("REJECTED");
    const again = (await record(c1, co, s, 7)).rows[0] as { id: string }; await run(w.A.officer, sql`SELECT placement.review_manual_placement(${again.id}::uuid, true, null)`);
    expect((await list(c1, co)).find((x) => x.id === again.id)?.status).toBe("VERIFIED");
    expect(await code(run(w.A.officer, sql`SELECT placement.review_manual_placement(${again.id}::uuid, true, null)`))).toBe("22023");
    expect(await code(run(w.B.officer, sql`SELECT placement.review_manual_placement(${again.id}::uuid, true, null)`))).toBe("22023");
  });
});

describe("many offers, one accepted offer", () => {
  it("a student can hold offers from several companies but accept only one; the officer can switch, and a withdrawn acceptance frees the slot", async () => {
    const s = await makeStudentIn(w.A.admin, d1, `mp${++n}`); const co2 = await makeCompany(w.A.officer); const co3 = await makeCompany(w.A.officer);
    const o1 = (await record(w.A.officer, co, s, 6, "OFFERED")).rows[0] as { id: string }; const o2 = (await record(w.A.officer, co2, s, 9, "OFFERED")).rows[0] as { id: string };
    expect((await list(w.A.officer)).filter((x) => [o1.id, o2.id].includes(x.id)).every((x) => x.status === "VERIFIED")).toBe(true);        // an officer's own record is verified at once
    await run(w.A.officer, sql`SELECT placement.set_offer_status(${o2.id}::uuid, 'ACCEPTED')`);
    expect(await code(run(w.A.officer, sql`SELECT placement.set_offer_status(${o1.id}::uuid, 'ACCEPTED')`))).toBe("23505");                     // already accepted elsewhere
    expect(await code(record(w.A.officer, co3, s, 12, "ACCEPTED"))).toBe("23505");
    await record(w.A.officer, co3, s, 12, "OFFERED");                                                                                          // another plain offer is fine
    await run(w.A.officer, sql`SELECT placement.set_offer_status(${o2.id}::uuid, 'OFFERED')`);
    await run(w.A.officer, sql`SELECT placement.set_offer_status(${o1.id}::uuid, 'ACCEPTED')`);                                               // switch the acceptance
    await run(w.A.officer, sql`SELECT placement.withdraw_manual_offer(${o1.id}::uuid, null)`);
    await run(w.A.officer, sql`SELECT placement.set_offer_status(${o2.id}::uuid, 'ACCEPTED')`);                                               // the slot is free again
    expect((await inspect<{ n: string }>("SELECT count(*)::text AS n FROM manual_placements WHERE student_id = $1 AND offer_status = 'ACCEPTED' AND status <> 'REJECTED'", [sid(s)]))[0].n).toBe("1");
    expect(await code(record(w.A.officer, co2, s, 5))).toBe("23505");                                                                          // a company can have one active record per student
  });
  it("only an officer can change the status or withdraw; bad values are refused", async () => {
    const s = await makeStudentIn(w.A.admin, d1, `mp${++n}`); const o = (await record(c1, co, s)).rows[0] as { id: string };
    for (const who of [c1, w.A.student, w.A.admin, null]) { expect(await code(run(who, sql`SELECT placement.set_offer_status(${o.id}::uuid, 'ACCEPTED')`))).toBe("42501"); expect(await code(run(who, sql`SELECT placement.withdraw_manual_offer(${o.id}::uuid, null)`))).toBe("42501"); }
    expect(await code(run(w.A.officer, sql`SELECT placement.set_offer_status(${o.id}::uuid, 'MAYBE')`))).toBe("22023");
    expect(await code(record(w.A.officer, co, s, 5, "MAYBE"))).toBe("22023");
    expect(await code(run(w.B.officer, sql`SELECT placement.set_offer_status(${o.id}::uuid, 'ACCEPTED')`))).toBe("22023");
  });
});

describe("the student picker", () => {
  it("an officer sees every student with offer counts and the accepted company; a coordinator only their department; others nothing", async () => {
    const mine = await makeStudentIn(w.A.admin, d1, `mp${++n}`); const theirs = await makeStudentIn(w.A.admin, d2, `mp${++n}`);
    await record(w.A.officer, co, mine, 8, "ACCEPTED");
    const pick = async (a: Actor) => (await run(a, sql`SELECT * FROM placement.recordable_students()`)).rows as { id: string; offers: number; accepted_company: string | null }[];
    const o = await pick(w.A.officer); expect(o.find((x) => x.id === sid(mine))).toMatchObject({ offers: 1 }); expect(o.find((x) => x.id === sid(mine))!.accepted_company).not.toBeNull(); expect(o.some((x) => x.id === sid(theirs))).toBe(true);
    const c = await pick(c1); expect(c.some((x) => x.id === sid(mine))).toBe(true); expect(c.some((x) => x.id === sid(theirs))).toBe(false);
    for (const who of [w.A.student, w.A.admin, null]) expect(await code(run(who, sql`SELECT * FROM placement.recordable_students()`))).toBe("42501");
  });
});
