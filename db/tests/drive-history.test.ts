import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { appDb, closeAppDb, driveInput, inspect, makeCompany, makeCoordinator, makeDepartment, makeDrive, makeStudentIn, seedTwoColleges, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World; let co: string; let d1: string; let d2: string; let coord: Actor; let coordOther: Actor;
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, appDb());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(appDb()));
const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
type Row = { company_name: string; registration_status: string; selected: boolean; offer_status: string | null; offered_ctc_lpa: string | null; placement_status: string | null };
const history = async (a: Actor | null, student: string) => (await call(a, sql`SELECT company_name, registration_status, selected, offer_status, offered_ctc_lpa::text AS offered_ctc_lpa, placement_status FROM students.drive_history(${student}::uuid)`)).rows as Row[];

const verifiedStudent = async (dept: string, label: string) => {
  const s = await makeStudentIn(w.A.admin, dept, label);
  const sub = (await call(s, sql`SELECT academics.submit(8, 80, 80, null, 0, 0, null) AS id`)).rows[0] as { id: string };
  await call(coord, sql`SELECT academics.verify(${sub.id}::uuid, null)`);
  return s;
};

beforeAll(async () => {
  w = await seedTwoColleges();
  co = await makeCompany(w.A.officer); d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin);
  coord = await makeCoordinator(w.A.admin, [d1], "dh-c"); coordOther = await makeCoordinator(w.A.admin, [d2], "dh-c2");
});
afterAll(async () => { await closeAppDb(); });

describe("students.drive_history", () => {
  it("shows registration, selection, offer and verified placement; the package only to the administrator", async () => {
    const st = await verifiedStudent(d1, "dh1");
    expect(await history(w.A.admin, st.studentId)).toEqual([]);
    const drive = await makeDrive(w.A.officer, driveInput(co, [d1]), true);
    const reg = (await call(st, sql`SELECT registrations.register(${drive}::uuid) AS id`)).rows[0] as { id: string };
    expect(await history(coord, st.studentId)).toMatchObject([{ registration_status: "REGISTERED", selected: false, offer_status: null, placement_status: null }]);

    await call(w.A.officer, sql`SELECT placement.set_drive_status(${drive}::uuid, 'CLOSED')`);
    const round = ((await call(w.A.officer, sql`SELECT rounds.save_round(null, ${drive}::uuid, 'Final', 'HR', null, null, null) AS id`)).rows[0] as { id: string }).id;
    await call(w.A.officer, sql`SELECT rounds.set_results(${round}::uuid, ARRAY[${reg.id}]::uuid[], 'SELECTED', null)`);
    await call(w.A.officer, sql`SELECT rounds.release_round(${round}::uuid)`);
    await call(w.A.officer, sql`SELECT offers.select_students(${drive}::uuid, ARRAY[${reg.id}]::uuid[])`);
    const sel = (await inspect<{ id: string }>("SELECT id FROM selections WHERE drive_id = $1 AND student_id = $2", [drive, st.studentId]))[0].id;
    await call(w.A.officer, sql`SELECT offers.issue_offer(${sel}::uuid, 6.5::numeric, ${new Date(Date.now() + 7 * 86400_000).toISOString()}::timestamptz, null)`);
    await call(st, sql`SELECT offers.respond(${sel}::uuid, true)`);
    const file = ((await call(st, sql`SELECT offers.register_file(${sel}::uuid, 'JOINING_PROOF', 'f.pdf', 'application/pdf', 1000, ${hex().slice(0, 64)}, ${`c/${w.A.admin.collegeId}/o/${sel}/${randomUUID()}`}) AS id`)).rows[0] as { id: string }).id;
    await call(st, sql`SELECT offers.record_joining(${sel}::uuid, ${new Date().toISOString().slice(0, 10)}::date, 'Engineer', null, ${file}::uuid)`);
    await call(w.A.officer, sql`SELECT offers.decide_placement(${sel}::uuid, 'VERIFIED', null)`);

    const adminView = await history(w.A.admin, st.studentId);
    expect(adminView).toMatchObject([{ selected: true, offer_status: "ACCEPTED", offered_ctc_lpa: "6.50", placement_status: "VERIFIED" }]);
    const coordView = await history(coord, st.studentId);
    expect(coordView).toMatchObject([{ selected: true, offer_status: "ACCEPTED", placement_status: "VERIFIED" }]);
    expect(coordView[0].offered_ctc_lpa).toBeNull();
  });

  it("returns nothing to anyone else: another department's coordinator, officer, the student, another college, anonymous", async () => {
    const st = await verifiedStudent(d1, "dh2");
    const drive = await makeDrive(w.A.officer, driveInput(co, [d1]), true);
    await call(st, sql`SELECT registrations.register(${drive}::uuid)`);
    expect(await history(coord, st.studentId)).toHaveLength(1);
    for (const who of [coordOther, w.A.officer, st, w.B.admin, w.pa, null]) expect(await history(who, st.studentId), who?.role ?? "anonymous").toEqual([]);
  });
});
