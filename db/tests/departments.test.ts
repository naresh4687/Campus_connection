import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { hashToken, newToken } from "../../src/server/auth/tokens";
import { adminWrite, appDb, closeAppDb, code, createUser, DENIED, emailFor, inspect, seedTwoColleges, uniq, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World;
const db = () => appDb();
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, db());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(db()));
const code4 = () => uniq("D").slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, "X");

async function mkDept(admin: Actor, name = uniq("Dept"), c = code4(), desc: string | null = null) {
  const r = await as(admin, (t) => sql<{ id: string }>`SELECT college.create_department(${name}, ${c}, ${desc}) AS id`.execute(t));
  return { id: r.rows[0].id, name, code: c.toUpperCase() };
}
const assign = (a: Actor | null, dept: string, user: string) => call(a, sql`SELECT college.assign_coordinator(${dept}::uuid, ${user}::uuid)`);
const unassign = (a: Actor | null, dept: string, user: string) => call(a, sql`SELECT college.unassign_coordinator(${dept}::uuid, ${user}::uuid)`);
const visibleDepts = async (a: Actor) => (await as(a, (t) => sql<{ id: string }>`SELECT id FROM departments ORDER BY id`.execute(t))).rows.map((r) => r.id).sort();

beforeAll(async () => { w = await seedTwoColleges(); });
afterAll(async () => { await closeAppDb(); });

describe("who can write departments and assignments", () => {
  it("only a college admin of that college may use any department function (every other caller refused)", async () => {
    const d = await mkDept(w.A.admin);
    const calls = (who: Actor | null): [string, () => Promise<unknown>][] => [
      ["create", () => call(who, sql`SELECT college.create_department(${uniq("X")}, ${code4()}, null)`)],
      ["update", () => call(who, sql`SELECT college.update_department(${d.id}::uuid, 'Renamed', 'RNM', null)`)],
      ["status", () => call(who, sql`SELECT college.set_department_status(${d.id}::uuid, 'INACTIVE')`)],
      ["assign", () => assign(who, d.id, w.A.coordinator.userId)],
      ["unassign", () => unassign(who, d.id, w.A.coordinator.userId)],
      ["profile", () => call(who, sql`SELECT college.update_profile('1 New Road', 'Dist', 'Kerala', 'https://x.test', 'Person', '9876543210', 100)`)],
    ];
    for (const who of [null, w.A.officer, w.A.coordinator, w.A.student, w.pa]) {
      for (const [name, run] of calls(who)) expect(await code(run()), `${who?.role ?? "anonymous"} -> ${name}`).toBe(DENIED);
    }
    expect((await inspect<{ name: string }>("SELECT name FROM departments WHERE id = $1", [d.id]))[0].name).toBe(d.name);
  });

  it("the runtime role cannot INSERT/UPDATE/DELETE departments or assignments directly, even as the admin", async () => {
    const d = await mkDept(w.A.admin);
    expect(await code(as(w.A.admin, (t) => sql`INSERT INTO departments (college_id, name, code) VALUES (${w.A.collegeId}, 'Sneaky', 'SNK')`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.A.admin, (t) => sql`UPDATE departments SET name = 'Hacked' WHERE id = ${d.id}`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.A.admin, (t) => sql`DELETE FROM departments WHERE id = ${d.id}`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.A.admin, (t) => sql`INSERT INTO coordinator_assignments (college_id, department_id, user_id, assigned_by) VALUES (${w.A.collegeId}, ${d.id}, ${w.A.coordinator.userId}, ${w.A.admin.userId})`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.A.admin, (t) => sql`UPDATE coordinator_assignments SET ended_at = now()`.execute(t)))).toBe(DENIED);
  });

  it("a college admin cannot touch another college's departments or coordinators", async () => {
    const dB = await mkDept(w.B.admin);
    expect(await code(call(w.A.admin, sql`SELECT college.update_department(${dB.id}::uuid, 'Stolen', 'STL', null)`))).toBe("22023");
    expect(await code(call(w.A.admin, sql`SELECT college.set_department_status(${dB.id}::uuid, 'INACTIVE')`))).toBe("22023");
    expect(await code(assign(w.A.admin, dB.id, w.B.coordinator.userId))).toBe("22023");           // other college's department
    const dA = await mkDept(w.A.admin);
    expect(await code(assign(w.A.admin, dA.id, w.B.coordinator.userId))).toBe("22023");           // other college's coordinator
    expect(await code(unassign(w.A.admin, dB.id, w.B.coordinator.userId))).toBe("22023");
    expect((await inspect<{ name: string; status: string }>("SELECT name, status FROM departments WHERE id = $1", [dB.id]))[0]).toMatchObject({ name: dB.name, status: "ACTIVE" });
  });
});

describe("tenant-aware foreign keys (enforced by the database even if the functions were bypassed)", () => {
  it("an assignment cannot link a department of one college to a user of another", async () => {
    const dA = await mkDept(w.A.admin);
    await expect(adminWrite("INSERT INTO coordinator_assignments (college_id, department_id, user_id, assigned_by) VALUES ($1, $2, $3, $4)",
      [w.A.collegeId, dA.id, w.B.coordinator.userId, w.A.admin.userId])).rejects.toMatchObject({ code: "23503" });
    await expect(adminWrite("INSERT INTO coordinator_assignments (college_id, department_id, user_id, assigned_by) VALUES ($1, $2, $3, $4)",
      [w.B.collegeId, dA.id, w.B.coordinator.userId, w.B.admin.userId])).rejects.toMatchObject({ code: "23503" });   // dept is A's, claimed under B
  });
  it("only a COORDINATOR can be assigned: officers, students and admins are refused", async () => {
    const dA = await mkDept(w.A.admin);
    for (const u of [w.A.officer, w.A.student, w.A.admin]) {
      await expect(adminWrite("INSERT INTO coordinator_assignments (college_id, department_id, user_id, assigned_by) VALUES ($1, $2, $3, $4)",
        [w.A.collegeId, dA.id, u.userId, w.A.admin.userId])).rejects.toMatchObject({ code: "23503" });
      expect(await code(assign(w.A.admin, dA.id, u.userId))).toBe("22023");
    }
    await expect(adminWrite("INSERT INTO coordinator_assignments (college_id, department_id, user_id, user_role, assigned_by) VALUES ($1, $2, $3, 'STUDENT', $4)",
      [w.A.collegeId, dA.id, w.A.student.userId, w.A.admin.userId])).rejects.toMatchObject({ code: "23514" });
  });
  it("a department must belong to a real college", async () => {
    await expect(adminWrite("INSERT INTO departments (college_id, name, code) VALUES (gen_random_uuid(), 'Ghost', 'GHO')")).rejects.toMatchObject({ code: "23503" });
  });
});

describe("department data rules", () => {
  it("names and codes are unique per college (case-insensitive) but may repeat across colleges", async () => {
    const d = await mkDept(w.A.admin, uniq("Computer Science"), "CSE" + code4().slice(0, 3));
    expect(await code(mkDept(w.A.admin, d.name.toUpperCase(), code4()))).toBe("23505");
    expect(await code(mkDept(w.A.admin, uniq("Other"), d.code.toLowerCase()))).toBe("23505");
    expect(await code(mkDept(w.B.admin, d.name, d.code))).toBe("OK");
  });
  it("validates name, code format and description length at the database", async () => {
    for (const [n, c] of [["X", "OKCODE"], ["Valid Name", "a"], ["Valid Name", "-BAD"], ["Valid Name", "HAS SPACE"], ["Valid Name", "WAYTOOLONGCODE1"], ["N".repeat(101), "OKC"]] as const) {
      expect(await code(mkDept(w.A.admin, n, c)), `${n}/${c}`).toBe("23514");
    }
    expect(await code(mkDept(w.A.admin, uniq("D"), code4(), "x".repeat(501)))).toBe("23514");
  });
  it("stores codes upper-cased and trims names", async () => {
    const r = await as(w.A.admin, (t) => sql<{ id: string }>`SELECT college.create_department(${"  " + uniq("Trim") + "  "}, ${"  ab-" + code4().slice(0, 4).toLowerCase() + " "}, ${"   "}) AS id`.execute(t));
    const [row] = await inspect<{ name: string; code: string; description: string | null }>("SELECT name::text AS name, code::text AS code, description FROM departments WHERE id = $1", [r.rows[0].id]);
    expect(row.name).toBe(row.name.trim());
    expect(row.code).toBe(row.code.toUpperCase());
    expect(row.description).toBeNull();
  });
  it("update, deactivate and reactivate; repeating a status is refused", async () => {
    const d = await mkDept(w.A.admin);
    await as(w.A.admin, (t) => sql`SELECT college.update_department(${d.id}::uuid, ${d.name + " Updated"}, ${d.code}, 'New description')`.execute(t));
    expect((await inspect<{ name: string; description: string }>("SELECT name::text AS name, description FROM departments WHERE id = $1", [d.id]))[0]).toEqual({ name: d.name + " Updated", description: "New description" });
    await as(w.A.admin, (t) => sql`SELECT college.set_department_status(${d.id}::uuid, 'INACTIVE')`.execute(t));
    expect(await code(call(w.A.admin, sql`SELECT college.set_department_status(${d.id}::uuid, 'INACTIVE')`))).toBe("22023");
    expect(await code(call(w.A.admin, sql`SELECT college.set_department_status(${d.id}::uuid, 'DELETED')`))).toBe("22023");
    await as(w.A.admin, (t) => sql`SELECT college.set_department_status(${d.id}::uuid, 'ACTIVE')`.execute(t));
    const acts = (await inspect<{ action: string }>("SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY id", [d.id])).map((r) => r.action);
    expect(acts).toEqual(["DEPARTMENT_CREATED", "DEPARTMENT_UPDATED", "DEPARTMENT_DEACTIVATED", "DEPARTMENT_REACTIVATED"]);
  });
  it("departments are never hard-deleted by anyone with runtime privileges", async () => {
    const d = await mkDept(w.A.admin);
    expect(await code(as(w.A.admin, (t) => sql`DELETE FROM departments WHERE id = ${d.id}`.execute(t)))).toBe(DENIED);
  });
});

describe("department-scoped visibility (row level security)", () => {
  it("admins and officers see every department of their own college and none of another's", async () => {
    const a1 = await mkDept(w.A.admin); const a2 = await mkDept(w.A.admin); const b1 = await mkDept(w.B.admin);
    for (const who of [w.A.admin, w.A.officer]) {
      const seen = await visibleDepts(who);
      expect(seen).toEqual(expect.arrayContaining([a1.id, a2.id]));
      expect(seen).not.toContain(b1.id);
    }
    expect(await visibleDepts(w.B.admin)).not.toContain(a1.id);
    expect(await visibleDepts(w.B.officer)).not.toContain(a1.id);
  });

  it("a coordinator sees ONLY the departments currently assigned to them, and loses sight immediately on unassignment", async () => {
    const coord = await createUser(w.A.admin, "COORDINATOR", w.A.collegeId, "scoped");
    const d1 = await mkDept(w.A.admin); const d2 = await mkDept(w.A.admin); const d3 = await mkDept(w.A.admin);
    expect(await visibleDepts(coord)).toEqual([]);
    await assign(w.A.admin, d1.id, coord.userId);
    await assign(w.A.admin, d2.id, coord.userId);
    expect(await visibleDepts(coord)).toEqual([d1.id, d2.id].sort());
    expect(await visibleDepts(coord)).not.toContain(d3.id);
    await unassign(w.A.admin, d1.id, coord.userId);
    expect(await visibleDepts(coord)).toEqual([d2.id]);
    // direct access by id to an unassigned department returns nothing, not an error that leaks existence
    expect((await as(coord, (t) => sql`SELECT * FROM departments WHERE id = ${d1.id}`.execute(t))).rows).toEqual([]);
  });

  it("a coordinator sees their own assignment rows only; another coordinator's are invisible", async () => {
    const c1 = await createUser(w.A.admin, "COORDINATOR", w.A.collegeId, "c1"); const c2 = await createUser(w.A.admin, "COORDINATOR", w.A.collegeId, "c2");
    const d = await mkDept(w.A.admin);
    await assign(w.A.admin, d.id, c1.userId); await assign(w.A.admin, d.id, c2.userId);
    const rows = async (a: Actor) => (await as(a, (t) => sql<{ user_id: string }>`SELECT user_id FROM coordinator_assignments`.execute(t))).rows.map((r) => r.user_id);
    expect(await rows(c1)).toEqual([c1.userId]);
    expect(await rows(c2)).toEqual([c2.userId]);
    expect((await rows(w.A.admin))).toEqual(expect.arrayContaining([c1.userId, c2.userId]));
    expect(await rows(w.B.admin)).not.toEqual(expect.arrayContaining([c1.userId]));
  });

  it("an inactive department stays visible to its assigned coordinator (flagged inactive), but cannot receive new assignments", async () => {
    const coord = await createUser(w.A.admin, "COORDINATOR", w.A.collegeId, "inact"); const other = await createUser(w.A.admin, "COORDINATOR", w.A.collegeId, "inact2");
    const d = await mkDept(w.A.admin);
    await assign(w.A.admin, d.id, coord.userId);
    await as(w.A.admin, (t) => sql`SELECT college.set_department_status(${d.id}::uuid, 'INACTIVE')`.execute(t));
    expect((await as(coord, (t) => sql<{ status: string }>`SELECT status FROM departments WHERE id = ${d.id}`.execute(t))).rows).toEqual([{ status: "INACTIVE" }]);
    expect(await code(assign(w.A.admin, d.id, other.userId))).toBe("22023");
  });

  it("platform admins see no departments or assignments; a student sees only their OWN department and no assignments", async () => {
    await mkDept(w.A.admin);
    expect(await visibleDepts(w.pa)).toEqual([]);
    expect((await as(w.pa, (t) => sql`SELECT 1 FROM coordinator_assignments`.execute(t))).rows).toEqual([]);
    const own = async (who: Actor) => (await inspect<{ department_id: string }>("SELECT department_id FROM students WHERE user_id = $1", [who.userId])).map((r) => r.department_id);
    for (const who of [w.A.student, w.B.student]) {
      expect(await visibleDepts(who)).toEqual(await own(who));
      expect((await as(who, (t) => sql`SELECT 1 FROM coordinator_assignments`.execute(t))).rows).toEqual([]);
    }
  });

  it("without any context nothing is visible", async () => {
    expect((await sql`SELECT 1 FROM departments`.execute(db())).rows).toEqual([]);
    expect((await sql`SELECT 1 FROM coordinator_assignments`.execute(db())).rows).toEqual([]);
  });
});

describe("assignment rules and history", () => {
  it("prevents duplicate active assignments, allows re-assignment after ending, and keeps the history", async () => {
    const coord = await createUser(w.A.admin, "COORDINATOR", w.A.collegeId, "hist"); const d = await mkDept(w.A.admin);
    await assign(w.A.admin, d.id, coord.userId);
    expect(await code(assign(w.A.admin, d.id, coord.userId))).toBe("23505");
    expect(await code(unassign(w.A.admin, d.id, w.A.officer.userId))).toBe("22023");
    await unassign(w.A.admin, d.id, coord.userId);
    expect(await code(unassign(w.A.admin, d.id, coord.userId))).toBe("22023");
    await assign(w.A.admin, d.id, coord.userId);
    const rows = await inspect<{ ended_at: Date | null; ended_by: string | null }>("SELECT ended_at, ended_by FROM coordinator_assignments WHERE department_id = $1 AND user_id = $2 ORDER BY assigned_at", [d.id, coord.userId]);
    expect(rows).toHaveLength(2);
    expect(rows[0].ended_at).not.toBeNull();
    expect(rows[0].ended_by).toBe(w.A.admin.userId);
    expect(rows[1].ended_at).toBeNull();
  });

  it("refuses to assign a disabled account or a non-existent department/user", async () => {
    const coord = await createUser(w.A.admin, "COORDINATOR", w.A.collegeId, "dis"); const d = await mkDept(w.A.admin);
    await as(w.A.admin, (t) => sql`SELECT auth.set_user_status(${coord.userId}::uuid, 'DISABLED')`.execute(t));
    expect(await code(assign(w.A.admin, d.id, coord.userId))).toBe("22023");
    expect(await code(call(w.A.admin, sql`SELECT college.assign_coordinator(gen_random_uuid(), ${w.A.coordinator.userId}::uuid)`))).toBe("22023");
    expect(await code(call(w.A.admin, sql`SELECT college.assign_coordinator(${d.id}::uuid, gen_random_uuid())`))).toBe("22023");
  });

  it("assignment events are audited and visible only to that college's admin", async () => {
    const coord = await createUser(w.A.admin, "COORDINATOR", w.A.collegeId, "aud"); const d = await mkDept(w.A.admin);
    await assign(w.A.admin, d.id, coord.userId); await unassign(w.A.admin, d.id, coord.userId);
    const seen = async (a: Actor) => (await as(a, (t) => sql<{ action: string }>`SELECT action FROM audit_log WHERE entity_id = ${d.id} ORDER BY id`.execute(t))).rows.map((r) => r.action);
    expect(await seen(w.A.admin)).toEqual(["DEPARTMENT_CREATED", "COORDINATOR_ASSIGNED", "COORDINATOR_UNASSIGNED"]);
    expect(await seen(w.B.admin)).toEqual([]);
    expect(await seen(w.A.officer)).toEqual([]);
  });

  it("parallel duplicate operations resolve safely: one department per code, one active assignment", async () => {
    const c = code4();
    const made = await Promise.all(Array.from({ length: 6 }, () => code(mkDept(w.A.admin, uniq("Race"), c))));
    expect(made.filter((r) => r === "OK")).toHaveLength(1);
    expect(made.filter((r) => r === "23505")).toHaveLength(5);
    const coord = await createUser(w.A.admin, "COORDINATOR", w.A.collegeId, "race"); const d = await mkDept(w.A.admin);
    const assigned = await Promise.all(Array.from({ length: 6 }, () => code(assign(w.A.admin, d.id, coord.userId))));
    expect(assigned.filter((r) => r === "OK")).toHaveLength(1);
    expect(await inspect("SELECT 1 FROM coordinator_assignments WHERE department_id = $1 AND ended_at IS NULL", [d.id])).toHaveLength(1);
  });
});

describe("college profile (editable by the college, within limits)", () => {
  const edit = (a: Actor | null, over: Partial<Record<"address" | "district" | "state" | "website" | "person" | "phone", string>> & { students?: number } = {}) =>
    call(a, sql`SELECT college.update_profile(${over.address ?? "5 Updated Lane, Town"}, ${over.district ?? "Madurai"}, ${over.state ?? "Tamil Nadu"}, ${over.website ?? "https://updated.example.test"},
      ${over.person ?? "Dr Updated"}, ${over.phone ?? "+91 90000 11111"}, ${over.students ?? 2000})`);

  it("updates only the allowed fields of the admin's own college and audits it", async () => {
    const before = (await inspect<{ name: string; official_email: string; status: string; commercial_status: string }>("SELECT name, official_email::text AS official_email, status, commercial_status FROM colleges WHERE id = $1", [w.A.collegeId]))[0];
    await edit(w.A.admin, { district: "Salem", students: 3333 });
    const after = (await inspect<{ name: string; official_email: string; status: string; commercial_status: string; district: string; approx_students: number }>("SELECT name, official_email::text AS official_email, status, commercial_status, district, approx_students FROM colleges WHERE id = $1", [w.A.collegeId]))[0];
    expect(after).toMatchObject({ district: "Salem", approx_students: 3333, name: before.name, official_email: before.official_email, status: before.status, commercial_status: before.commercial_status });
    const other = (await inspect<{ district: string }>("SELECT district FROM colleges WHERE id = $1", [w.B.collegeId]))[0];
    expect(other.district).not.toBe("Salem");
    expect(await inspect("SELECT 1 FROM audit_log WHERE action = 'COLLEGE_PROFILE_UPDATED' AND college_id = $1", [w.A.collegeId])).not.toHaveLength(0);
  });

  it("rejects invalid values, including non-web website schemes", async () => {
    for (const over of [{ website: "javascript:alert(1)" }, { website: "ftp://x.test" }, { phone: "abc" }, { students: 3 }, { students: 99999999 }, { address: "x" }, { person: "" }, { district: " " }]) {
      expect(await code(edit(w.A.admin, over)), JSON.stringify(over)).toBe("22023");
    }
  });

  it("cannot be edited by the platform admin or any other role through this function", async () => {
    for (const who of [w.pa, w.A.officer, w.A.coordinator, w.A.student, null]) expect(await code(edit(who))).toBe(DENIED);
  });

  it("college name, email, status and commercial fields cannot be changed directly by the college", async () => {
    for (const col of ["name = 'X Renamed'", "official_email = 'x@y.test'", "status = 'ACTIVE'", "commercial_status = 'ACTIVE'", "district = 'Direct'"]) {
      expect(await code(as(w.A.admin, (t) => sql.raw(`UPDATE colleges SET ${col} WHERE id = '${w.A.collegeId}'`).execute(t))), col).toBe(DENIED);
    }
  });
});

describe("invitation revocation", () => {
  const invite = (a: Actor, email: string, role: string, college: string, token = newToken()) =>
    as(a, (t) => sql`SELECT auth.create_invitation(${email}, ${role}, ${college}::uuid, ${hashToken(token)}, 3600)`.execute(t));
  const pending = async (email: string) => (await inspect<{ id: string }>("SELECT id FROM invitations WHERE email = $1 AND accepted_at IS NULL AND revoked_at IS NULL", [email]))[0]?.id;

  it("a college admin can revoke a pending staff invitation, which can then no longer be accepted", async () => {
    const email = emailFor("rev"); const token = newToken();
    await invite(w.A.admin, email, "PLACEMENT_OFFICER", w.A.collegeId, token);
    const id = await pending(email);
    await as(w.A.admin, (t) => sql`SELECT auth.revoke_invitation(${id}::uuid)`.execute(t));
    expect(await code(sql`SELECT * FROM auth.accept_invitation(${hashToken(token)}, 'X', '$argon2id$v=19$m=19456,t=2,p=1$ZmFrZQ$ZmFrZQ')`.execute(db()))).toBe("P0001");
    expect(await code(call(w.A.admin, sql`SELECT auth.revoke_invitation(${id}::uuid)`))).toBe("22023"); // already revoked
  });
  it("only the right actor may revoke: not other colleges, not non-admins, not for college-admin invites, and the platform only for those", async () => {
    const staffEmail = emailFor("rev2"); const adminEmail = emailFor("rev3");
    await invite(w.A.admin, staffEmail, "COORDINATOR", w.A.collegeId);
    await invite(w.pa, adminEmail, "COLLEGE_ADMIN", w.B.collegeId);
    const staffInv = await pending(staffEmail); const adminInv = await pending(adminEmail);
    for (const who of [w.B.admin, w.A.officer, w.A.coordinator, w.A.student, w.pa]) expect(await code(call(who, sql`SELECT auth.revoke_invitation(${staffInv}::uuid)`)), `${who.role} revoking staff invite`).toBe(DENIED);
    for (const who of [w.A.admin, w.B.admin, w.A.officer]) expect(await code(call(who, sql`SELECT auth.revoke_invitation(${adminInv}::uuid)`)), `${who.role} revoking admin invite`).toBe(DENIED);
    expect(await code(call(null, sql`SELECT auth.revoke_invitation(${staffInv}::uuid)`))).toBe(DENIED);
    expect(await code(call(w.pa, sql`SELECT auth.revoke_invitation(${adminInv}::uuid)`))).toBe("OK");
    expect(await code(call(w.A.admin, sql`SELECT auth.revoke_invitation(${staffInv}::uuid)`))).toBe("OK");
  });
});

describe("a suspended college loses all department authority", () => {
  it("admin functions and reads stop working while suspended and resume after reactivation", async () => {
    const { createCollege } = await import("./world");
    const cid = await createCollege();
    const admin = await createUser(w.pa, "COLLEGE_ADMIN", cid, "susp3");
    const d = await mkDept(admin);
    await as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'SUSPENDED', 'suspended for the test')`.execute(t));
    await expect(as(admin, async () => 1)).rejects.toThrow(/does not match/);
    expect(await code(sql`SELECT college.create_department('After', 'AFT', null)`.execute(db()))).toBe(DENIED);
    await as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'ACTIVE', null)`.execute(t));
    expect(await visibleDepts(admin)).toEqual([d.id]);
  });
});

describe("coordinator invitations name a department", () => {
  const FAKE_HASH = "$argon2id$v=19$m=19456,t=2,p=1$ZmFrZQ$ZmFrZQ";
  const inviteTo = (a: Actor | null, email: string, role: string, college: string, dept: string | null, token = newToken()) =>
    call(a, sql`SELECT auth.create_staff_invitation(${email}, ${role}, ${college}::uuid, ${hashToken(token)}, 3600, ${dept}::uuid)`);
  const activeAssignments = async (user: string) =>
    (await inspect<{ department_id: string }>("SELECT department_id FROM coordinator_assignments WHERE user_id = $1 AND ended_at IS NULL", [user])).map((r) => r.department_id);

  it("accepting a coordinator invitation assigns the chosen department in the same step, and the audit log records it", async () => {
    const d = await mkDept(w.A.admin); const email = emailFor("cdept"); const token = newToken();
    await inviteTo(w.A.admin, email, "COORDINATOR", w.A.collegeId, d.id, token);
    const peek = await sql<{ d: string }>`SELECT auth.peek_invitation_department(${hashToken(token)}) AS d`.execute(db());
    expect(peek.rows[0].d).toBe(d.name);
    const r = await sql<{ user_id: string }>`SELECT * FROM auth.accept_invitation(${hashToken(token)}, 'New Coordinator', ${FAKE_HASH})`.execute(db());
    expect(await activeAssignments(r.rows[0].user_id)).toEqual([d.id]);
    const audit = await inspect<{ n: string }>("SELECT count(*)::text AS n FROM audit_log WHERE action = 'COORDINATOR_ASSIGNED' AND entity_id = $1", [d.id]);
    expect(Number(audit[0].n)).toBeGreaterThanOrEqual(1);
  });

  it("a coordinator invitation without a department, or with another college's or an inactive department, is refused", async () => {
    const own = await mkDept(w.A.admin); const other = await mkDept(w.B.admin); const off = await mkDept(w.A.admin);
    await as(w.A.admin, (t) => sql`SELECT college.set_department_status(${off.id}::uuid, 'INACTIVE')`.execute(t));
    expect(await code(inviteTo(w.A.admin, emailFor("nd1"), "COORDINATOR", w.A.collegeId, null))).toBe("22023");
    expect(await code(inviteTo(w.A.admin, emailFor("nd2"), "COORDINATOR", w.A.collegeId, other.id))).toBe("22023");
    expect(await code(inviteTo(w.A.admin, emailFor("nd3"), "COORDINATOR", w.A.collegeId, off.id))).toBe("22023");
    expect(await code(inviteTo(w.A.admin, emailFor("nd4"), "COORDINATOR", w.A.collegeId, own.id))).toBe("OK");
  });

  it("only coordinator invitations may name a department, and only a college admin may use the function", async () => {
    const d = await mkDept(w.A.admin);
    expect(await code(inviteTo(w.A.admin, emailFor("od1"), "PLACEMENT_OFFICER", w.A.collegeId, d.id))).toBe("22023");
    expect(await code(inviteTo(w.A.admin, emailFor("od2"), "PLACEMENT_OFFICER", w.A.collegeId, null))).toBe("OK");
    for (const who of [null, w.A.officer, w.A.coordinator, w.A.student]) {
      expect(await code(inviteTo(who, emailFor("od3"), "COORDINATOR", w.A.collegeId, d.id)), `${who?.role ?? "anonymous"}`).toBe(DENIED);
    }
  });

  it("if the department is deactivated before the invitation is accepted, the account is still created, just unassigned", async () => {
    const d = await mkDept(w.A.admin); const email = emailFor("cdeact"); const token = newToken();
    await inviteTo(w.A.admin, email, "COORDINATOR", w.A.collegeId, d.id, token);
    await as(w.A.admin, (t) => sql`SELECT college.set_department_status(${d.id}::uuid, 'INACTIVE')`.execute(t));
    const r = await sql<{ user_id: string }>`SELECT * FROM auth.accept_invitation(${hashToken(token)}, 'Late Coordinator', ${FAKE_HASH})`.execute(db());
    expect(await activeAssignments(r.rows[0].user_id)).toEqual([]);
  });
});
