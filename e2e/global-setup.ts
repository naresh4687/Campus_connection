import { writeFileSync } from "node:fs";
import { portalOfRole } from "../src/lib/portals";
import { sql } from "kysely";
import { withTenantTx } from "../src/server/db";
import { hashPassword } from "../src/server/auth/password";
import { hashToken, newToken } from "../src/server/auth/tokens";
import resetAndMigrate from "../db/tests/global-setup";
import { appDb, closeAppDb, createCollege, createStudentRecord, createUser, defaultDepartment, inspect, studentInput, submitApplication, type Actor } from "../db/tests/world";
import { withOwner } from "../db/tests/helpers";
import { startAiStub } from "./ai-stub";

/** Synthetic data only. Rebuilds the *_test database and seeds one college per scenario through the real flows. */
export default async function globalSetup() {
  const aiStub = await startAiStub(3199);          // stand-in for the AI provider (test infrastructure only)
  await (await import("../src/server/storage/s3")).ensureBucket();
  await resetAndMigrate();
  const pw = (n: string) => `Synthetic-${n}-Passw0rd!`;
  const hashes = new Map<string, string>();
  const h = async (n: string) => (hashes.has(n) ? hashes.get(n)! : (hashes.set(n, await hashPassword(pw(n))), hashes.get(n)!));

  const paId = await withOwner(async (c) => (await c.query("SELECT auth.bootstrap_platform_admin($1,$2,$3) AS id", ["platform@e2e.test", "Pat Platform", await h("platform")])).rows[0].id as string);
  const pa: Actor = { userId: paId, collegeId: null, role: "PLATFORM_SUPER_ADMIN", email: "platform@e2e.test" };

  const collegeA = await createCollege("Northfield Institute of Technology");
  const collegeB = await createCollege("Riverside College of Engineering");
  const mk = async (inviter: Actor, role: "COLLEGE_ADMIN" | "PLACEMENT_OFFICER" | "COORDINATOR" | "STUDENT", college: string, key: string) =>
    createUser(inviter, role, college, key, await h(key), `${key}@e2e.test`);

  const adminA = await mk(pa, "COLLEGE_ADMIN", collegeA, "adminA");
  const users: Record<string, string> = { platform: "platform@e2e.test", adminA: adminA.email };
  for (const [key, role] of [["officerA", "PLACEMENT_OFFICER"], ["coordA", "COORDINATOR"], ["studentA", "STUDENT"], ["changepw", "STUDENT"], ["resetme", "STUDENT"], ["lockme", "STUDENT"], ["expiring", "STUDENT"], ["studentX", "STUDENT"], ["officerX", "PLACEMENT_OFFICER"], ["acadA", "STUDENT"], ["acadB", "STUDENT"], ["docA", "STUDENT"], ["docB", "STUDENT"]] as const) {
    users[key] = (await mk(adminA, role, collegeA, key)).email;
  }
  const adminB = await mk(pa, "COLLEGE_ADMIN", collegeB, "adminB");
  users.adminB = adminB.email;
  users.officerB = (await mk(adminB, "PLACEMENT_OFFICER", collegeB, "officerB")).email;
  // Accounts for the separate-sign-in-pages spec, in a college of their own so the counts the other specs check stay as they expect.
  const collegeC = await createCollege("Sign-in Pages College");
  const adminC = await mk(pa, "COLLEGE_ADMIN", collegeC, "adminC");
  users.pageStudent = (await mk(adminC, "STUDENT", collegeC, "pageStudent")).email;
  users.pageStaff = (await mk(adminC, "PLACEMENT_OFFICER", collegeC, "pageStaff")).email;
  // The multi-tab scenarios (one browser, several roles at once) have their own accounts, so their sign-ins do not use up others' limits.
  users.tabAdmin = (await mk(pa, "COLLEGE_ADMIN", collegeC, "tabAdmin")).email;
  users.tabOfficer = (await mk(adminC, "PLACEMENT_OFFICER", collegeC, "tabOfficer")).email;
  users.tabStudent = (await mk(adminC, "STUDENT", collegeC, "tabStudent")).email;
  // The installable-app and push scenarios have a college of their own, so no other spec's counts or sign-in budgets are touched.
  const collegeP = await createCollege("Installable App College");
  const adminP = await mk(pa, "COLLEGE_ADMIN", collegeP, "pwaAdmin");
  users.pwaAdmin = adminP.email;
  for (const k of ["pwaStudent", "pwaStudent2"]) users[k] = (await mk(adminP, "STUDENT", collegeP, k)).email;
  users.pwaOfficer = (await mk(adminP, "PLACEMENT_OFFICER", collegeP, "pwaOfficer")).email;

  // Registration scenarios live in their own department (REG) with their own coordinator, so earlier specs' fixtures are untouched.
  // regA: verified & strong, regB: verified & weak, regC: nothing verified.
  const regDept = (await withTenantTx(adminA, (t) => sql<{ id: string }>`SELECT college.create_department('Registration Studies', 'REG', null) AS id`.execute(t), appDb())).rows[0].id;
  users.regAdmin = (await mk(pa, "COLLEGE_ADMIN", collegeA, "regAdmin")).email;      // its own login budget (sign-ins are throttled per account)
  const regCoord = await mk(adminA, "COORDINATOR", collegeA, "regCoord");
  users.regCoord = regCoord.email;
  await withTenantTx(adminA, (t) => sql`SELECT college.assign_coordinator(${regDept}::uuid, ${regCoord.userId}::uuid)`.execute(t), appDb());
  const annCoord = await mk(adminA, "COORDINATOR", collegeA, "annCoord");               // the announcements spec has its own accounts (sign-ins are throttled per account)
  users.annCoord = annCoord.email;
  await withTenantTx(adminA, (t) => sql`SELECT college.assign_coordinator(${regDept}::uuid, ${annCoord.userId}::uuid)`.execute(t), appDb());
  const extCoord = await mk(adminA, "COORDINATOR", collegeA, "extCoord");                 // the external-registration spec has its own accounts too
  users.extCoord = extCoord.email;
  await withTenantTx(adminA, (t) => sql`SELECT college.assign_coordinator(${regDept}::uuid, ${extCoord.userId}::uuid)`.execute(t), appDb());
  const secCoord = await mk(adminA, "COORDINATOR", collegeA, "secCoord");                 // the security and layout sweeps log in often: their own sign-in budget
  users.secCoord = secCoord.email;
  await withTenantTx(adminA, (t) => sql`SELECT college.assign_coordinator(${regDept}::uuid, ${secCoord.userId}::uuid)`.execute(t), appDb());
  const partCoord = await mk(adminA, "COORDINATOR", collegeA, "partCoord");               // the participation spec's own accounts
  users.partCoord = partCoord.email;
  await withTenantTx(adminA, (t) => sql`SELECT college.assign_coordinator(${regDept}::uuid, ${partCoord.userId}::uuid)`.execute(t), appDb());
  users.partOfficer = (await mk(adminA, "PLACEMENT_OFFICER", collegeA, "partOfficer")).email;
  users.pwOfficer = (await mk(adminA, "PLACEMENT_OFFICER", collegeA, "pwOfficer")).email;           // approves the password-change test
  users.extOfficer = (await mk(adminA, "PLACEMENT_OFFICER", collegeA, "extOfficer")).email;
  users.extOfficerB = (await mk(adminB, "PLACEMENT_OFFICER", collegeB, "extOfficerB")).email;
  users.annOfficer = (await mk(adminA, "PLACEMENT_OFFICER", collegeA, "annOfficer")).email;
  users.roundOfficer = (await mk(adminA, "PLACEMENT_OFFICER", collegeA, "roundOfficer")).email;
  users.offerOfficer = (await mk(adminA, "PLACEMENT_OFFICER", collegeA, "offerOfficer")).email;
  users.rptOfficer = (await mk(adminA, "PLACEMENT_OFFICER", collegeA, "rptOfficer")).email;
  users.rptAdmin = (await mk(pa, "COLLEGE_ADMIN", collegeA, "rptAdmin")).email;   // own login budget for the rounds spec
  for (const [key, cgpa] of [["regA", 8.5], ["regB", 5.5], ["regC", 0], ["regD", 8], ["offA", 8], ["offB", 8], ["rptA", 8], ["rptB", 8], ["ntfA", 8], ["annA", 8], ["extA", 8], ["extB", 8], ["partA", 8], ["partB", 8], ["profA", 8]] as const) {
    const st = await mk(adminA, "STUDENT", collegeA, key);
    users[key] = st.email;
    const [r] = await inspect<{ register_number: string; full_name: string; college_email: string; degree: string; admission_year: number; passing_year: number }>(
      "SELECT register_number::text AS register_number, full_name, college_email::text AS college_email, degree, admission_year, passing_year FROM students WHERE id = $1", [st.studentId]);
    await withTenantTx(adminA, (t) => sql`SELECT students.update_student(${st.studentId}::uuid, ${regDept}::uuid, ${r.register_number}, ${r.full_name}, ${r.college_email}, null, null, ${r.degree}, null, ${r.admission_year}, ${r.passing_year})`.execute(t), appDb());
    if (key === "regC") continue;
    const id = (await withTenantTx(st, (t) => sql<{ id: string }>`SELECT academics.submit(${cgpa}::numeric, 80, 80, null, 0, 0, null) AS id`.execute(t), appDb())).rows[0].id;
    await withTenantTx(regCoord, (t) => sql`SELECT academics.verify(${id}::uuid, null)`.execute(t), appDb());
  }

  // A pending invitation (for the accept flow) and a pending password reset (for the reset flow).
  const inviteToken = newToken();
  const gen = await defaultDepartment(adminA, collegeA);
  const newcomer = await createStudentRecord(adminA, studentInput(gen, { name: "New Comer", email: "newcomer@e2e.test", register: "NEWC0001" }));
  await withTenantTx(adminA, (t) => sql`SELECT students.invite_student(${newcomer}::uuid, ${hashToken(inviteToken)}, 3600)`.execute(t), appDb());
  const resetToken = newToken();
  const row = (await inspect<{ id: string }>("SELECT id FROM users WHERE email = $1", ["resetme@e2e.test"]))[0];
  await withTenantTx(adminA, (t) => sql`SELECT auth.issue_password_reset(${row.id}::uuid, ${hashToken(resetToken)}, 3600)`.execute(t), appDb());
  const expiredToken = newToken();
  const late = await createStudentRecord(adminA, studentInput(gen, { name: "Late Comer", email: "late@e2e.test", register: "LATE0001" }));
  await withTenantTx(adminA, (t) => sql`SELECT students.invite_student(${late}::uuid, ${hashToken(expiredToken)}, 600)`.execute(t), appDb());
  await withOwner(async (c) => { await c.query("BEGIN"); await c.query("SET LOCAL ROLE cc_auth"); await c.query("UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE email = 'late@e2e.test'"); await c.query("COMMIT"); });

  // Applications for the onboarding scenarios (submitted through the same database function the public form uses).
  const zephyr = await submitApplication({ name: "Zephyr Institute of Technology", email: "principal@zephyr.e2e.test" });
  const quartz = await submitApplication({ name: "Quartz College of Engineering", email: "principal@quartz.e2e.test" });
  for (let i = 1; i <= 17; i++) await submitApplication({ name: `Paginated College ${String(i).padStart(2, "0")}`, email: `principal${i}@paginated.e2e.test` });

  // Which sign-in page each account uses (each kind of user has their own; see src/lib/portals.ts).
  const roles = new Map((await inspect<{ email: string; role: string }>("SELECT lower(email::text) AS email, role FROM users")).map((r) => [r.email, r.role]));
  const portal = Object.fromEntries(Object.entries(users).map(([k, email]) => {
    const p = portalOfRole(roles.get(email.toLowerCase()) ?? "");
    if (!p) throw new Error(`global-setup: no role found for test account ${k} (${email})`);
    return [k, p];
  }));

  await closeAppDb();
  writeFileSync("e2e/.seed.json", JSON.stringify({ users, portal, password: Object.fromEntries([...hashes.keys()].map((k) => [k, pw(k)])), inviteToken, resetToken, expiredToken, zephyrRef: zephyr.token, quartzRef: quartz.token }, null, 2));
  return async () => { await new Promise<void>((r) => aiStub.close(() => r())); };
}
