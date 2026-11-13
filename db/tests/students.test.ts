import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { hashToken, newToken } from "../../src/server/auth/tokens";
import { adminWrite, appDb, closeAppDb, code, createCollege, createStudentRecord, createUser, defaultDepartment, DENIED, emailFor, FAKE_HASH, inspect, seedTwoColleges, studentInput, uniq, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World;
let deptA: string; let deptB: string;
const db = () => appDb();
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, db());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(db()));
const mk = (admin: Actor, dept: string, over: Parameters<typeof studentInput>[1] = {}) => createStudentRecord(admin, studentInput(dept, over));
const mkDept = async (admin: Actor) => (await as(admin, (t) => sql<{ id: string }>`SELECT college.create_department(${uniq("Dept")}, ${uniq("D").slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, "X")}, null) AS id`.execute(t))).rows[0].id;
const seen = async (a: Actor) => (await as(a, (t) => sql<{ id: string }>`SELECT id FROM students ORDER BY id`.execute(t))).rows.map((r) => r.id).sort();
const invite = (a: Actor | null, id: string, token = newToken(), ttl = 3600) => call(a, sql`SELECT students.invite_student(${id}::uuid, ${hashToken(token)}, ${ttl})`);

beforeAll(async () => {
  w = await seedTwoColleges();
  deptA = await defaultDepartment(w.A.admin, w.A.collegeId);
  deptB = await defaultDepartment(w.B.admin, w.B.collegeId);
});
afterAll(async () => { await closeAppDb(); });

describe("who can create and change student records", () => {
  it("only a college admin may call any student function (every other caller is refused)", async () => {
    const id = await mk(w.A.admin, deptA);
    const calls = (who: Actor | null): [string, () => Promise<unknown>][] => [
      ["create", () => call(who, sql`SELECT students.create_student(${deptA}::uuid, ${uniq("R")}, 'Nope Person', ${emailFor("n")}, null, null, 'B.E.', null, 2022, 2026)`)],
      ["update", () => call(who, sql`SELECT students.update_student(${id}::uuid, ${deptA}::uuid, ${uniq("R")}, 'Nope Person', ${emailFor("n")}, null, null, 'B.E.', null, 2022, 2026)`)],
      ["invite", () => invite(who, id)],
      ["bulk invite", () => call(who, sql`SELECT * FROM students.invite_students(ARRAY[${id}]::uuid[], ARRAY[${hashToken(newToken())}]::bytea[], 3600)`)],
      ["create import", () => call(who, sql`SELECT students.create_import('x.csv', '["a"]'::jsonb, '[["1"]]'::jsonb)`)],
      ["save validation", () => call(who, sql`SELECT students.save_validation(gen_random_uuid(), '{}'::jsonb, '[]'::jsonb)`)],
      ["commit import", () => call(who, sql`SELECT students.commit_import(gen_random_uuid())`)],
      ["cancel import", () => call(who, sql`SELECT students.cancel_import(gen_random_uuid())`)],
    ];
    for (const who of [null, w.A.officer, w.A.coordinator, w.A.student, w.pa]) {
      for (const [name, run] of calls(who)) expect(await code(run()), `${who?.role ?? "anonymous"} -> ${name}`).toBe(DENIED);
    }
  });

  it("the runtime role cannot INSERT/UPDATE/DELETE students or import tables directly, even as the admin", async () => {
    const id = await mk(w.A.admin, deptA);
    for (const q of [
      sql`INSERT INTO students (college_id, department_id, register_number, full_name, college_email, degree, admission_year, passing_year) VALUES (${w.A.collegeId}, ${deptA}, 'X1234', 'Sneaky', 's@x.test', 'B.E.', 2022, 2026)`,
      sql`UPDATE students SET full_name = 'Hacked' WHERE id = ${id}`,
      sql`DELETE FROM students WHERE id = ${id}`,
      sql`UPDATE students SET user_id = ${w.A.student.userId} WHERE id = ${id}`,
      sql`INSERT INTO student_imports (college_id, created_by, filename, headers, total_rows) VALUES (${w.A.collegeId}, ${w.A.admin.userId}, 'x', '[]', 1)`,
      sql`DELETE FROM student_import_rows`,
    ]) expect(await code(as(w.A.admin, (t) => q.execute(t)))).toBe(DENIED);
  });

  it("a student can never edit their own identity or academic fields directly", async () => {
    for (const col of ["full_name = 'X Y'", "department_id = gen_random_uuid()", "register_number = 'HACK001'", "passing_year = 2020", "college_email = 'a@b.test'"]) {
      expect(await code(as(w.A.student, (t) => sql.raw(`UPDATE students SET ${col} WHERE user_id = '${w.A.student.userId}'`).execute(t))), col).toBe(DENIED);
    }
  });
});

describe("tenant-aware integrity", () => {
  it("cannot place a student in another college's department, via the function or directly", async () => {
    expect(await code(call(w.A.admin, sql`SELECT students.create_student(${deptB}::uuid, ${uniq("R")}, 'Cross College', ${emailFor("x")}, null, null, 'B.E.', null, 2022, 2026)`))).toBe("22023");
    await expect(adminWrite("INSERT INTO students (college_id, department_id, register_number, full_name, college_email, degree, admission_year, passing_year) VALUES ($1, $2, 'XC0001', 'X Cross', 'xc@x.test', 'B.E.', 2022, 2026)",
      [w.A.collegeId, deptB])).rejects.toMatchObject({ code: "23503" });
  });
  it("a student account can only link to a STUDENT user of the same college", async () => {
    const id = await mk(w.A.admin, deptA);
    await expect(adminWrite("UPDATE students SET user_id = $1 WHERE id = $2", [w.B.student.userId, id])).rejects.toMatchObject({ code: expect.stringMatching(/^2350[35]$/) }); // other college's student: refused (already linked / wrong college)
    await expect(adminWrite("UPDATE students SET user_id = $1 WHERE id = $2", [w.B.coordinator.userId, id])).rejects.toMatchObject({ code: "23503" });   // other college AND not a student
    await expect(adminWrite("UPDATE students SET user_id = $1 WHERE id = $2", [w.A.officer.userId, id])).rejects.toMatchObject({ code: "23503" });   // not a student
    await expect(adminWrite("UPDATE students SET user_id = $1 WHERE id = $2", [w.A.student.userId, id])).rejects.toMatchObject({ code: "23505" });    // already linked to another record
  });
  it("a student invitation cannot point at another college's record or omit the record", async () => {
    const idB = await mk(w.B.admin, deptB);
    await expect(adminWrite("INSERT INTO invitations (email, role, college_id, invited_by, token_hash, expires_at, student_id) VALUES ('x1@x.test','STUDENT',$1,$2,'\\x01',now()+interval '1 day',$3)", [w.A.collegeId, w.A.admin.userId, idB])).rejects.toMatchObject({ code: "23503" });
    await expect(adminWrite("INSERT INTO invitations (email, role, college_id, invited_by, token_hash, expires_at) VALUES ('x2@x.test','STUDENT',$1,$2,'\\x02',now()+interval '1 day')", [w.A.collegeId, w.A.admin.userId])).rejects.toMatchObject({ code: "23514" });
    const idA = await mk(w.A.admin, deptA);
    await expect(adminWrite("INSERT INTO invitations (email, role, college_id, invited_by, token_hash, expires_at, student_id) VALUES ('x3@x.test','COORDINATOR',$1,$2,'\\x03',now()+interval '1 day',$3)", [w.A.collegeId, w.A.admin.userId, idA])).rejects.toMatchObject({ code: "23514" });
  });
  it("an inactive department takes no new students", async () => {
    const d = await mkDept(w.A.admin);
    await as(w.A.admin, (t) => sql`SELECT college.set_department_status(${d}::uuid, 'INACTIVE')`.execute(t));
    expect(await code(mk(w.A.admin, d))).toBe("22023");
  });
});

describe("student data rules", () => {
  it("register numbers and college emails are unique per college (case-insensitive) but reusable across colleges", async () => {
    const reg = uniq("DUP").toUpperCase(); const email = emailFor("dup");
    await mk(w.A.admin, deptA, { register: reg, email });
    expect(await code(mk(w.A.admin, deptA, { register: reg.toLowerCase() }))).toBe("23505");
    expect(await code(mk(w.A.admin, deptA, { email: email.toUpperCase() }))).toBe("23505");
    expect(await code(mk(w.B.admin, deptB, { register: reg, email }))).toBe("OK");
  });
  it("reports which field collided", async () => {
    const reg = uniq("MSG").toUpperCase(); const email = emailFor("msg");
    await mk(w.A.admin, deptA, { register: reg, email });
    await expect(mk(w.A.admin, deptA, { register: reg })).rejects.toThrow(/register number/);
    await expect(mk(w.A.admin, deptA, { email })).rejects.toThrow(/college email/);
  });
  const bad: [string, Partial<ReturnType<typeof studentInput>>][] = [
    ["short register number", { register: "AB" }], ["register number with spaces", { register: "AB 123" }], ["register number with markup", { register: "<b>12345" }],
    ["one-letter name", { name: "X" }], ["email without @", { email: "nope" }], ["bad personal email", { personal: "also nope" }],
    ["letters in phone", { phone: "call me" }], ["unknown degree", { degree: "PhD in Wizardry" }], ["passing before admission", { admission: 2025, passing: 2024 }],
    ["same admission and passing year", { admission: 2022, passing: 2022 }], ["course longer than 8 years", { admission: 2010, passing: 2025 }], ["year out of range", { admission: 1980, passing: 1984 }],
  ];
  for (const [label, over] of bad) it(`rejects ${label}`, async () => { expect(await code(mk(w.A.admin, deptA, over)), label).toBe("22023"); });
  it("normalises: trims, lower-cases emails, empty optionals become NULL", async () => {
    const id = await mk(w.A.admin, deptA, { register: "  " + uniq("TRM").toUpperCase() + " ", email: "  " + emailFor("TRIM").toUpperCase() + " ", personal: "   ", phone: "  ", spec: "  " });
    const [r] = await inspect<{ register_number: string; college_email: string; personal_email: string | null; phone: string | null; specialization: string | null }>("SELECT register_number::text, college_email::text, personal_email::text, phone, specialization FROM students WHERE id = $1", [id]);
    expect(r.register_number).toBe(r.register_number.trim());
    expect(r.college_email).toBe(r.college_email.trim().toLowerCase());
    expect([r.personal_email, r.phone, r.specialization]).toEqual([null, null, null]);
  });
  it("update_student changes the record, audits it, and refuses duplicates", async () => {
    const a = await mk(w.A.admin, deptA); const b = await mk(w.A.admin, deptA, { register: uniq("UPD").toUpperCase() });
    const [bRow] = await inspect<{ register_number: string; college_email: string }>("SELECT register_number::text, college_email::text FROM students WHERE id = $1", [b]);
    const upd = (over: { reg?: string; email?: string; name?: string; dept?: string }) => call(w.A.admin, sql`SELECT students.update_student(${a}::uuid, ${(over.dept ?? deptA)}::uuid, ${over.reg ?? uniq("NEW").toUpperCase()}, ${over.name ?? "Renamed Student"},
      ${over.email ?? emailFor("renamed")}, null, '98765 43210', 'M.Tech', 'VLSI', 2023, 2025)`);
    await upd({});
    expect((await inspect<{ full_name: string; degree: string; specialization: string }>("SELECT full_name, degree, specialization FROM students WHERE id = $1", [a]))[0]).toEqual({ full_name: "Renamed Student", degree: "M.Tech", specialization: "VLSI" });
    expect(await code(upd({ reg: bRow.register_number }))).toBe("23505");
    expect(await code(upd({ email: bRow.college_email }))).toBe("23505");
    expect(await code(upd({ dept: deptB }))).toBe("22023");
    expect(await inspect("SELECT 1 FROM audit_log WHERE action = 'STUDENT_UPDATED' AND entity_id = $1", [a])).toHaveLength(1);
  });
  it("another college's admin cannot read or update this college's student", async () => {
    const id = await mk(w.A.admin, deptA);
    expect(await code(call(w.B.admin, sql`SELECT students.update_student(${id}::uuid, ${deptB}::uuid, ${uniq("R")}, 'Stolen Student', ${emailFor("s")}, null, null, 'B.E.', null, 2022, 2026)`))).toBe("22023");
    expect(await seen(w.B.admin)).not.toContain(id);
  });
});

describe("student visibility (row level security)", () => {
  it("an admin sees every student of their college and none of another's", async () => {
    const a = await mk(w.A.admin, deptA); const b = await mk(w.B.admin, deptB);
    expect(await seen(w.A.admin)).toEqual(expect.arrayContaining([a, w.A.student.userId ? a : a]));
    expect(await seen(w.A.admin)).not.toContain(b);
    expect(await seen(w.B.admin)).toContain(b);
    expect(await seen(w.B.admin)).not.toContain(a);
  });
  it("a coordinator sees ONLY students of departments assigned to them, and loses them on unassignment", async () => {
    const coord = await createUser(w.A.admin, "COORDINATOR", w.A.collegeId, "roster");
    const d1 = await mkDept(w.A.admin); const d2 = await mkDept(w.A.admin);
    const s1 = await mk(w.A.admin, d1); const s2 = await mk(w.A.admin, d2); const s3 = await mk(w.A.admin, deptA);
    expect(await seen(coord)).toEqual([]);
    await as(w.A.admin, (t) => sql`SELECT college.assign_coordinator(${d1}::uuid, ${coord.userId}::uuid)`.execute(t));
    expect(await seen(coord)).toEqual([s1]);
    await as(w.A.admin, (t) => sql`SELECT college.assign_coordinator(${d2}::uuid, ${coord.userId}::uuid)`.execute(t));
    expect(await seen(coord)).toEqual([s1, s2].sort());
    expect(await seen(coord)).not.toContain(s3);
    await as(w.A.admin, (t) => sql`SELECT college.unassign_coordinator(${d1}::uuid, ${coord.userId}::uuid)`.execute(t));
    expect(await seen(coord)).toEqual([s2]);
    expect((await as(coord, (t) => sql`SELECT * FROM students WHERE id = ${s1}`.execute(t))).rows).toEqual([]);
  });
  it("moving a student to another department moves their visibility with them", async () => {
    const coord = await createUser(w.A.admin, "COORDINATOR", w.A.collegeId, "move");
    const d1 = await mkDept(w.A.admin); const d2 = await mkDept(w.A.admin);
    await as(w.A.admin, (t) => sql`SELECT college.assign_coordinator(${d1}::uuid, ${coord.userId}::uuid)`.execute(t));
    const s = await mk(w.A.admin, d1);
    expect(await seen(coord)).toEqual([s]);
    await call(w.A.admin, sql`SELECT students.update_student(${s}::uuid, ${d2}::uuid, ${uniq("MV").toUpperCase()}, 'Moved Student', ${emailFor("mv")}, null, null, 'B.E.', null, 2022, 2026)`);
    expect(await seen(coord)).toEqual([]);
  });
  it("a student sees only their own record; officers, the platform admin and no-context see none", async () => {
    await mk(w.A.admin, deptA);
    const mine = (await inspect<{ id: string }>("SELECT id FROM students WHERE user_id = $1", [w.A.student.userId])).map((r) => r.id);
    expect(await seen(w.A.student)).toEqual(mine);
    expect(await seen(w.B.student)).not.toEqual(expect.arrayContaining(mine));
    for (const who of [w.A.officer, w.pa]) expect(await seen(who)).toEqual([]);
    expect((await sql`SELECT 1 FROM students`.execute(db())).rows).toEqual([]);
  });
  it("a student can read their own department — and only that one — so their profile can be shown", async () => {
    const other = await mkDept(w.A.admin);
    const depts = (await as(w.A.student, (t) => sql<{ id: string }>`SELECT id FROM departments`.execute(t))).rows.map((r) => r.id);
    expect(depts).toEqual([deptA]);
    expect(depts).not.toContain(other);
    // the exact join the student's profile page runs
    const r = await as(w.A.student, (t) => sql<{ code: string; register_number: string }>`SELECT d.code::text AS code, st.register_number::text AS register_number FROM students st JOIN departments d ON d.id = st.department_id`.execute(t));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].code).toBe("GEN");
    expect((await as(w.B.student, (t) => sql<{ id: string }>`SELECT id FROM departments`.execute(t))).rows.map((x) => x.id)).toEqual([deptB]); // never another college's
  });
  it("import staging data is visible only to that college's admin", async () => {
    const imp = (await as(w.A.admin, (t) => sql<{ id: string }>`SELECT students.create_import('vis.csv', '["a"]'::jsonb, '[["1"],["2"]]'::jsonb) AS id`.execute(t))).rows[0].id;
    const count = async (a: Actor) => (await as(a, (t) => sql<{ n: number }>`SELECT count(*)::int AS n FROM student_import_rows WHERE import_id = ${imp}`.execute(t))).rows[0].n;
    expect(await count(w.A.admin)).toBe(2);
    for (const who of [w.B.admin, w.A.officer, w.A.coordinator, w.A.student, w.pa]) expect(await count(who), who.role).toBe(0);
    expect((await as(w.B.admin, (t) => sql`SELECT 1 FROM student_imports WHERE id = ${imp}`.execute(t))).rows).toEqual([]);
  });
});

describe("student invitations and account linking", () => {
  it("invite_student creates an invitation bound to the record; accepting links the account to that record", async () => {
    const id = await mk(w.A.admin, deptA); const token = newToken();
    await invite(w.A.admin, id, token);
    const [inv] = await inspect<{ student_id: string; role: string; email: string }>("SELECT student_id, role, email::text AS email FROM invitations WHERE student_id = $1 AND accepted_at IS NULL", [id]);
    expect(inv).toMatchObject({ student_id: id, role: "STUDENT" });
    const r = await sql<{ user_id: string; role: string; college_id: string }>`SELECT * FROM auth.accept_invitation(${hashToken(token)}, 'Linked Student', ${FAKE_HASH})`.execute(db());
    expect(r.rows[0]).toMatchObject({ role: "STUDENT", college_id: w.A.collegeId });
    const [s] = await inspect<{ user_id: string; college_email: string }>("SELECT user_id, college_email::text AS college_email FROM students WHERE id = $1", [id]);
    expect(s.user_id).toBe(r.rows[0].user_id);
    expect(s.college_email).toBe(inv.email);
    // the new student sees exactly their own record
    const me: Actor = { userId: r.rows[0].user_id, collegeId: w.A.collegeId, role: "STUDENT", email: inv.email };
    expect(await seen(me)).toEqual([id]);
  });
  it("cannot invite a student who already has an account, or whose email already belongs to an account", async () => {
    const linked = (await inspect<{ id: string }>("SELECT id FROM students WHERE user_id = $1", [w.A.student.userId]))[0].id;
    expect(await code(invite(w.A.admin, linked))).toBe("22023");
    const clash = await mk(w.A.admin, deptA, { email: w.A.officer.email });
    expect(await code(invite(w.A.admin, clash))).toBe("23505");
  });
  it("re-inviting invalidates the earlier link; ttl is bounded; other colleges' records are not invitable", async () => {
    const id = await mk(w.A.admin, deptA); const t1 = newToken(); const t2 = newToken();
    await invite(w.A.admin, id, t1); await invite(w.A.admin, id, t2);
    expect(await code(sql`SELECT * FROM auth.accept_invitation(${hashToken(t1)}, 'X Y', ${FAKE_HASH})`.execute(db()))).toBe("P0001");
    expect(await code(sql`SELECT * FROM auth.accept_invitation(${hashToken(t2)}, 'X Y', ${FAKE_HASH})`.execute(db()))).toBe("OK");
    const other = await mk(w.A.admin, deptA);
    expect(await code(invite(w.A.admin, other, newToken(), 5))).toBe("22023");
    expect(await code(invite(w.B.admin, other))).toBe("22023");
  });
  it("changing the email revokes pending invitations, and the email is frozen once an account exists", async () => {
    const id = await mk(w.A.admin, deptA); const token = newToken();
    await invite(w.A.admin, id, token);
    await call(w.A.admin, sql`SELECT students.update_student(${id}::uuid, ${deptA}::uuid, ${uniq("EM").toUpperCase()}, 'Email Changed', ${emailFor("changed")}, null, null, 'B.E.', null, 2022, 2026)`);
    expect(await code(sql`SELECT * FROM auth.accept_invitation(${hashToken(token)}, 'X Y', ${FAKE_HASH})`.execute(db()))).toBe("P0001");
    const linked = (await inspect<{ id: string; register_number: string }>("SELECT id, register_number::text AS register_number FROM students WHERE user_id = $1", [w.A.student.userId]))[0];
    expect(await code(call(w.A.admin, sql`SELECT students.update_student(${linked.id}::uuid, ${deptA}::uuid, ${linked.register_number}, 'Same Student', ${emailFor("nope")}, null, null, 'B.E.', null, 2022, 2026)`))).toBe("22023");
  });
  it("a tampered acceptance cannot link an account to a record whose email differs", async () => {
    const id = await mk(w.A.admin, deptA); const token = newToken();
    await invite(w.A.admin, id, token);
    await adminWrite("UPDATE students SET college_email = 'different@x.test' WHERE id = $1", [id]);   // simulate drift behind the app's back
    expect(await code(sql`SELECT * FROM auth.accept_invitation(${hashToken(token)}, 'X Y', ${FAKE_HASH})`.execute(db()))).toBe("P0001");
    expect(await inspect("SELECT 1 FROM users WHERE email = $1", [emailFor("never")])).toHaveLength(0);
  });
  it("bulk invitation reports a per-student outcome and enforces its limits", async () => {
    const ok = await mk(w.A.admin, deptA); const linked = (await inspect<{ id: string }>("SELECT id FROM students WHERE user_id = $1", [w.A.student.userId]))[0].id; const foreign = await mk(w.B.admin, deptB);
    const ids = [ok, linked, foreign, "00000000-0000-4000-8000-000000000000"];
    const r = await as(w.A.admin, (t) => sql<{ student_id: string; outcome: string }>`SELECT * FROM students.invite_students(${sql.raw(`ARRAY['${ids.join("','")}']::uuid[]`)}, ${sql.raw(`ARRAY[${ids.map(() => `'\\x${Buffer.from(newToken()).toString("hex").slice(0, 32)}'::bytea`).join(",")}]`)}, 3600)`.execute(t));
    expect(Object.fromEntries(r.rows.map((x) => [x.student_id, x.outcome]))).toEqual({ [ok]: "OK", [linked]: "HAS_ACCOUNT", [foreign]: "NOT_FOUND", [ids[3]]: "NOT_FOUND" });
    expect(await code(call(w.A.admin, sql`SELECT * FROM students.invite_students(ARRAY[]::uuid[], ARRAY[]::bytea[], 3600)`))).toBe("22023");
    expect(await code(call(w.A.admin, sql`SELECT * FROM students.invite_students(ARRAY[${ok}]::uuid[], ARRAY[]::bytea[], 3600)`))).toBe("22023");
  });
});

describe("a student's own contact details", () => {
  it("a student may change only their phone and personal email, and it is audited", async () => {
    await as(w.A.student, (t) => sql`SELECT students.update_own_contact('+91 90000 22222', 'Mine@Personal.Example')`.execute(t));
    const [r] = await inspect<{ phone: string; personal_email: string; full_name: string }>("SELECT phone, personal_email::text AS personal_email, full_name FROM students WHERE user_id = $1", [w.A.student.userId]);
    expect(r).toMatchObject({ phone: "+91 90000 22222", personal_email: "mine@personal.example" });
    expect(await inspect("SELECT 1 FROM audit_log WHERE action = 'STUDENT_CONTACT_UPDATED' AND actor_user_id = $1", [w.A.student.userId])).not.toHaveLength(0);
    await as(w.A.student, (t) => sql`SELECT students.update_own_contact(null, null)`.execute(t));
    expect((await inspect<{ phone: string | null }>("SELECT phone FROM students WHERE user_id = $1", [w.A.student.userId]))[0].phone).toBeNull();
  });
  it("rejects invalid values and affects no one else's record", async () => {
    expect(await code(as(w.A.student, (t) => sql`SELECT students.update_own_contact('letters', null)`.execute(t)))).toBe("22023");
    expect(await code(as(w.A.student, (t) => sql`SELECT students.update_own_contact(null, 'not-an-email')`.execute(t)))).toBe("22023");
    const before = await inspect<{ phone: string | null }>("SELECT phone FROM students WHERE user_id = $1", [w.B.student.userId]);
    await as(w.A.student, (t) => sql`SELECT students.update_own_contact('+91 91111 33333', null)`.execute(t));
    expect(await inspect("SELECT phone FROM students WHERE user_id = $1", [w.B.student.userId])).toEqual(before);
  });
  it("is refused for every non-student role and with no context", async () => {
    for (const who of [w.A.admin, w.A.officer, w.A.coordinator, w.pa, null]) expect(await code(call(who, sql`SELECT students.update_own_contact('9876543210', null)`))).toBe(DENIED);
  });
});

describe("CSV import staging", () => {
  const rowsJson = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => [`r${i}`]));
  const newImport = async (admin = w.A.admin, n = 3) => (await as(admin, (t) => sql<{ id: string }>`SELECT students.create_import('f.csv', '["a"]'::jsonb, ${rowsJson(n)}::jsonb) AS id`.execute(t))).rows[0].id;
  const validate = (admin: Actor, id: string, results: unknown[]) => call(admin, sql`SELECT students.save_validation(${id}::uuid, '{"x":"y"}'::jsonb, ${JSON.stringify(results)}::jsonb)`);
  const goodRow = (n: number, dept: string, over: Record<string, unknown> = {}) => ({ n, status: "VALID", errors: [], normalized: { register_number: uniq("IMP").toUpperCase(), full_name: "Imported Student", college_email: emailFor("imp"), degree: "B.E.", admission_year: 2022, passing_year: 2026, department_id: dept, ...over } });
  const statusOf = async (id: string) => (await inspect<{ status: string; valid_rows: number; error_rows: number; duplicate_rows: number; imported_rows: number }>("SELECT status, valid_rows, error_rows, duplicate_rows, imported_rows FROM student_imports WHERE id = $1", [id]))[0];

  it("enforces size limits (1–5000 rows, 1–30 columns)", async () => {
    expect(await code(call(w.A.admin, sql`SELECT students.create_import('f.csv', '["a"]'::jsonb, '[]'::jsonb)`))).toBe("22023");
    expect(await code(call(w.A.admin, sql`SELECT students.create_import('f.csv', '[]'::jsonb, '[["1"]]'::jsonb)`))).toBe("22023");
    expect(await code(call(w.A.admin, sql`SELECT students.create_import('f.csv', ${JSON.stringify(Array.from({ length: 31 }, (_, i) => `c${i}`))}::jsonb, '[["1"]]'::jsonb)`))).toBe("22023");
    expect(await code(call(w.A.admin, sql`SELECT students.create_import('f.csv', '["a"]'::jsonb, ${rowsJson(5001)}::jsonb)`))).toBe("22023");
    expect(await code(call(w.A.admin, sql`SELECT students.create_import('f.csv', '["a"]'::jsonb, ${rowsJson(5000)}::jsonb)`))).toBe("OK");
  });

  it("validate -> commit creates only VALID rows and records errors and duplicates; counts add up", async () => {
    const dup = await mk(w.A.admin, deptA);
    const [dupRow] = await inspect<{ register_number: string; college_email: string }>("SELECT register_number::text, college_email::text FROM students WHERE id = $1", [dup]);
    const id = await newImport(w.A.admin, 4);
    await validate(w.A.admin, id, [
      goodRow(1, deptA), goodRow(2, deptA),
      { n: 3, status: "ERROR", errors: ["Row 3: invalid email"], normalized: null },
      { n: 4, status: "DUPLICATE", errors: ["already exists"], normalized: null },
    ]);
    expect(await statusOf(id)).toMatchObject({ status: "VALIDATED", valid_rows: 2, error_rows: 1, duplicate_rows: 1 });
    const res = await as(w.A.admin, (t) => sql<{ commit_import: { imported: number; duplicates: number; errors: number } }>`SELECT students.commit_import(${id}::uuid)`.execute(t));
    expect(res.rows[0].commit_import).toEqual({ imported: 2, duplicates: 1, errors: 1 });
    expect(await statusOf(id)).toMatchObject({ status: "COMMITTED", imported_rows: 2, valid_rows: 0 });
    expect(await inspect("SELECT 1 FROM students WHERE import_id = $1", [id])).toHaveLength(2);
    // PII hygiene: imported rows no longer hold their raw cells
    expect(await inspect("SELECT 1 FROM student_import_rows WHERE import_id = $1 AND status = 'IMPORTED' AND raw IS NOT NULL", [id])).toHaveLength(0);
    expect(await inspect("SELECT 1 FROM student_import_rows WHERE import_id = $1 AND status = 'ERROR' AND raw IS NOT NULL", [id])).toHaveLength(1);
    expect(dupRow.register_number).toBeTruthy();
  });

  it("never overwrites an existing student: a row that collides at commit time is skipped and the original is untouched", async () => {
    const existing = await mk(w.A.admin, deptA, { name: "Original Name" });
    const [e] = await inspect<{ register_number: string; college_email: string }>("SELECT register_number::text, college_email::text FROM students WHERE id = $1", [existing]);
    const id = await newImport(w.A.admin, 3);
    await validate(w.A.admin, id, [goodRow(1, deptA, { register_number: e.register_number, full_name: "Overwrite Attempt" }), goodRow(2, deptA, { college_email: e.college_email, full_name: "Overwrite Attempt" }), goodRow(3, deptA)]);
    const res = await as(w.A.admin, (t) => sql<{ commit_import: { imported: number; duplicates: number } }>`SELECT students.commit_import(${id}::uuid)`.execute(t));
    expect(res.rows[0].commit_import).toMatchObject({ imported: 1, duplicates: 2 });
    expect((await inspect<{ full_name: string }>("SELECT full_name FROM students WHERE id = $1", [existing]))[0].full_name).toBe("Original Name");
  });

  it("the database re-checks every row at commit: bad data, foreign or inactive departments become row errors, not corrupt records", async () => {
    const inactive = await mkDept(w.A.admin);
    await as(w.A.admin, (t) => sql`SELECT college.set_department_status(${inactive}::uuid, 'INACTIVE')`.execute(t));
    const id = await newImport(w.A.admin, 5);
    await validate(w.A.admin, id, [
      goodRow(1, deptA, { passing_year: 2020 }),            // violates year order
      goodRow(2, deptA, { degree: "Wizardry" }),
      goodRow(3, deptB),                                    // another college's department
      goodRow(4, inactive),
      goodRow(5, deptA),
    ]);
    const res = await as(w.A.admin, (t) => sql<{ commit_import: { imported: number; errors: number } }>`SELECT students.commit_import(${id}::uuid)`.execute(t));
    expect(res.rows[0].commit_import).toMatchObject({ imported: 1, errors: 4 });
  });

  it("cannot be committed twice, before validation, or after cancelling; parallel commits produce one batch", async () => {
    const fresh = await newImport(w.A.admin, 1);
    expect(await code(call(w.A.admin, sql`SELECT students.commit_import(${fresh}::uuid)`))).toBe("22023");     // not validated
    await validate(w.A.admin, fresh, [goodRow(1, deptA)]);
    const results = await Promise.all(Array.from({ length: 5 }, () => code(call(w.A.admin, sql`SELECT students.commit_import(${fresh}::uuid)`))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(await inspect("SELECT 1 FROM students WHERE import_id = $1", [fresh])).toHaveLength(1);
    expect(await code(call(w.A.admin, sql`SELECT students.cancel_import(${fresh}::uuid)`))).toBe("22023");
    const c = await newImport(w.A.admin, 2);
    await call(w.A.admin, sql`SELECT students.cancel_import(${c}::uuid)`);
    expect(await inspect("SELECT 1 FROM student_import_rows WHERE import_id = $1", [c])).toHaveLength(0);   // staged personal data deleted
    expect(await code(validate(w.A.admin, c, []))).toBe("22023");
    expect(await code(call(w.A.admin, sql`SELECT students.commit_import(${c}::uuid)`))).toBe("22023");
  });

  it("validation results must cover the whole file with known statuses", async () => {
    const id = await newImport(w.A.admin, 2);
    expect(await code(validate(w.A.admin, id, [goodRow(1, deptA)]))).toBe("22023");                         // incomplete
    expect(await code(validate(w.A.admin, id, [goodRow(1, deptA), { n: 2, status: "IMPORTED", errors: [], normalized: null }]))).toBe("22023"); // cannot self-declare IMPORTED
    expect(await code(validate(w.A.admin, id, [goodRow(1, deptA), goodRow(2, deptA)]))).toBe("OK");
    expect(await code(validate(w.A.admin, id, [goodRow(1, deptA), goodRow(2, deptA)]))).toBe("OK");         // re-mapping allowed until committed
  });

  it("another college's admin cannot validate, commit or cancel this import", async () => {
    const id = await newImport(w.A.admin, 1);
    expect(await code(validate(w.B.admin, id, [goodRow(1, deptB)]))).toBe("22023");
    expect(await code(call(w.B.admin, sql`SELECT students.commit_import(${id}::uuid)`))).toBe("22023");
    expect(await code(call(w.B.admin, sql`SELECT students.cancel_import(${id}::uuid)`))).toBe("22023");
  });

  it("a 5000-row import commits in reasonable time and every row lands", async () => {
    const dept = await mkDept(w.A.admin);
    const id = await newImport(w.A.admin, 5000);
    const results = Array.from({ length: 5000 }, (_, i) => goodRow(i + 1, dept, { register_number: `BULK${String(i).padStart(5, "0")}${uniq("").slice(1, 4).toUpperCase()}`, college_email: `bulk${i}.${uniq("")}@bulk.example.test` }));
    const t0 = Date.now();
    await validate(w.A.admin, id, results);
    await as(w.A.admin, (t) => sql`SELECT students.commit_import(${id}::uuid)`.execute(t));
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(await statusOf(id)).toMatchObject({ status: "COMMITTED", imported_rows: 5000, error_rows: 0 });
  });
});

describe("suspended college", () => {
  it("loses all student authority, and regains it on reactivation", async () => {
    const cid = await createCollege();
    const admin = await createUser(w.pa, "COLLEGE_ADMIN", cid, "sstu");
    const d = await defaultDepartment(admin, cid);
    const s = await mk(admin, d);
    await as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'SUSPENDED', 'suspended for the test')`.execute(t));
    expect(await code(sql`SELECT students.create_student(${d}::uuid, 'ZZ9999', 'After Suspend', 'z@z.test', null, null, 'B.E.', null, 2022, 2026)`.execute(db()))).toBe(DENIED);
    await as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'ACTIVE', null)`.execute(t));
    expect(await seen(admin)).toContain(s);
  });
});
