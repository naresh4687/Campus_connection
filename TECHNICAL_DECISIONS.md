# CampusConnect — Technical Decisions

Status legend: **CONFIRMED** (you decided), **RECOMMENDED** (my proposal, awaiting your approval), **OPEN** (undecided; not to be treated as final).

Environment found: Docker 29.9 + Compose v5.6, Node 22, npm 10. No local `psql` (we will use `docker exec`/node clients). Project directory is empty.

---

## TD-01 Scope and delivery — CONFIRMED
- **Selected:** Full 21-module product, delivered in gated phases (see master plan).
- **Alternatives rejected:** thin vertical slice; single-college pilot.
- **Trade-off:** longer timeline; mitigated by hard phase gates (security + DB tests must pass before the next phase).

## TD-02 Platform: Next.js + TypeScript + own PostgreSQL + own auth — CONFIRMED
- **Selected:** One Next.js (App Router) TypeScript app; server-side only data access; PostgreSQL is the single source of truth for both application data and authentication (users, sessions, tokens).
- **Rejected:** Supabase (RLS/service-role-key risk, logic split into DB functions/Edge Functions, auth lock-in); Vite SPA + separate API (two deployables, CORS/auth plumbing).
- **Trade-off:** we build and operate sessions, password reset, backups ourselves in exchange for control, testability and no lock-in.

## TD-03 Tenancy: shared schema + `college_id` + PostgreSQL RLS — RECOMMENDED
- **Selected:** Every tenant table has `college_id`; composite tenant-aware foreign keys `(college_id, id)`; RLS enabled **and FORCED**; app connects as a non-owner, non-superuser role with minimal grants.
- **Rejected:** schema-per-tenant / DB-per-tenant (migration + pooling overhead; unnecessary at 3 colleges).
- **Trade-off:** isolation depends on correct policies → mitigated by automated cross-tenant tests run against the real DB on every change.

## TD-04 Request security context — IMPLEMENTED (Phase 1), revised from the original proposal
- **Selected:** each request runs in a transaction; the server resolves the session and sets **only** `app.user_id` (transaction-local `set_config`). The user's **role and college are derived inside the database** (`app.current_role()` / `app.current_college_id()`, `SECURITY DEFINER`, read from `users`), and become NULL (fail closed) if the user is disabled or the college is suspended. `withTenantTx` additionally verifies the derived values equal the session's and throws `ContextMismatchError` otherwise.
- **Why revised:** the original design let the app set `app.college_id` and `app.role` independently, so a bug or injection could claim "platform admin of college B". Now only user identity is asserted; tests prove forging `app.college_id` / `app.role` has no effect.
- **Remaining limitation (accepted):** code running as `cc_app` can still impersonate a *known user id*. The app server is the trust root for authentication. Mitigations: parameterised queries only, the single `withTenantTx` entry point, least-privilege grants, review.
- **Rejected:** trusting JWT claims or client-supplied tenant IDs.

## TD-05 Identity: one account = one college — CONFIRMED (email uniqueness tightened in Phase 1)
- **`users.email` is globally unique (case-insensitive)**, not per college, because login is by email alone and has no college selector. Platform admins have `college_id NULL` (enforced by CHECK). No cross-college memberships in v1.
- **Accepted trade-off:** a person at two colleges needs two accounts. Can be migrated to global identity + memberships later (a documented, non-trivial migration).

## TD-06 Authentication and sessions — RECOMMENDED
- argon2id password hashing; opaque random session tokens stored **hashed** in DB; HttpOnly + Secure + SameSite=Lax cookie; idle + absolute expiry; revoke-on-password-change; CSRF protection on mutations; login/reset rate limiting (DB-backed counters, no Redis).
- Invitation/reset tokens: 256-bit random, stored as SHA-256 hash, single use, short expiry.
- Public registration can never set a role; roles are set only by invite/provisioning code paths.
- **Implemented in Phase 1:** `@node-rs/argon2` (Argon2id, 19 MiB / t=2 / p=1); session token = 256-bit random, only its SHA-256 stored; cookie `__Host-cc_session` (Secure) in production, `cc_session` only when `AUTH_COOKIE_SECURE=false`; idle timeout 30 min, absolute 12 h (stored per session); sessions die immediately on user disable, college suspension, password reset/change. Login: generic error, one Argon2 verification even for unknown emails (timing), fixed-window rate limits in PostgreSQL (8 attempts/15 min per email; per-IP only when `TRUSTED_PROXY_HOPS` > 0 so a spoofed `X-Forwarded-For` can never be trusted). Origin check on every auth action on top of Next's own Server Action check. Emails/IPs are HMAC'd with `AUTH_PEPPER` before being stored in rate-limit/audit tables. Password policy: 10–128 characters (length-based; no composition rules).
- **Production guards:** the app refuses to start auth code in production with insecure cookies or a development pepper (a narrowly named e2e-only override exists for the browser test server).
- **Baseline response headers:** nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` (tokens travel in URLs), HSTS, Permissions-Policy, CSP limited to `frame-ancestors/base-uri/form-action/object-src`. A strict nonce-based `script-src` is deferred to the production-readiness phase.
- **Rejected:** JWT-in-localStorage; third-party auth providers (second source of truth).

## TD-07 Database access and migrations — RECOMMENDED
- **Selected:** plain, ordered, forward-only **SQL migrations** (own tiny runner or `node-pg-migrate`) + a typed query layer (Kysely) — RLS policies, triggers, constraints are written in raw SQL anyway.
- **Rejected:** Prisma as the primary layer (awkward with per-request `SET LOCAL`, RLS, composite tenant FKs).
- Destructive migrations require your explicit approval; dev/test/prod separated.

## TD-08 Storage — RECOMMENDED
- S3-compatible **private** bucket (MinIO locally; Cloudflare R2 / S3 in prod). Object keys are server-generated (`college/{id}/student/{id}/{uuid}`), never user-supplied. Downloads: DB authorization check → short-lived (≤ 5 min) signed URL. MIME sniffing + size limits + extension allowlist; malware scanning listed as a known gap/optional (ClamAV) for production.
- **Open sub-decision:** production provider (OPEN, see OD-02).
- **Update 2026-11-12 (Phase 6):** MinIO's images could not be pulled. Six candidates were tried; **RustFS** (single binary, credentials from the environment) was chosen for **development** after a behavioural probe confirmed the properties the app relies on: anonymous reads refused (403), signed links work with the forced attachment/content-type, expiry enforced (403), re-pointed keys refused (403), deletion final (404). It is a young project, so it is a dev convenience only. The code speaks plain S3 (AWS SDK v3), so production can use Cloudflare R2 / AWS S3 / Garage unchanged — the production provider is still OD-02.

## TD-09 Concurrency and integrity — RECOMMENDED
- Unique constraints (one registration per student per drive; one active offer per selection), `SELECT … FOR UPDATE` on drive/offer rows, version columns for optimistic updates, state transitions enforced by DB constraints/triggers as well as app code. Concurrency tests (parallel registrations, parallel accept/decline) are a gate.

## TD-10 Eligibility engine — CONFIRMED rules / RECOMMENDED design
- **Confirmed (Q6-A):** only **verified** academic data can yield `ELIGIBLE`. Submitted-but-unverified or missing data ⇒ `NEEDS_DATA` with explicit reason. Missing is never zero. Thresholds inclusive.
- **Design:** pure, side-effect-free, versioned TypeScript function (`engineVersion`), unit-tested with table-driven + property tests; backend re-evaluates at registration inside the registration transaction; an evaluation snapshot (inputs, criteria, result, reasons, engine version) is persisted. No AI involvement.
- Registration therefore requires verified data (no provisional registration in v1).

## TD-11 Placement verification — CONFIRMED (Q7-A)
- Chain is modelled as independent states: **selection → offer issued → accepted/declined → joined → verified placement**. A **Placement Officer** verifies actual placement with required evidence (document + note); **College Admin** can override/revoke. Every transition is audited. Only `verified` counts as an actual placement in reports; accepted offers never do.

## TD-12 Notifications and email — CONFIRMED (Q8-A) with a flagged consequence
- **Confirmed:** v1 is in-app only; transactional email outbox (idempotent, bounded retries, `FOR UPDATE SKIP LOCKED`, honest statuses) is designed in the schema but **disabled** until a provider is chosen.
- **Flagged consequence:** invitations and password resets are normally emailed. With email off, the **inviting admin copies a one-time link** and shares it manually (shown once, never stored in plaintext). Password reset in v1 = an admin-issued one-time reset link for the user (self-service "forgot password" activates when email is turned on). The "Forgot password" page will exist but will say so honestly rather than pretend to send mail.
- **Implemented in Phase 1:** `auth.issue_password_reset` (platform admin → college admins; college admin → officers/coordinators/students of their own college; never self) and `auth.create_invitation` return nothing to the browser; the server shows the one-time link once to the issuing admin. **The admin screens that call them arrive with their modules (Phases 2–4); until then these links can only be produced through the database functions** (used by the tests). "Forgot password" is an honest static page.
- OD-03 was put to you with the Phase 0 approval; I treated your "approved" as acceptance. Say so if that was not your intent.

## TD-13 Background work — RECOMMENDED
- Postgres-backed job table + a small worker process (imports, email outbox when enabled, report exports). No Redis/queue broker.

## TD-14 Hosting and deployment — RECOMMENDED (your "my recommendation")
- **Selected:** managed PostgreSQL (India or nearest region, automated backups + point-in-time recovery) + one container host running the app and a worker, built from Docker images; local dev via Docker Compose (Postgres + MinIO).
- **Estimated cost at pilot scale (assumptions, to be verified at purchase time):** managed Postgres ~$15–25/mo, container host ~$7–20/mo, object storage ~$1–5/mo, domain ~$1/mo, email $0 (off). Roughly **$25–55/month**.
- **Rejected for now:** single VPS with self-managed Postgres (cheaper, but backups/patching become our job with real student data); Kubernetes (unjustified).
- **Open:** exact vendors and region (OD-01).

## TD-15 Testing — RECOMMENDED
- Vitest unit tests; **DB integration tests against real Postgres in Docker** (RLS, cross-tenant, role escalation, FK tenancy, concurrency); Playwright end-to-end per role; backup-restore drill before production. Test data is synthetic only.

## TD-16 UI/design — CONFIRMED defaults (Q10: "nothing")
- No brand assets provided → neutral wordmark "CampusConnect", navy/slate + indigo palette from the brief, English only, Tailwind + a small in-house component library (accessible primitives). Charts via a lightweight library chosen in Phase 0. Domain: none yet.

## TD-17 AI (Module 21) — OPEN
- Deferred to the final phase; optional. Provider/key undecided (OD-04). Server-side only, outputs are drafts, never decisions.

## TD-18 Audit — IMPLEMENTED (Phase 1 foundation)
- Append-only `audit_log`: no UPDATE/DELETE grant to the app role, plus triggers that reject UPDATE/DELETE/TRUNCATE for everyone including the owner. Rows have `scope` (`PLATFORM` | `COLLEGE`) + `college_id`; college admins read only their college's rows, platform admins only platform-scope rows. Direct inserts are RLS-checked (actor, role and tenant cannot be spoofed); security events are written inside the same transaction by the definer functions. Verification, result, offer and placement histories will be separate append-only tables in their phases.
- **Known gap:** a database superuser/DBA can still drop the trigger. Off-box log shipping is a production-readiness item.

## TD-19 Data privacy — OPEN
- DPDP-Act-aware design (purpose limitation, minimal data, retention/deletion, consent notices) is planned; concrete retention periods and a deletion policy need your/college input (OD-05).

---

## TD-20 Privileged-function pattern — IMPLEMENTED (Phase 1)
- Pre-session and credential operations (login lookup, sessions, invitations, resets, bootstrap) are `SECURITY DEFINER` functions in schema `auth`, owned by the NOLOGIN role `cc_auth` (BYPASSRLS, only the exact table grants it needs), with a pinned `search_path` and `EXECUTE` revoked from PUBLIC then granted per function. `cc_app` has **no** privileges on `sessions`, `password_resets`, `rate_limits`, cannot read `users.password_hash`, cannot INSERT/DELETE users, and can UPDATE only its own display name. Each function re-checks the caller's authority from the DB-derived context.
- **Operational requirement:** the role `cc_auth` must exist before migration 0002 (created by `docker/postgres/init`; on a managed database, create it once as an administrator). Migration 0002 fails with a clear message if it is missing.
- **Trade-off:** more SQL to review and test; accepted because it keeps authorisation decisions in the database, where they are testable against real Postgres.

## TD-21 College onboarding model — IMPLEMENTED (Phase 2)
- **Flow:** public application (`platform.submit_application`, anonymous, rate-limited) → `SUBMITTED` → platform admin `start_review` → `UNDER_REVIEW` → `approve` | `reject` (reason required). **Colleges can only be created by approving an application**; the direct INSERT/UPDATE grants on `colleges` were removed. Approval and the one-time College Admin invitation run in **one transaction** (a failed invitation rolls the approval back).
- **State machine is enforced by a database trigger**, not just by the functions: terminal states are frozen, the applicant's submitted details are immutable, rows are never deleted. A platform admin cannot decide an application filed under their own email (conflict of interest).
- **Applicants** get a 256-bit private status link (only its hash is stored). They see status and, if rejected, the reason — nothing else.
- **Two separate switches on a college (decision for you to confirm):** `status` (ACTIVE | SUSPENDED = access) and `commercial_status` (NOT_STARTED | PENDING | ACTIVE | EXPIRED | SUSPENDED = manual commercial record). **Commercial status does NOT block access in v1**; only suspension does. Suspension needs a recorded reason and cuts off every user of the college immediately (sessions stop resolving; RLS context becomes NULL). If you want EXPIRED/commercial-SUSPENDED to block access automatically, say so — it is a small change in the derived-context functions plus tests.
- **Internal notes** (`commercial_note`, `suspended_reason`) are not granted to the runtime role at all; the platform reads them through `platform.college_internal()`.
- **Untrusted text:** applicant fields are validated in the app (Zod) and again by DB CHECKs; websites must be `http(s)` (a `javascript:` URL would become a clickable link in the admin console); all text is rendered by React (escaped) and links are only rendered after `safeHref`.
- **Abuse controls on public forms:** honeypot field, per-email limits, global hourly caps, per-IP limits only when behind a trusted proxy.
- **Platform console:** overview (live aggregate counts, no student data), applications (status filter, search, pagination), college directory, college detail (access, commercial status, administrator invitations), inquiries, append-only platform audit log with filter.
- **Rejected alternatives:** auto-creating the college at submission time (would put unvetted tenants in the database); deriving invitation links from the request `Host` header in production (`APP_BASE_URL` is required instead).

## TD-22 Public website content policy — IMPLEMENTED (Phase 2)
- Copy lives in `src/lib/site-content.ts`. Every feature is labelled **Available now** or **In development**; only built-and-tested capabilities may be "available". **Update that file when a phase ships.** No testimonials, logos, usage figures or partnership claims (an e2e test fails if banned phrases appear).
- Privacy policy and Terms are **drafts** that describe actual behaviour and say they are pending legal review (OD-05). They must be reviewed before any real student data is processed.

## TD-23 Departments, staff and department-scoped access — IMPLEMENTED (Phase 3)
- **Tables:** `departments` (per-college unique name and code, case-insensitive; deactivate, never delete) and `coordinator_assignments` (history kept via `ended_at`/`ended_by`). Both are FORCE-RLS tenant tables with **no INSERT/UPDATE/DELETE grant** for the runtime role; every change goes through an audited function in schema `college` (`create_department`, `update_department`, `set_department_status`, `assign_coordinator`, `unassign_coordinator`, `update_profile`) that requires an active COLLEGE_ADMIN of an active college and always scopes by the caller's DB-derived college.
- **Tenant-aware foreign keys (the pattern for all later tenant tables):** `(college_id, department_id) → departments(college_id, id)` and `(college_id, user_id, user_role) → users(college_id, id, role)` with `user_role = 'COORDINATOR'` fixed by CHECK. The database itself therefore refuses an assignment that crosses colleges or targets a non-coordinator, even if the functions were bypassed (tested by writing as the definer role).
- **Department-scoped RLS:** admins and placement officers read every department of their college; a **coordinator reads only departments with an active assignment to them** (policy subquery on `coordinator_assignments`); students and platform admins read none. The coordinator's page runs `SELECT … FROM departments` with **no WHERE clause** — the database does the scoping, so a forgotten filter in app code cannot leak data. Unassignment takes effect on the next request.
- **Staff management:** college admins invite placement officers and coordinators (`auth.create_invitation`), revoke pending invitations (`auth.revoke_invitation`, new), disable/enable accounts (`auth.set_user_status`; disabling revokes sessions), and issue one-time password-reset links (`auth.issue_password_reset`, 24 h). Admins cannot manage other administrators or themselves from these screens.
- **College profile:** only address, district, state, website, contact person, phone and approximate strength are editable by the college; name, official email, type, access status and commercial data stay platform-owned.
- **Not yet built, by design:** department student counts and department reports (no student data exists until Phase 4/14); pre-assigning departments at invitation time (assign after the coordinator joins); college-level configuration beyond the profile (added when a module needs a setting).
- **Open implication for later phases:** deactivating a department currently has no downstream effect; student, drive and eligibility modules must treat an INACTIVE department as closed to new activity.

## TD-24 Students, CSV import and student accounts — IMPLEMENTED (Phase 4)
- **Records vs accounts:** a `students` row (identity: register number, name, college email, personal email, phone, department, degree from a controlled list, specialization, admission/passing year) exists independently of a login. An account is created only by accepting a one-time invitation **bound to that record** (`invitations.student_id`, enforced by CHECK and a tenant-aware composite FK). Acceptance links `students.user_id` in the same transaction and refuses if the record's email has drifted. **`auth.create_invitation` no longer creates STUDENT invitations at all** (it was the Phase 1 path); students are invited only via `students.invite_student` / `invite_students` (bulk, ≤500, per-student outcomes).
- **Access (RLS):** admin = every student of the college; **coordinator = only students of departments currently assigned to them**; student = only their own record (+ their own department so the profile can render); placement officers and the platform = none (officer access is added with the drive modules). All writes go through audited `students.*` functions; the runtime role has SELECT only. A student can change only phone and personal email (`students.update_own_contact`).
- **Integrity:** register number and college email unique per college (case-insensitive); year/degree/phone/email CHECKs; college email frozen once an account exists, and changing it revokes pending invitations.
- **CSV import is create-only (decision):** an import can never modify an existing student — rows matching an existing register number or email are reported as duplicates and skipped. Updates happen only through the audited edit form. This is how "do not overwrite verified records through an uncontrolled import" is met; academic marks are not part of this import at all.
- **Import pipeline:** upload (route handler: Origin/Fetch-Metadata check, admin-only, ≤2 MB, UTF-8, ≤5000 rows, ≤30 columns, ≤500 chars/cell, rate-limited) → rows staged in `student_import_rows` (no file storage needed) → column mapping with header auto-suggestion → app-side validation and duplicate detection (in-file and against existing students) → preview (counts, filter, pagination) → commit. **Commit re-validates every row inside the database** (department active and in this college, table CHECKs, uniqueness), turns anything wrong into a per-row result instead of corrupt data, locks the import so parallel commits create one batch, and clears the raw cells of imported rows. Cancel deletes the staged personal data. Row-level report is downloadable as CSV.
- **CSV safety:** every exported cell goes through `csvCell` (prefixes `'` to cells beginning `= + - @ TAB CR`, then standard quoting); imported formula-looking text is stored as plain text; markup/control characters are rejected in identity fields; bulk-invite link CSVs use the same function.
- **CSRF note (found in testing):** with `Referrer-Policy: no-referrer` browsers send `Origin: null` on same-origin form posts, so `assertSameOrigin` now falls back to `Sec-Fetch-Site: same-origin` for a missing/`null` Origin; a concrete foreign Origin is always refused, and a cross-site form arrives as `cross-site`.
- **Deferred:** profile photo (needs Phase 6 private storage), personal profile fields beyond contact, officer access, automatic purge of abandoned (never committed/cancelled) imports, department-level student reports (Phase 14).

## TD-25 Academic records and verification — IMPLEMENTED (Phase 5)
- **Append-only, versioned submissions.** Each submission (`academic_submissions`) is an immutable row: CGPA, 10th %, 12th %, diploma %, active backlogs, historical arrears, optional note, plus a snapshot of the student's degree/department/passing year at that moment. A database trigger forbids editing values or the snapshot, forbids illegal status transitions, freezes closed rows and forbids deletes (tested by writing as the definer role).
- **States:** `SUBMITTED → VERIFIED | REJECTED | WITHDRAWN`; `VERIFIED → SUPERSEDED` when a newer submission is verified. Partial unique indexes guarantee **at most one open and at most one verified submission per student**, even under concurrency and even if the functions were bypassed.
- **Verified data is never silently changed.** A student editing verified details creates a *new* submission that needs review. The previously verified record **stays in force** while the update is pending or if it is rejected; it is superseded only when the new one is verified. This is how "cannot modify verified academic details without a review process" is met. Resubmitting values identical to the verified record is refused.
- **Missing is not zero.** 10th % and CGPA are required; the 12th % and diploma % are optional (NULL = not provided, shown as "Not provided") with **at least one required**; active backlogs and historical arrears must be typed explicitly (a blank is an error, "0" is a statement). Two-decimal precision is enforced in the app (text-validated, never rounded) and in the database.
- **Who decides (decision for you to confirm):** only a **coordinator currently assigned to the student's department** can verify or reject (checked inside the function against live assignments; revoking an assignment or moving the student takes effect immediately). Coordinators cannot edit values — they verify or reject with a 5–500 character reason. **College admins have read-only oversight** (counts, per-department progress, per-student history) and **no verification authority**; a student can never verify their own data. Placement officers and the platform see no academic data.
- **Visibility (RLS):** a submission is visible to whoever can see its student (admin: all; coordinator: assigned departments; student: self), reusing the students policies. A `security_invoker` view `student_academic_status` derives NOT_SUBMITTED / PENDING / VERIFIED / REJECTED (+ `update_pending`) under the caller's own RLS; **the eligibility engine (Phase 9) will read the single VERIFIED submission through this model, and only verified data may yield ELIGIBLE (TD-10).**
- **History:** every version is kept with outcome, reviewer name (snapshotted), time, reason and note; all four actions are audited (`ACADEMICS_SUBMITTED/WITHDRAWN/VERIFIED/REJECTED`).
- **Known consequence:** a department with pending submissions but no active coordinator has nobody who can review; the admin overview flags this. There is no admin override by design (see OD-10).
- **Deferred:** supporting documents / mark-sheet evidence (Phase 6), in-app notifications of decisions (Phase 15; students must currently open Academics to see an outcome).

## TD-26 Private documents — IMPLEMENTED (Phase 6)
- **Bytes in private object storage, metadata in PostgreSQL.** The database holds only metadata (kind, sanitised name, sniffed type, size, SHA-256, review state) and a server-generated storage key. The runtime role **cannot read the key column at all**; the app obtains a key only through `documents.storage_key_for()`, which authorises the caller first.
- **Upload (through the server, not browser-to-bucket):** authorise → rate-limit (30/h) → size gate (5 MB) → validate by **content** (PDF/PNG/JPEG magic bytes plus end-marker so truncated or polyglot files are refused; name extension and browser-declared type must agree) → store under `c/<college>/s/<student>/<uuid>` (the student never influences it) → register in the DB, which re-verifies the key is exactly the caller's own prefix → on any failure after storing, the object is removed. Quota 25 active documents per student, serialised under a row lock.
- **Download:** `GET /documents/<id>/download` → DB authorisation → a **60-second signed URL** (forced `attachment` and stored content type) → redirect. Never cached; the bucket is never public; the raw object URL is refused (tested against the real store).
- **Who can read what (RLS + function checks):** a student: their own documents. A **coordinator: only ACTIVE mark sheets / certificates / other documents of students in their CURRENT departments — never résumés.** **College admins, placement officers and the platform: no access at all** (this implements "the platform must not automatically receive student documents"; the admin screens show no documents). Résumé access for officers will be added with the drive modules, scoped to applicants.
- **Transparency:** every access by someone other than the owner is recorded in an append-only `document_events` log (who, role, when) that the **student can see**; upload, delete and review are logged too. The audit log records document activity by *kind only* (no file names).
- **Review:** a coordinator can verify/reject a pending document (reason required to reject; terminal). Résumés need no review.
- **Evidence:** a student can attach their own mark sheets/certificates to an academic submission (`academics.submit` gained `p_document_ids`, ≤10, validated as the student's own, active, right kind, no duplicates). Links are immutable and tied to the same student by composite FKs; **attached evidence cannot be deleted**, preserving the record that a verified value was based on.
- **Deletion:** the record becomes DELETED first (no one can download it), then the bytes are removed and `purged_at` set; if byte removal fails the object is orphaned but unreachable.
- **Honest gaps:** **no malware scanning** (`scan_status` = NOT_SCANNED is shown to students; downloads are forced attachments with `nosniff`, and only PDF/PNG/JPEG are accepted, but a malicious PDF is not detected — ClamAV or a provider scanner is a production item); orphaned objects (crash between store and register, or failed removal) need a periodic reconciliation job that does not exist yet; PDFs are not parsed or sanitised; no image re-encoding; no per-college storage quota; no encryption beyond the provider's at-rest default.

## TD-27 Companies — IMPLEMENTED (Phase 7)
- **`companies`** (per-college unique case-insensitive name; website must be `http(s)`; email/phone/length CHECKs) is written only through `placement.create_company / update_company / set_company_status`, which require a **PLACEMENT_OFFICER** of an active college. The runtime role has SELECT only; rows are never deleted (a trigger plus missing grants); ownership and creation details are immutable.
- **Read access (RLS):** placement officers (manage) and **college admins (read-only oversight)** of the same college. Coordinators, students and the platform see none. (Students and coordinators will see company names through drive data in Phase 8, not through this table.)
- **History:** append-only `company_events` (created / updated / deactivated / reactivated, actor, time). `UPDATED` records **which fields changed, never their values**; a save that changes nothing records nothing. The audit log mirrors it.
- **Deactivation, not deletion.** An inactive company is kept with its history and must be refused for new drives (Phase 8 will enforce this in the drive function).
- **UI safety:** websites render as links only if `http(s)` (with `rel="noopener noreferrer nofollow"`); email as an encoded `mailto:`; description is rendered as text (tested with markup/script).
- **Deferred to Phase 8:** "company placement drives" and "recruitment history" need drives to exist; the company page will gain those sections then rather than show empty placeholders now.

## TD-28 Placement drives — IMPLEMENTED (Phase 8)
- A drive is a company snapshot (`company_name` copied at save) plus criteria (`drive_criteria`: min CGPA/10th/12th/diploma, max active backlogs, max historical arrears, passing years, degrees) and eligible departments. An unset criterion is NULL, never zero.
- Lifecycle DRAFT → PUBLISHED → CLOSED → ARCHIVED (PUBLISHED → DRAFT = unpublish). Enforced by triggers, not the UI: content and criteria are frozen once the drive leaves DRAFT so every student is judged on the same conditions; drives are never deleted.
- Only placement officers write (definer functions); publish lists every missing prerequisite (inactive company, no departments/years, missing openings, past deadline). Students and coordinators see only PUBLISHED/CLOSED drives via RLS; admins have read-only oversight.

## TD-29 Eligibility engine and registration — IMPLEMENTED (Phases 9–10)
- **One implementation, in the database** (`eligibility.evaluate`, engine_version `1`). The app can never ask it about an arbitrary student: students use `check_drive`/`my_drives` (self only), officers get aggregate `drive_counts` only. The raw function is not executable by `cc_app`.
- Rules: only the coordinator-VERIFIED submission counts; thresholds are inclusive; a missing 12th/diploma value when required is NEEDS_DATA, never zero; department, degree and passing year are checked even without academic data (so identity can make a student NOT_ELIGIBLE). Precedence: any failure → NOT_ELIGIBLE, else any missing → NEEDS_DATA, else ELIGIBLE. Every check returns a reason.
- `eligibility_evaluations` is an append-only snapshot (engine version, checks, the verified submission used). `check_drive` records a snapshot only when the outcome changed; `register` always records one.
- **Registration** (`registrations.register`) re-evaluates inside the transaction (never trusts the browser), refuses when the drive is not PUBLISHED, the deadline has passed, or the student is not ELIGIBLE, and serialises on the student row; `UNIQUE (drive_id, student_id)` prevents duplicates. Withdrawal is allowed only while the drive is open; re-registration reuses the row and keeps full event history.
- A drive that has registrations cannot be unpublished (close it instead).
- **OD-11 resolved for registered applicants:** an officer may open the résumé (only the résumé) of a student registered for a drive of their college; every such access is logged and visible to the student. Officers see registered applicants' contact details and the verified numbers they were judged on — nothing else.
- Refused registration attempts are not persisted (the transaction rolls back); the student sees the reasons. Revisit if an attempt log is wanted.

## TD-30 Rounds, results and release — IMPLEMENTED (Phase 11)
- Ordered rounds per drive (1–20) with type, schedule (IST), venue and instructions; only officers write, through definer functions. Rounds exist only for PUBLISHED/CLOSED drives.
- Results (PENDING/SELECTED/REJECTED/ABSENT) can be recorded only after registration has ended (drive closed or deadline passed). Candidates of round 1 = currently registered students; candidates of round k>1 = students SELECTED in the **released** round k-1. Withdrawn or unregistered students can never receive a result.
- Release is one-way and requires a decision for every candidate (PENDING does not count) and the previous round to be released. After release the round and its results are frozen by triggers (not just by the functions).
- **Students see a result only after release, enforced by RLS** (`results_select`), and only their own. They see the schedule of rounds for drives they are registered for. Coordinators see nothing; admins have read-only oversight.
- Every change of decision is appended to `round_result_events` with the staff remark; remarks are staff-only (never in the student-visible row).
- Only the last unreleased round with no results can be deleted.

## TD-31 Selections, offers, joining and verified placements — IMPLEMENTED (Phase 12)
- **Five separate facts**, each recorded separately: round result SELECTED (Phase 11) → final selection → offer ISSUED → ACCEPTED/DECLINED/WITHDRAWN → joining recorded → placement VERIFIED. Only a placement with status VERIFIED (and an accepted offer) counts as a placement; `offers.funnel()` reports all five numbers side by side.
- A selection can be created only for a student SELECTED in the **last** round, and only when **every** round of the drive is released. One selection per student per drive.
- Offer states are enforced by a trigger: NOT_ISSUED → ISSUED | WITHDRAWN; ISSUED → ACCEPTED | DECLINED | WITHDRAWN; ACCEPTED → WITHDRAWN; DECLINED/WITHDRAWN final. The student's answer takes a row lock (a deterministic two-transaction test proves a second answer waits and is refused); answers are final; they are refused after the response deadline. The deadline may only be extended (never shortened) while the offer awaits a response.
- **Offer letters and joining proofs** are private files in their own table (`selection_files`) with their own key prefix (`c/<college>/o/<selection>/<uuid>`); the existing student-document rules are untouched, so coordinators can never reach them. Officers upload letters; students upload joining proof (only after accepting). The storage key column is not readable by the runtime role; downloads go through `offers.file_key_for` (owner, officers, admins) and a 60-second signed link; non-owner access is audited.
- **Joining**: only the student records it (date not in the future, evidence required and must be their own proof for this offer). The placement officer verifies or rejects (reason ≥5 chars); a rejected record can be corrected and resubmitted. **Admin override** (either direction, reason ≥10 chars) is flagged on the record, written to the timeline and the audit log. An offer with a VERIFIED placement cannot be withdrawn until an admin overrides it.
- Coordinators have no access to selections, offers or placements in v1.

## TD-32 Reports, charts, CSV export and print — IMPLEMENTED (Phase 14)
- Reports are **read-only SQL functions** (`reports.*`) for placement officers and college administrators of the college; nothing is stored or cached, so a report can never disagree with the workflows. Definitions: a student is **placed** only with a VERIFIED placement on an ACCEPTED offer; **placement rate** = placed students ÷ students in scope (shown as "—", not 0%, when there are no students); selected excludes withdrawn offers; counts are students, not rows. The year filter is the student's passing year.
- CTC statistics (highest, average, median) are computed over verified placements whose offer stated a CTC; NULL when there is nothing to average.
- Charts are plain HTML/CSS bars with the exact numbers printed beside them and a text alternative (no chart library, no client JavaScript). Print uses CSS (`print:hidden` on navigation, filters and buttons).
- **CSV export** (`/reports/export/<type>`): officers and administrators only (everyone else 403/401), 30 per hour per user, `Cache-Control: no-store`, UTF-8 with BOM. Every cell goes through `csvCell`, which prefixes `'` to values starting with `= + - @ TAB CR`. Each export is written to the audit log (report type and year only, no personal data).
- Coordinators have no reports page in v1 (their dashboard shows participation counts for their own departments).

## TD-33 In-app notifications — IMPLEMENTED (Phase 15)
- Notifications are created **only by database triggers** on the workflow tables (drive publish, round announced/released, selection events, academic submissions and decisions, document reviews). No application code path can forget to send one, and no client can create or edit one (the runtime role has SELECT only; content is immutable; the only change allowed is marking read, once). Each user sees only their own (RLS).
- Recipients are decided in SQL: eligible-by-identity students for a new drive (department, passing year, degree — not academic data), registered students for rounds, the student concerned for offers/decisions, officers for responses and joining records, the department's coordinators for submissions. Disabled users receive nothing; other colleges never.
- Preferences are per category and stored as opt-outs; **offers and placement notifications cannot be turned off** (deadlines and decisions).
- Deep links are relative application paths enforced by a database CHECK (no external URLs); opening a notification goes through `/notifications/<id>/open`, which only works for the owner.
- Not built, by decision TD-12: email/SMS delivery and an email outbox. If email is enabled later, the same triggers are the right place to enqueue messages. No retention/purge job yet (OD-05 retention needs your decision); notifications carry no marks, documents or other sensitive content.
- The unread count in the header is computed on full page loads; after client-side navigation it can lag until the next load (links in the inbox use full loads so it refreshes when you open one).

## TD-34 Optional AI announcement helper (Module 21) — IMPLEMENTED, OFF BY DEFAULT (Phase 15)
- **Purpose and limits:** an officer may paste a company announcement and get a *suggestion* for the draft-drive form. It cannot save, publish, decide eligibility, release results or issue offers: the output only pre-fills the ordinary form; the officer must still review it and click "Create draft", and eligibility is computed by the SQL engine from the criteria the officer saves.
- **The model's output is untrusted.** Each extracted value must carry a verbatim quote; the server checks that the quote really occurs in the pasted text and that the value really occurs in the quote (numbers as whole numbers, enum values via explicit keyword matchers, "no backlogs" via a narrow matcher), then range-checks it. Unsupported or invalid values are dropped and shown as such; missing required fields and the model's own "missing/contradictory/uncertain" flags are listed. Unknown keys the model returns (for example an attempt to set eligibility or publish) are discarded by the schema.
- **Off unless** `AI_EXTRACTION_ENABLED=true` and `ANTHROPIC_API_KEY` are set. `AI_MODEL` (default `claude-sonnet-5-5`) and `AI_API_BASE` are operator configuration. The announcement is sent as data with an instruction-resistant system prompt, no tools, temperature 0, 25 s timeout, 8000-character limit, 20 uses per officer per hour. Text is never logged or stored; the audit log records only counts (characters, fields accepted/ignored).
- **OD-04 (provider) remains open:** the code speaks the Anthropic Messages API shape; choosing another provider means replacing one small file (`src/server/ai/extract.ts`). Data-protection review of sending announcement text to a third party is yours (announcements contain company, not student, data, and the UI warns not to paste student data).

## TD-35 Production hardening — IMPLEMENTED (Phase 16)
- **Strict nonce-based CSP** set per request in `src/proxy.ts` (no inline scripts, no `unsafe-eval`, no external origins, no inline style attributes); every page is rendered per request so the nonce applies. A browser sweep of all roles fails on any violation.
- **Least privilege completed:** the last two direct-write grants of the runtime role (audit-log inserts, self-rename) were removed (migration 0016). `db/tests/catalog-audit.test.ts` now fails if any migration lets the runtime role write a table, leaves a table without forced RLS (unless invisible to it), adds an unpinned or wrongly owned definer function, exposes a function to PUBLIC, or changes the reviewed list of runtime-callable functions.
- **Operations:** backup/restore drill script (with a tamper self-test), read-only storage reconciliation tool, deployment guide, data-protection checklist, container health check. Malware scanning is documented as an approach, not built (OD-02).

## Open decisions register
| ID | Decision | Needed by |
|---|---|---|
| OD-01 | Hosting vendors + region, budget ceiling | before deployment phase |
| OD-02 | Production object-storage provider (dev uses RustFS; app is plain S3 so R2/S3/Garage all fit) and malware-scanning approach | before pilot |
| OD-03 | Confirm manual-link invites/resets while email is off | now (before Phase 1) |
| OD-04 | AI provider and key | before Phase 15 |
| OD-05 | Data retention/deletion policy, student consent text; legal review of the draft Privacy/Terms pages | before pilot |
| OD-07 | Should commercial status EXPIRED/SUSPENDED block college access automatically? (v1: no, manual record only) | before first paying college |
| OD-11 | Should placement officers see student résumés, and from when (v1: no access; planned: only applicants to the officer's own drives)? | Phase 9–10 |
| OD-10 | Should a college admin be able to verify academic records as a fallback when a department has no coordinator? (v1: no — read-only oversight only) | before pilot |
| OD-09 | Retention for staged CSV rows that are neither committed nor cancelled (v1: kept until an admin cancels; no scheduled purge yet) and for import error reports | before pilot |
| OD-08 | How are additional platform administrators created? (v1: only the one-time bootstrap exists; no UI/function to add another) | before pilot |
| OD-06 | Whether "1000 people" = per college or total (no design impact) | informational |
