# CampusConnect — Master Plan (DRAFT for approval)

Companion: `TECHNICAL_DECISIONS.md` (decision IDs TD-xx / OD-xx referenced below).
Nothing here is built yet. Items marked OPEN are not finalized.

---

## 1. Product requirements (summary)
CampusConnect is a multi-tenant college placement management SaaS for engineering colleges in India. It replaces spreadsheets/forms/WhatsApp with one system covering: college onboarding, departments, students and staff, academic verification, private documents, companies, placement drives, a deterministic eligibility engine, registration, recruitment rounds and results, offers, independently verified placements, reports, in-app notifications, audit, and an optional AI announcement-extraction helper. Full module list per the original brief (Modules 1–21) is **in scope** (TD-01).

Non-negotiables: server-side + DB-level authorization, strict tenant isolation, private documents, deterministic eligibility, selection ≠ offer ≠ acceptance ≠ joining ≠ verified placement, real data only, honest test reporting.

**Scale assumption:** ~3 colleges, ~1000 students each (OD-06). Single Postgres, single app container, one worker.

## 2. Roles and permissions
| Role | Scope | Key powers | Hard limits |
|---|---|---|---|
| PLATFORM_SUPER_ADMIN | Platform | Review/approve/reject colleges, activate/suspend, invite College Admin, platform audit, aggregate stats | No access to student documents/PII beyond aggregates; cannot read tenant rows except via narrow audited functions |
| COLLEGE_ADMIN | One college | Profile, departments, staff, students, imports, invitations, settings, reports | Cannot grant platform roles; cannot approve own college |
| PLACEMENT_OFFICER | One college | Companies, drives, rounds, results, selections, offers, placement verification, announcements | Only publish/release actions by authorized staff |
| COORDINATOR | Assigned departments | Roster, verify/reject academics (reason required), dept reports | Only assigned departments (enforced in RLS) |
| STUDENT | Self | Profile, academics submission, documents, drives, register/withdraw, results (released only), offers | Only own rows; no staff notes; no unreleased results |

Matrix of every action × role will be maintained as an executable test table (Phase 1+).

## 3. MVP scope vs. advanced scope
Per TD-01 the delivered product = all 21 modules, phased. **Advanced / out of scope:** subscription billing, online payments, WhatsApp/SMS automation, advanced AI, enterprise integrations, placement prediction, multi-college identities, placement policy rules (offer caps/tiers), recruiter-side accounts, multi-language.
Email delivery is built last-mile-ready but **off** (TD-12).

## 4. Core workflows
1. **College onboarding:** apply → SUBMITTED → UNDER_REVIEW → APPROVED/REJECTED → manual commercial status (NOT_STARTED/PENDING/ACTIVE/EXPIRED/SUSPENDED) → one-time admin invite link → acceptance creates workspace.
2. **Student provisioning:** individual or CSV (upload → map columns → validate → preview → duplicate detection → row-level errors → commit). Imports never overwrite verified academics.
3. **Academics:** student submits → coordinator verifies/rejects(with reason) → student resubmits; full history.
4. **Drive:** officer drafts → previews → publishes → closes → archives (unpublish allowed with rules).
5. **Eligibility & registration:** engine returns ELIGIBLE/NOT_ELIGIBLE/NEEDS_DATA with reasons; only verified data can be ELIGIBLE (TD-10); backend re-checks deadline, status, duplicates, ownership, concurrency at registration; snapshot stored.
6. **Rounds:** ordered rounds, per-student results (PENDING/SELECTED/REJECTED/ABSENT), editable until release, history kept, release makes visible to students.
7. **Offers:** NOT_ISSUED → ISSUED → ACCEPTED/DECLINED/WITHDRAWN with deadline, private letter, response history, race-safe.
8. **Placement verification:** joining record + evidence → officer verifies → counted as actual placement (TD-11).

## 5. Technology stack (TD-02…TD-16)
Next.js (App Router) + TypeScript + Tailwind; PostgreSQL 16 with RLS; Kysely + SQL migrations; own session auth (argon2id); S3-compatible private storage (MinIO local); Postgres-backed job worker; Vitest + Playwright; Docker.

## 6. System architecture
```
Browser ──HTTPS──> Next.js app (server components, route handlers, server actions)
                      │  1. resolve session cookie -> user, role, college (from DB)
                      │  2. open tx; SET LOCAL app.user_id/college_id/role
                      │  3. run queries as restricted role (RLS enforced)
                      ▼
                 PostgreSQL (app data + auth tables + jobs + audit)
                      ▲
 Worker process ──────┘   (imports, exports, email outbox [off])
 App ──signed URL──> Private object storage (never public)
```
Single source of truth for auth **and** data: PostgreSQL. No client-side DB access, ever.

## 7. Database architecture
Domains: `platform` (colleges, applications, commercial status, platform audit), `identity` (users, sessions, invitations, reset tokens, memberships-as-role-on-user), `academic` (departments, coordinator assignments, students, academic_records, verification_history), `documents`, `placement` (companies, drives, criteria, eligibility_evaluations, registrations, rounds, round_results, result_release, selections, offers, offer_responses, joining_records, placement_verifications), `comms` (notifications, preferences, email_outbox), `audit`. All tenant tables: `college_id NOT NULL`, composite FKs, RLS+FORCE, append-only history tables, status CHECK constraints, version columns where concurrent edits matter.

## 8. Tenant isolation design (TD-03/04)
- Roles: `cc_owner` (migrations only), `cc_app` (runtime, NOBYPASSRLS, minimal grants), `cc_platform` (narrow platform functions).
- Policies: `college_id = current_setting('app.college_id')::uuid` + role/department/self predicates; student policies on `user_id`; coordinator policies via assignment table.
- Tenant-aware FKs prevent cross-tenant references even by buggy code.
- Tests: for each table, user from college A attempts SELECT/INSERT/UPDATE/DELETE on college B rows → must fail; role-escalation tests; unset-context tests (must return zero rows, not all).

## 9. Authentication & authorization (TD-05/06)
Described in TD-06. Authorization is layered: route guard (UX) → server action permission check → DB RLS (authoritative). Frontend role values are never trusted.

## 10. Storage (TD-08)
Private bucket, server-generated keys, validated uploads, ownership + role check before minting ≤5-min signed URL, upload/verification history, offer letters stored under the issuing college prefix.

## 11. API / backend structure
`src/server/{auth,db,modules/<module>/{schema,repo,service,policy,actions}}`, `src/app/(public)|(platform)|(college)|(placement)|(coordinator)|(student)`, `src/lib/eligibility` (pure), `src/worker`, `db/migrations`, `db/tests`. Validation with Zod at every boundary. Consistent safe error shape; no internal details leaked.

## 12. Frontend architecture & design system (TD-16)
Role-specific shells/navigation; reusable Button, Form fields, Table (server pagination/filter), Card, Dialog, Drawer, Tabs, StatusBadge, Filters, Pagination, Skeletons, Empty/Error states, Toasts. Palette: navy/slate nav, white/gray surfaces, indigo primary, green/amber/red states. Responsive desktop→mobile; WCAG-minded (focus, contrast, labels). No control ships without working behavior.

## 13. Notifications (TD-12)
In-app inbox (read/unread, preferences, history, deep links, unread count). Outbox tables + worker designed, disabled. Manual one-time-link flow for invites/resets while email is off.

## 14. AI integration (TD-17, OPEN)
Last phase, optional, server-side only; extracts fields with source-span traceability and flags missing/contradictory/uncertain values; output lands as an editable draft; cannot publish, decide eligibility, release results, or issue offers.

## 15. Testing strategy (TD-15)
Unit (eligibility table/property tests, state machines) · DB integration (RLS, FK tenancy, escalation, privileges, audit immutability) · concurrency (registration, offer response, release) · API authorization tests per role · Playwright flows per role · CSV-injection tests for exports · file-access tests · backup/restore drill · each phase records **actual** command output in `IMPLEMENTATION_STATUS.md`.

## 16. Deployment architecture (TD-14)
Dockerfile for app + worker; managed Postgres with PITR; secrets via environment/secret manager; separate dev/test/prod; migrations run as a separate release step with inspection; HTTPS, security headers, rate limits. Production readiness is reported only after reviewing the real environment.

## 17. Estimated infra cost (assumptions)
~$25–55/month at pilot scale (see TD-14). Excludes domain registration specifics, email (off), AI usage (deferred). Figures are estimates to be re-checked against vendor pricing before purchase.

## 18. Roadmap and acceptance criteria
Each phase ends with a gate: tests written and run, results recorded, risks documented, accepted by you before moving on.

| Phase | Deliverable | Acceptance criteria (abridged) |
|---|---|---|
| 0 | Repo, Docker Compose (Postgres+MinIO), Next.js skeleton, migration runner, CI scripts, design tokens, `IMPLEMENTATION_STATUS.md` | App boots; migrations apply to empty DB and are repeatable; lint/type/test commands pass |
| 1 | Auth, sessions, roles, tenant context wrapper, RLS framework, audit log, rate limiting | Login/logout/expiry work; unset context returns nothing; cross-tenant + escalation tests pass; tokens hashed |
| 2 | Public site + college application + platform admin review/approve/suspend + admin invite | Full onboarding flow end to end; public sign-up cannot set roles; audited |
| 3 | Departments, staff, coordinator assignment, college settings | Dept-scope enforced in DB; tests |
| 4 | Students: create, invite links, CSV import pipeline, search/pagination | Import preview/errors/duplicates; never overwrites verified academics |
| 5 | Academic records + verification workflow + history | Reject requires reason; resubmit flow; coordinator scope tests |
| 6 | Private documents | Ownership + signed-URL tests; no public URLs; validation tests |
| 7 | Companies | CRUD/search/history under RLS |
| 8 | Drives + lifecycle | State machine enforced in DB; only authorized publish |
| 9 | Eligibility engine | Table + property tests; reasons; snapshots; zero-vs-missing tests |
| 10 | Student discovery + registration + withdrawal | Parallel-registration test; deadline/status/ownership enforced |
| 11 | Rounds, results, release, schedules | Students never see unreleased results (DB-level test) |
| 12 | Offers + joining + placement verification | State separation tests; concurrent accept/decline test; accepted ≠ placed in reports |
| 13 | Role portals/dashboards polish | Every control functional; responsive checks |
| 14 | Reports, charts, CSV export (injection-safe), print | Numbers reconcile with raw queries; formula-injection tests |
| 15 | Notifications inbox + prefs; optional AI extraction | Inbox/unread correctness; AI never mutates decisions |
| 16 | Production readiness | Backup-restore drill, security test suite, E2E for all roles, deployment review, DPDP checklist |

## 19. Major risks
RLS gaps/misapplied policies · context leakage through connection pooling (mitigated by `SET LOCAL` in tx) · CSV import side effects · concurrency races on registration/offers · eligibility rule misunderstanding by colleges · manual invite-link handling while email is off · scope size (21 modules) · uploaded-file malware · data-protection obligations (DPDP) · single-region/backup mistakes.

## 20. Remaining questions
OD-01 hosting vendor/region/budget · OD-02 storage provider · **OD-03 confirm manual-link invites/resets** · OD-04 AI provider · OD-05 retention/consent · OD-06 scale wording.

## Approval needed
1. Approve (or change) the RECOMMENDED items in `TECHNICAL_DECISIONS.md`.
2. Answer **OD-03**.
3. Say "approved" to begin **Phase 0**.
