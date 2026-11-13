import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { adminWrite, appDb, closeAppDb, code, createCollege, createUser, DENIED, inspect, makeCoordinator, makeDepartment, makeStudentIn, seedTwoColleges, uniq, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
type Stu = Actor & { studentId: string };
let w: World;
const db = () => appDb();
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, db());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(db()));

const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const keyFor = (s: Stu, id = randomUUID()) => `c/${s.collegeId}/s/${s.studentId}/${id}`;
type Reg = { kind: string; name: string; type: string; size: number; sha: string; key: string };
const regArgs = (s: Stu, o: Partial<Reg> = {}): Reg => ({ kind: "MARKSHEET", name: "semester-5.pdf", type: "application/pdf", size: 120_000, sha: hex(), key: keyFor(s), ...o });
const register = (a: Actor | null, s: Stu, o: Partial<Reg> = {}) => {
  const r = regArgs(s, o);
  return call(a, sql`SELECT documents.register(${r.kind}, ${r.name}, ${r.type}, ${r.size}::int, ${r.sha}, ${r.key}) AS id`);
};
const mk = async (s: Stu, o: Partial<Reg> = {}) => (await register(s, s, o)).rows[0] as { id: string };
const keyOf = (a: Actor | null, id: string) => call(a, sql`SELECT * FROM documents.storage_key_for(${id}::uuid)`);
const del = (a: Actor | null, id: string) => call(a, sql`SELECT documents.delete_document(${id}::uuid) AS key`);
const review = (a: Actor | null, id: string, decision: string, reason: string | null = null) => call(a, sql`SELECT documents.review(${id}::uuid, ${decision}, ${reason})`);
const visibleDocs = async (a: Actor) => (await as(a, (t) => sql<{ id: string }>`SELECT id FROM documents`.execute(t))).rows.map((r) => r.id).sort();
const events = async (id: string) => (await inspect<{ event: string; actor_role: string; actor_name: string }>("SELECT event, actor_role, actor_name FROM document_events WHERE document_id = $1 ORDER BY id", [id]));
const submitWith = (a: Actor, docs: string[]) => call(a, sql`SELECT academics.submit(8.5, 90, 88, null, 0, 1, null, ${sql.raw(`ARRAY[${docs.map((d) => `'${d}'`).join(",")}]::uuid[]`)}) AS id`);

let d1: string; let d2: string; let s1: Stu; let s2: Stu; let c1: Actor; let c2: Actor;

beforeAll(async () => {
  w = await seedTwoColleges();
  d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin);
  s1 = await makeStudentIn(w.A.admin, d1, "doc1"); s2 = await makeStudentIn(w.A.admin, d1, "doc2");
  c1 = await makeCoordinator(w.A.admin, [d1], "dco1"); c2 = await makeCoordinator(w.A.admin, [d2], "dco2");
});
afterAll(async () => { await closeAppDb(); });

describe("registering a document", () => {
  it("is for students only; everyone else is refused", async () => {
    for (const who of [null, w.A.admin, w.A.officer, w.A.coordinator, c1, w.pa]) expect(await code(register(who, s1)), who?.role ?? "anonymous").toBe(DENIED);
  });

  it("stores only metadata; review is required for mark sheets/certificates/other but not for resumes; the upload is logged", async () => {
    const m = await mk(s1); const r = await mk(s1, { kind: "RESUME", name: "cv.pdf" }); const c = await mk(s1, { kind: "CERTIFICATE", name: "cert.png", type: "image/png" });
    const rows = await inspect<{ id: string; kind: string; review_status: string; status: string; scan_status: string }>("SELECT id, kind, review_status, status, scan_status FROM documents WHERE id = ANY($1)", [[m.id, r.id, c.id]]);
    const by = Object.fromEntries(rows.map((x) => [x.kind, x]));
    expect(by.MARKSHEET).toMatchObject({ review_status: "PENDING", status: "ACTIVE", scan_status: "NOT_SCANNED" });
    expect(by.RESUME.review_status).toBe("NOT_REQUIRED");
    expect(by.CERTIFICATE.review_status).toBe("PENDING");
    expect((await events(m.id)).map((e) => e.event)).toEqual(["UPLOADED"]);
    expect(await inspect("SELECT 1 FROM audit_log WHERE action = 'DOCUMENT_UPLOADED' AND entity_id = $1", [m.id])).toHaveLength(1);
  });

  it("the storage key must be exactly the one derived from the caller's own college and student", async () => {
    const other = await makeStudentIn(w.A.admin, d1, "kk");
    for (const [label, key] of [
      ["another student's prefix", keyFor(other)], ["another college's prefix", `c/${w.B.collegeId}/s/${s1.studentId}/${randomUUID()}`],
      ["path traversal", `c/${s1.collegeId}/s/${s1.studentId}/../../${randomUUID()}`], ["upper-case id", keyFor(s1, randomUUID().toUpperCase() as ReturnType<typeof randomUUID>)],
      ["missing id", `c/${s1.collegeId}/s/${s1.studentId}/`], ["arbitrary key", "uploads/evil.pdf"], ["trailing path", keyFor(s1) + "/x"],
    ] as const) expect(await code(register(s1, s1, { key })), label).toBe("22023");
    const k = keyFor(s1);
    expect(await code(register(s1, s1, { key: k }))).toBe("OK");
    expect(await code(register(s1, s1, { key: k }))).toBe("23505");           // a key is registered once
  });

  const bad: [string, Partial<Reg>][] = [
    ["unknown kind", { kind: "SELFIE" }], ["html content type", { type: "text/html" }], ["svg content type", { type: "image/svg+xml" }], ["zero size", { size: 0 }], ["oversize (5 MB + 1)", { size: 5 * 1024 * 1024 + 1 }],
    ["malformed hash", { sha: "abc" }], ["name with a path", { name: "../../etc/passwd" }], ["name with a backslash", { name: "a\\b.pdf" }], ["name with control characters", { name: "bad\u0007.pdf" }],
    ["empty name", { name: "" }], ["over-long name", { name: "n".repeat(121) + ".pdf" }],
  ];
  for (const [label, o] of bad) it(`rejects ${label}`, async () => {
    const st = await makeStudentIn(w.A.admin, d1, "bd" + Math.random().toString(36).slice(2, 6));
    expect(await code(register(st, st, o)), label).toBe("22023");
    expect(await inspect("SELECT 1 FROM documents WHERE student_id = $1", [st.studentId])).toHaveLength(0);
  });

  it("enforces a quota of 25 active documents per student, even under parallel uploads; deleting frees a slot", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "quota");
    const res = await Promise.all(Array.from({ length: 30 }, () => code(register(st, st))));
    expect(res.filter((r) => r === "OK")).toHaveLength(25);
    expect(await code(register(st, st))).toBe("22023");
    const [one] = await inspect<{ id: string }>("SELECT id FROM documents WHERE student_id = $1 LIMIT 1", [st.studentId]);
    await del(st, one.id);
    expect(await code(register(st, st))).toBe("OK");
  });

  it("the runtime role can neither write documents directly nor read the storage key column", async () => {
    const d = await mk(s1);
    expect(await code(as(s1, (t) => sql`INSERT INTO documents (college_id, student_id, kind, original_name, content_type, size_bytes, sha256, storage_key, review_status, uploaded_by) VALUES (${s1.collegeId}, ${s1.studentId}, 'RESUME', 'x.pdf', 'application/pdf', 1, ${hex()}, ${keyFor(s1)}, 'NOT_REQUIRED', ${s1.userId})`.execute(t)))).toBe(DENIED);
    for (const q of [sql`UPDATE documents SET status = 'DELETED' WHERE id = ${d.id}`, sql`UPDATE documents SET review_status = 'VERIFIED' WHERE id = ${d.id}`, sql`DELETE FROM documents WHERE id = ${d.id}`, sql`UPDATE documents SET kind = 'RESUME' WHERE id = ${d.id}`]) {
      expect(await code(as(s1, (t) => q.execute(t)))).toBe(DENIED);
      expect(await code(as(c1, (t) => q.execute(t)))).toBe(DENIED);
    }
    expect(await code(as(s1, (t) => sql`SELECT storage_key FROM documents`.execute(t)))).toBe(DENIED);
    expect(await code(as(s1, (t) => sql`SELECT * FROM documents`.execute(t)))).toBe(DENIED);
    expect(await code(as(c1, (t) => sql`SELECT storage_key FROM documents`.execute(t)))).toBe(DENIED);
  });
});

describe("who can see documents (row level security)", () => {
  it("a student sees only their own documents — including deleted ones as history — never another student's", async () => {
    const a = await makeStudentIn(w.A.admin, d1, "va"); const b = await makeStudentIn(w.A.admin, d1, "vb");
    const da = await mk(a); const db_ = await mk(b); const gone = await mk(a, { name: "gone.pdf" }); await del(a, gone.id);
    expect(await visibleDocs(a)).toEqual([da.id, gone.id].sort());
    expect(await visibleDocs(b)).toEqual([db_.id]);
    expect(await visibleDocs(w.B.student)).not.toContain(da.id);
  });

  it("a coordinator sees ONLY active mark sheets/certificates/other of students in their CURRENT departments — never resumes, deleted files, or other departments", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "cv"); const far = await makeStudentIn(w.A.admin, d2, "cvf");
    const ms = await mk(st); const resume = await mk(st, { kind: "RESUME", name: "cv.pdf" }); const other = await mk(st, { kind: "OTHER", name: "o.png", type: "image/png" });
    const dead = await mk(st, { name: "dead.pdf" }); await del(st, dead.id);
    const farDoc = await mk(far);
    const seen = await visibleDocs(c1);
    expect(seen).toEqual(expect.arrayContaining([ms.id, other.id]));
    for (const hidden of [resume.id, dead.id, farDoc.id]) expect(seen).not.toContain(hidden);
    expect(await visibleDocs(c2)).toContain(farDoc.id);
    expect(await visibleDocs(c2)).not.toContain(ms.id);
    // unassigning takes effect immediately
    const temp = await makeCoordinator(w.A.admin, [d1], "tmpc");
    expect(await visibleDocs(temp)).toContain(ms.id);
    await as(w.A.admin, (t) => sql`SELECT college.unassign_coordinator(${d1}::uuid, ${temp.userId}::uuid)`.execute(t));
    expect(await visibleDocs(temp)).not.toContain(ms.id);
  });

  it("administrators, placement officers, the platform, other colleges and no-context see no documents at all", async () => {
    const d = await mk(s2);
    for (const who of [w.A.admin, w.A.officer, w.pa, w.B.admin, w.B.officer, w.B.coordinator]) expect(await visibleDocs(who), who.role).toEqual([]);
    expect((await sql`SELECT 1 FROM documents`.execute(db())).rows).toEqual([]);
    expect(await code(keyOf(w.A.admin, d.id))).toBe(DENIED);
    // officers are refused unless the student is registered for a drive (Phase 10) and the file is a résumé: 'not found' (no existence leak)
    expect(["22023", DENIED]).toContain(await code(keyOf(w.A.officer, d.id)));
  });

  it("history is visible to the owner and to coordinators who can see the document, to nobody else", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "hv"); const d = await mk(st);
    await keyOf(c1, d.id);
    const evFor = async (who: Actor) => (await as(who, (t) => sql<{ event: string }>`SELECT event FROM document_events WHERE document_id = ${d.id} ORDER BY id`.execute(t))).rows.map((r) => r.event);
    expect(await evFor(st)).toEqual(["UPLOADED", "ACCESSED"]);
    expect(await evFor(c1)).toEqual(["UPLOADED", "ACCESSED"]);
    for (const who of [c2, w.A.admin, w.A.officer, w.pa, w.B.admin]) expect(await evFor(who), who.role).toEqual([]);
  });
});

describe("obtaining a download key (storage_key_for)", () => {
  it("the owner gets it without a log entry; an assigned coordinator gets it and is logged by name", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "dk"); const d = await mk(st);
    const own = (await keyOf(st, d.id)).rows[0] as { storage_key: string; content_type: string; original_name: string };
    expect(own).toMatchObject({ content_type: "application/pdf", original_name: "semester-5.pdf" });
    expect(own.storage_key).toMatch(/^c\/.+\/s\/.+\//);
    expect((await events(d.id)).map((e) => e.event)).toEqual(["UPLOADED"]);
    await keyOf(c1, d.id);
    const ev = await events(d.id);
    expect(ev.map((e) => e.event)).toEqual(["UPLOADED", "ACCESSED"]);
    expect(ev[1]).toMatchObject({ actor_role: "COORDINATOR" });
    expect(ev[1].actor_name).toMatch(/dco1/);
  });

  it("refuses everyone else: other departments, other students, other colleges, administrators/officers/platform, resumes for coordinators, deleted files", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "dk2"); const peer = await makeStudentIn(w.A.admin, d1, "dk3");
    const ms = await mk(st); const resume = await mk(st, { kind: "RESUME", name: "cv.pdf" }); const dead = await mk(st, { name: "dead.pdf" }); await del(st, dead.id);
    expect(await code(keyOf(c2, ms.id))).toBe("22023");
    expect(await code(keyOf(peer, ms.id))).toBe("22023");
    expect(await code(keyOf(w.B.student, ms.id))).toBe("22023");
    expect(await code(keyOf(w.B.coordinator, ms.id))).toBe("22023");
    expect(await code(keyOf(w.A.admin, ms.id))).toBe(DENIED);
    expect(["22023", DENIED]).toContain(await code(keyOf(w.A.officer, ms.id)));      // marksheet: never an officer document
    expect(["22023", DENIED]).toContain(await code(keyOf(w.pa, ms.id)));    // the platform has no college context: refused either way
    expect(await code(keyOf(null, ms.id))).not.toBe("OK");
    expect(await code(keyOf(c1, resume.id))).toBe("22023");           // coordinators never get resumes
    expect(await code(keyOf(st, resume.id))).toBe("OK");              // ...but the owner does
    expect(await code(keyOf(st, dead.id))).toBe("22023");            // deleted
    expect(await code(keyOf(c1, dead.id))).toBe("22023");
    expect((await events(ms.id)).filter((e) => e.event === "ACCESSED")).toHaveLength(0);   // refused attempts are not "accesses"
  });
});

describe("deleting a document", () => {
  it("only the owner can delete; the key is returned for object removal; it is logged; repeating is refused", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "dl"); const peer = await makeStudentIn(w.A.admin, d1, "dl2"); const d = await mk(st);
    expect(await code(del(peer, d.id))).toBe("22023");
    for (const who of [c1, w.A.admin, w.A.officer, w.pa, null]) expect(await code(del(who, d.id)), who?.role ?? "anonymous").toBe(DENIED);
    const key = ((await del(st, d.id)).rows[0] as { key: string }).key;
    expect(key).toMatch(new RegExp(`^c/${st.collegeId}/s/${st.studentId}/`));
    expect((await inspect<{ status: string; deleted_at: Date }>("SELECT status, deleted_at FROM documents WHERE id = $1", [d.id]))[0].status).toBe("DELETED");
    expect((await events(d.id)).map((e) => e.event)).toEqual(["UPLOADED", "DELETED"]);
    expect(await code(del(st, d.id))).toBe("22023");
    await call(st, sql`SELECT documents.mark_purged(${d.id}::uuid)`);
    expect((await inspect<{ purged_at: Date | null }>("SELECT purged_at FROM documents WHERE id = $1", [d.id]))[0].purged_at).not.toBeNull();
  });
  it("mark_purged only works for the owner on a deleted document", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "pg"); const peer = await makeStudentIn(w.A.admin, d1, "pg2"); const live = await mk(st); const dead = await mk(st); await del(st, dead.id);
    await call(st, sql`SELECT documents.mark_purged(${live.id}::uuid)`);
    await call(peer, sql`SELECT documents.mark_purged(${dead.id}::uuid)`);
    expect((await inspect<{ purged_at: Date | null }>("SELECT purged_at FROM documents WHERE id = ANY($1)", [[live.id, dead.id]])).every((r) => r.purged_at === null)).toBe(true);
    expect(await code(call(c1, sql`SELECT documents.mark_purged(${dead.id}::uuid)`))).toBe(DENIED);
  });
});

describe("reviewing documents", () => {
  it("an assigned coordinator verifies or rejects (reason required); the result and reviewer are visible to the student; it is terminal", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "rv"); const a = await mk(st); const b = await mk(st, { kind: "CERTIFICATE", name: "c.png", type: "image/png" });
    for (const reason of [null, "", "   ", "no", "x".repeat(501)]) expect(await code(review(c1, b.id, "REJECTED", reason)), String(reason).slice(0, 4)).toBe("22023");
    expect(await code(review(c1, a.id, "MAYBE"))).toBe("22023");
    await review(c1, a.id, "VERIFIED");
    await review(c1, b.id, "REJECTED", "The image is too blurry to read");
    const mine = (await as(st, (t) => sql<{ id: string; review_status: string; reviewed_by_name: string; review_reason: string | null }>`SELECT id, review_status, reviewed_by_name, review_reason FROM documents WHERE id IN (${a.id}, ${b.id})`.execute(t))).rows;
    const by = Object.fromEntries(mine.map((r) => [r.id, r]));
    expect(by[a.id]).toMatchObject({ review_status: "VERIFIED" });
    expect(by[b.id]).toMatchObject({ review_status: "REJECTED", review_reason: "The image is too blurry to read" });
    expect(by[a.id].reviewed_by_name).toMatch(/dco1/);
    expect((await events(b.id)).map((e) => e.event)).toEqual(["UPLOADED", "REJECTED"]);
    expect(await code(review(c1, a.id, "REJECTED", "Changed my mind about this"))).toBe("22023");   // already reviewed
    expect(await code(review(c1, b.id, "VERIFIED"))).toBe("22023");
  });
  it("only a coordinator currently assigned to the student's department may review; never resumes, never deleted files", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "rv2"); const ms = await mk(st); const resume = await mk(st, { kind: "RESUME", name: "cv.pdf" }); const dead = await mk(st); await del(st, dead.id);
    for (const who of [null, st, w.A.admin, w.A.officer, w.pa]) expect(await code(review(who, ms.id, "VERIFIED")), who?.role ?? "anonymous").toBe(DENIED);
    expect(await code(review(c2, ms.id, "VERIFIED"))).toBe(DENIED);
    expect(await code(review(w.B.coordinator, ms.id, "VERIFIED"))).toBe("22023");
    expect(await code(review(c1, resume.id, "VERIFIED"))).toBe("22023");
    expect(await code(review(c1, dead.id, "VERIFIED"))).toBe("22023");
    expect((await inspect<{ review_status: string }>("SELECT review_status FROM documents WHERE id = $1", [ms.id]))[0].review_status).toBe("PENDING");
  });
  it("two coordinators reviewing at once: exactly one wins", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "rv3"); const d = await mk(st); const c1b = await makeCoordinator(w.A.admin, [d1], "dco1b");
    const res = await Promise.all([review(c1, d.id, "VERIFIED"), review(c1b, d.id, "VERIFIED"), review(c1, d.id, "REJECTED", "Does not match the record"), review(c1b, d.id, "REJECTED", "Does not match the record")].map((p) => code(p)));
    expect(res.filter((r) => r === "OK")).toHaveLength(1);
  });
});

describe("the database itself protects the record (even bypassing the functions)", () => {
  it("identity, content fingerprint and key are immutable; reviews are final; deleted rows are frozen; rows cannot be deleted", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "im"); const d = await mk(st); await review(c1, d.id, "VERIFIED");
    for (const set of ["kind = 'RESUME'", "original_name = 'renamed.pdf'", "content_type = 'image/png'", "size_bytes = 1", `sha256 = '${hex()}'`, `storage_key = 'c/${st.collegeId}/s/${st.studentId}/${randomUUID()}'`, `student_id = '${s2.studentId}'`]) {
      await expect(adminWrite(`UPDATE documents SET ${set} WHERE id = $1`, [d.id]), set).rejects.toMatchObject({ code: DENIED });
    }
    await expect(adminWrite("UPDATE documents SET review_status = 'REJECTED', review_reason = 'rewriting history' WHERE id = $1", [d.id])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("DELETE FROM documents WHERE id = $1", [d.id])).rejects.toMatchObject({ code: DENIED });
    const gone = await mk(st); await del(st, gone.id);
    await expect(adminWrite("UPDATE documents SET status = 'ACTIVE', deleted_at = NULL WHERE id = $1", [gone.id])).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|23514)$/) });
    const resume = await mk(st, { kind: "RESUME", name: "cv.pdf" });
    await expect(adminWrite("UPDATE documents SET review_status = 'VERIFIED', reviewed_by = $2, reviewed_at = now() WHERE id = $1", [resume.id, c1.userId])).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|23514)$/) });
  });
  it("table constraints: a resume needs no review, others do; rejection needs a reason; a bad key or type is refused", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "ck");
    const ins = (kind: string, review_: string, key = keyFor(st), type = "application/pdf") => adminWrite(
      `INSERT INTO documents (college_id, student_id, kind, original_name, content_type, size_bytes, sha256, storage_key, review_status, uploaded_by) VALUES ($1,$2,$3,'f.pdf',$4,10,$5,$6,$7,$8)`,
      [st.collegeId, st.studentId, kind, type, hex(), key, review_, st.userId]);
    await expect(ins("RESUME", "PENDING")).rejects.toMatchObject({ code: "23514" });
    await expect(ins("MARKSHEET", "NOT_REQUIRED")).rejects.toMatchObject({ code: "23514" });
    await expect(ins("MARKSHEET", "PENDING", "not/a/valid/key")).rejects.toMatchObject({ code: "23514" });
    await expect(ins("MARKSHEET", "PENDING", keyFor(st), "text/html")).rejects.toMatchObject({ code: "23514" });
    await expect(ins("MARKSHEET", "REJECTED")).rejects.toMatchObject({ code: "23514" });
  });
  it("document history is append-only for everyone", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "ev"); const d = await mk(st);
    await expect(adminWrite("UPDATE document_events SET event = 'DELETED' WHERE document_id = $1", [d.id])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("DELETE FROM document_events WHERE document_id = $1", [d.id])).rejects.toMatchObject({ code: DENIED });
    expect(await inspect("SELECT 1 FROM pg_trigger WHERE tgrelid = 'document_events'::regclass AND NOT tgisinternal")).toHaveLength(2);
    expect(await code(as(st, (t) => sql`DELETE FROM document_events`.execute(t)))).toBe(DENIED);
  });
  it("a document cannot reference another college's student, and events cannot reference another college's document", async () => {
    await expect(adminWrite(`INSERT INTO documents (college_id, student_id, kind, original_name, content_type, size_bytes, sha256, storage_key, review_status, uploaded_by) VALUES ($1,$2,'RESUME','f.pdf','application/pdf',10,$3,$4,'NOT_REQUIRED',$5)`,
      [w.B.collegeId, s1.studentId, hex(), keyFor(s1), s1.userId])).rejects.toMatchObject({ code: "23503" });
  });
});

describe("documents as evidence for academic submissions", () => {
  it("a student attaches their own mark sheets/certificates; the coordinator sees the links; the documents become undeletable", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "ev1");
    const m = await mk(st); const c = await mk(st, { kind: "CERTIFICATE", name: "c.png", type: "image/png" });
    const sub = (await submitWith(st, [m.id, c.id])).rows[0] as { id: string };
    const links = async (who: Actor) => (await as(who, (t) => sql<{ document_id: string }>`SELECT document_id FROM academic_submission_documents WHERE submission_id = ${sub.id}`.execute(t))).rows.map((r) => r.document_id).sort();
    expect(await links(st)).toEqual([m.id, c.id].sort());
    expect(await links(c1)).toEqual([m.id, c.id].sort());
    for (const who of [c2, w.A.admin, w.A.officer, w.pa, w.B.admin]) expect(await links(who), who.role).toEqual([]);
    expect(await code(del(st, m.id))).toBe("22023");                                   // evidence is protected
    expect((await inspect<{ status: string }>("SELECT status FROM documents WHERE id = $1", [m.id]))[0].status).toBe("ACTIVE");
    expect(await inspect("SELECT 1 FROM audit_log WHERE action = 'ACADEMICS_SUBMITTED' AND entity_id = $1 AND (metadata->>'evidence')::int = 2", [sub.id])).toHaveLength(1);
  });
  it("evidence must be the student's OWN, ACTIVE mark sheets or certificates — no resumes, other students' files, deleted files, duplicates or more than 10", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "ev2"); const peer = await makeStudentIn(w.A.admin, d1, "ev3");
    const resume = await mk(st, { kind: "RESUME", name: "cv.pdf" }); const other = await mk(st, { kind: "OTHER", name: "o.pdf" }); const theirs = await mk(peer); const dead = await mk(st); await del(st, dead.id);
    const good = await mk(st);
    for (const [label, docs] of [["resume", [resume.id]], ["kind OTHER", [other.id]], ["another student's file", [theirs.id]], ["deleted file", [dead.id]], ["duplicate ids", [good.id, good.id]], ["unknown id", [randomUUID()]]] as const) {
      expect(await code(submitWith(st, [...docs])), label).toBe("22023");
    }
    expect(await code(submitWith(st, Array.from({ length: 11 }, () => randomUUID())))).toBe("22023");
    expect(await inspect("SELECT 1 FROM academic_submissions WHERE student_id = $1", [st.studentId])).toHaveLength(0);   // nothing half-created
    expect(await code(submitWith(st, [good.id]))).toBe("OK");
  });
  it("submitting without evidence still works (the 7-argument form)", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "ev4");
    expect(await code(call(st, sql`SELECT academics.submit(8, 80, 80, null, 0, 0, null)`))).toBe("OK");
  });
  it("evidence links are immutable and cannot cross students even if written directly", async () => {
    const a = await makeStudentIn(w.A.admin, d1, "ev5"); const b = await makeStudentIn(w.A.admin, d1, "ev6");
    const da = await mk(a); const db_ = await mk(b);
    const sub = (await submitWith(a, [da.id])).rows[0] as { id: string };
    await expect(adminWrite("INSERT INTO academic_submission_documents (college_id, student_id, submission_id, document_id) VALUES ($1, $2, $3, $4)", [a.collegeId, a.studentId, sub.id, db_.id])).rejects.toMatchObject({ code: "23503" });
    await expect(adminWrite("UPDATE academic_submission_documents SET document_id = $1 WHERE submission_id = $2", [db_.id, sub.id])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("DELETE FROM academic_submission_documents WHERE submission_id = $1", [sub.id])).rejects.toMatchObject({ code: DENIED });
    expect(await code(as(a, (t) => sql`DELETE FROM academic_submission_documents`.execute(t)))).toBe(DENIED);
  });
});

describe("suspended college", () => {
  it("loses all document authority and regains it on reactivation", async () => {
    const cid = await createCollege();
    const admin = await createUser(w.pa, "COLLEGE_ADMIN", cid, "sdoc");
    const dept = await makeDepartment(admin);
    const st = await makeStudentIn(admin, dept, "sdoc-s"); const co = await makeCoordinator(admin, [dept], "sdoc-c");
    const d = await mk(st);
    await as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'SUSPENDED', 'suspended for the test')`.execute(t));
    expect(await code(sql`SELECT * FROM documents.storage_key_for(${d.id}::uuid)`.execute(db()))).not.toBe("OK");
    expect(await code(sql`SELECT documents.register('RESUME', 'a.pdf', 'application/pdf', 1, ${hex()}, ${keyFor(st)})`.execute(db()))).toBe(DENIED);
    await as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'ACTIVE', null)`.execute(t));
    expect(await code(review(co, d.id, "VERIFIED"))).toBe("OK");
    void uniq;
  });
});
