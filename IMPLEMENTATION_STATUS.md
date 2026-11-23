# CampusConnect — Implementation Status

Last updated: 2026-11-19. All results below are from commands actually run in this repository.

## Phase summary
| Phase | Name | Status |
|---|---|---|
| 0 | Foundation | **Accepted** |
| 1 | Auth, sessions, tenant context, RLS framework, audit, rate limiting | **Accepted** |
| 2 | Public website, college onboarding, platform admin console | **Accepted** |
| 3 | Departments, staff, coordinator assignment, college profile, College Admin console | **Accepted** |
| 4 | Students: records, invitations, CSV import, department-scoped access, student profile | **Accepted** |
| 5 | Academic records and verification workflow | **Accepted** |
| 6 | Private documents (storage, upload, signed downloads, review, evidence) | **Accepted** |
| 7 | Companies (placement officer portal's first module) | **Implemented and verified** (you asked to continue without per-phase acceptance) |
| 8 | Placement drives and lifecycle | **Implemented and verified** |
| 9 | Eligibility engine | **Implemented and verified** |
| 10 | Student drive discovery, registration, withdrawal, officer applicant view | **Implemented and verified** |
| 11 | Rounds, results, schedules, release | **Implemented and verified** |
| 12 | Selections, offers, offer letters, joining and verified placements | **Implemented and verified** |
| 13 | Role dashboards and responsive checks | **Implemented and verified** |
| 14 | Reports, charts, CSV export, print | **Implemented and verified** |
| 15 | In-app notifications; optional AI announcement helper | **Implemented and verified** (AI: verified against a stand-in provider only — see below) |
| 16 | Production readiness (CSP, security suite, backup drill, reconciliation, deployment and data-protection documents) | **Implemented and verified locally; real-environment items remain (see below)** |

## 2026-11-23 — Installable app, Web Push, email-ready channels

Migration `0039_push.sql` (not yet applied to any real database). Details: `PWA_IMPLEMENTATION.md`, `PUSH_NOTIFICATIONS.md`.

**Built:** web app manifest, icons from the logo mark, a small service worker (offline page and static assets only; nothing private is ever cached), install card (Chromium prompt, iOS instructions), update banner, `/app` start route; push subscriptions (per device, endpoint allowlist), an outbox (`push_jobs`) filled by a trigger on `notifications`, a dispatcher (`/api/push/dispatch`, `npm run push:worker`, GitHub Action `push-worker.yml`) with retries, expiry handling and delivery-time preference checks; generic push wording; preferences and device management; sign-out cleanup. Email: nothing was ever sent; wording that implied an email service was reworded, `src/server/email` and `channels.ts` are the single seam for a future provider (email stays unavailable).

**Verification (actual):** `npm run lint` clean (1 pre-existing warning), `tsc` clean, unit + database tests 949 passed (includes 26 new database tests and 17 unit tests for push), new browser spec `e2e/pwa-push.spec.ts` 19 passed.

**Not verified / not built:** delivery through the real push services and real Android/iOS/Edge/Firefox devices (the browser tests replace only `PushManager.subscribe`); push for College Administrator and Platform Administrator events, eligibility-change and registration-confirmation notifications (they have no inbox notification today); no cron is configured in `vercel.json`. The full browser regression was started after these changes; its result is not recorded here.

## 2026-11-19 — Announcements composer, canonical identifiers, external registration with screenshot evidence

Migrations `0029_identifier_normalization.sql` and `0030_external_registration.sql` (both applied to the development database; the test database is rebuilt from them).

**What was built**
- *Announcements (stage 1-2 of the composer):* server actions, pages for officers, coordinators and students, a pattern-based classifier that suggests a destination with quoted reasons and never routes without confirmation, and a "Create placement update" composer. Coordinators cannot reach drive creation from it. **Not built yet:** field extraction for announcements (dates, venues, stages, batches), the candidate-list attachment matcher, attachments, scheduled publishing and email delivery.
- *Canonical identifiers:* `src/lib/normalize.ts` (one place for the rule) and a database trigger that upper-cases register numbers on every write. Names, emails, URLs and message text are untouched. The existing case-insensitive unique key already made case-only duplicates impossible, so the backfill found no conflicts; if one ever exists, `app.identifier_conflicts()` lists it and nothing is changed until it is reconciled (`npm run db:normalize`). Decided join requests are never rewritten.
- *External registration:* a drive has a registration method (internal one-click, or the company's own form). Opening the link is only an intent (`PENDING_EXTERNAL`); a screenshot makes the CampusConnect registration `REGISTERED` with the evidence `SUBMITTED_PENDING_REVIEW`. Only a reviewing officer or the student's department coordinator can mark it verified; rejection needs a reason; replacements keep every version; a late screenshot needs a staff exception. Files are private (signed 60-second links, every view audited), validated by content (PNG/JPEG/WebP). Retention: `npx tsx scripts/purge-evidence.ts [--months 12] [--apply]` (dry run by default).

**Verification (actual)**
| Check | Result |
|---|---|
| `npm run lint`, `npm run typecheck` | clean |
| Unit tests | 323 passed |
| Database tests (real PostgreSQL) | 553 passed (includes 6 identifier and 15 external-registration tests) |
| Browser suite, one full run | 340 passed, 1 failed (head-counts in `college.spec.ts` that my new test accounts changed), 18 not run behind it. After correcting the two numbers, `college.spec.ts` alone: 19 passed. I did not repeat the whole suite after that fix. |

**Honest notes**
1. Migration 0028 (announcements) had a regex Postgres rejects (`{3,500}`), so saving an announcement with a link failed. Applied migrations are never edited, so 0030 repairs the constraint and the function; there is a browser regression for it.
2. React resets a form after its action runs, which blanked controlled fields after a refused save (found by the tests). The announcement editor and the registration-method form now submit through a transition.
3. The AI drive-intake evaluation (`eval/`) shows the 1.5B model adding nothing measurable over the pattern layer (identical scores, about 44 s per extraction on CPU). A 3-4B comparison and a larger dataset were **not** done.
4. Screenshots are evidence, not proof: nothing (including OCR or AI) marks an external registration verified except a person.
5. Department codes such as `AI&DS` are not accepted by the existing code rule (`A-Z 0-9 -`); normalization uppercases but did not widen that rule.
6. Deadline-expiry handling is covered by the database tests, not by a browser test.

## 2026-11-18 (stage 1c) — Student 360 view (step 5 of 5)
The coordinator and administrator student pages already held the record, career interest, documents (coordinator only), profile completion, achievements and academic record with its history. This step added the missing **drive history and placement status**.
- **Migration 0027:** `students.drive_history(student)`, a read-only SECURITY DEFINER function returning, per registration, the drive, registration status, whether selected, offer status, verified-placement status and joining date. Only the college administrator or a coordinator currently assigned to the student's department get rows (everyone else, including officers, the student, other colleges and anonymous callers, gets none). The offered package (LPA) is returned to the administrator only. Coordinators still have no row access to selections, offers or placements; this function is the only new door. Eligibility never reads it.
- **UI:** "Drive history and placement" card on both pages (placed line, then one row per drive).
- **Not built:** a combined timeline from the audit tables (the page keeps its existing sections), and round-by-round results per drive.

| Check | Result (actual, 2026-11-18) |
|---|---|
| `npm run typecheck`; eslint on the touched files | clean |
| `npm test` (unit + DB) | **802 passed** (2 new in `db/tests/drive-history.test.ts`: full flow to a verified placement with the package hidden from the coordinator; no rows for another department's coordinator, officer, student, other college, platform admin, anonymous) |
| `e2e/students.spec.ts` | 19 passed (coordinator page shows the new card; administrator page covered by the accessibility and 360 px scan) |
| Not run | mutation check on the new function; full browser suite; `security.spec.ts` role sweep was not extended |
| Snapshot | `cc_app-executable-functions.txt` regenerated; its diff also contains functions from earlier uncommitted migrations (0021-0026) that were missing from it |

## 2026-11-17 (stage 1b) — Semester-wise results and achievements
Plan approved by the user before building (optional semesters; achievements verified by coordinators; steps 1→5 with tests after each). **Steps 1-4 of 5 are done** (semesters, achievements, profile completion, edit and re-verification); step 5 (the student 360 view) is done, see stage 1c above.
- **Semester results (migration 0023):** optional SGPA and backlogs for up to 12 semesters, written in the same call as the academic submission (`academics.submit` gained `p_semesters`), append-only, verified or rejected together with the submission, never read by eligibility. Changing only the semesters counts as a real update (the "identical to verified" refusal compares them too). The CGPA is not computed from them: a gap over 0.5 from the SGPA average needs the student to tick a confirmation, and the reviewer sees the same note.
- **Achievements (migration 0024, schema `achievements`):** certification, hackathon, internship, project, publication, other. Immutable once added; the student may withdraw while it awaits review (to correct one: withdraw and add again; the dedicated edit workflow is step 4). Verified or returned (reason of 5+ characters) only by a coordinator currently assigned to the student's department. At most 10 awaiting review and 100 in total per student; an exact duplicate is refused. Audited (`ACHIEVEMENT_*`); coordinators are notified on add and the student on a decision. Links must be http(s). Not built: attaching evidence documents (the plan said "can"); it is deferred to the edit workflow.
- **UI:** student Achievements page, coordinator Achievements queue, achievements card on the coordinator and administrator student pages, semester table in every academic view. A decision on the coordinator queue deliberately revalidates nothing (a revalidation re-renders the queue and drops the decided card with its message).
- **Profile completion (migration 0025):** a derived score, nothing stored. View `student_profile_completion` (security_invoker, so each viewer only gets students they may see) over a fixed checklist: contact details (phone and personal email) 15, verified academic record 40, semester results on that record 10, a mark sheet or certificate not rejected 10, a career interest chosen 10, a verified achievement 15. The same weights live in `src/lib/completion.ts`; a DB test compares the view's score with the TypeScript one for every step. The administrator cannot read documents, so the document flag comes from `students.has_supporting_document`, which returns only yes/no and only to the student, their coordinator or the college's administrator (anyone else, and an anonymous caller, gets "no"). Shown to the student on the home and profile pages with a link to fix each missing item; to coordinators and the administrator as a list column, a band filter (below 50, 50-79, 80-99, 100) and a checklist on the student page. Eligibility never reads it.
- **Edit and re-verification (migration 0026):** academic records already worked this way (TD-25: an edit is a new submission, the verified one stays in force, decisions notify the student), so for them the new part is the reviewer's **"What this update changes"** card (old → new per value, semesters included; a missing value reads "Not provided", never 0). Achievements gained real edits: `achievements.revise` lets the student propose a change to one of their own VERIFIED entries as a new entry that points at it (`replaces_id`). The verified entry keeps counting, unchanged, while the revision waits (and after it is returned or withdrawn); verifying the revision supersedes the original in the same transaction; one open revision per entry; a change must differ from the verified entry; the chain can continue from the new verified entry. A superseded entry is frozen (the only permitted change to a verified row is closing it as superseded). The coordinator queue shows each revision as old → new per changed field. Both audited (`ACHIEVEMENT_REVISED`, and `ACHIEVEMENT_VERIFIED` naming what it replaced). **Not built:** evidence documents on achievements, and a "pending changes" screen separate from the two existing queues (verification and achievements): there is one queue per kind of record, each now showing what changed.
- **Test fixes found on the way:** the database test reset list did not know the new `achievements` schema (added); the catalog audit's schema list did not either, so its security checks silently skipped the new functions (added; it now covers them and passes). `db/tests/snapshots/cc_app-executable-functions.txt` regenerated (it was also stale from migration 0022).

| Check | Result (actual, 2026-11-17) |
|---|---|
| `npm run typecheck` | clean |
| `npm test` (unit + DB) | **800 passed** (after step 4) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `e2e/verification.spec.ts` | 16 passed (semester, achievements, achievement revision, academic diff and profile-completion flows, plus the accessibility/phone-width scan of the new pages) |
| `e2e/students.spec.ts`, `college.spec.ts`, `a11y.spec.ts`, `portals.spec.ts` (after step 3) | 67 passed, 1 failed, 4 did not run: `portals.spec.ts` "officer: the funnel…" needs the offers spec's selections, which only exist in a full-suite run (it asserts at least 2 selected students and found 0); it has not been re-run in a full suite since step 3 |
| `e2e/security.spec.ts` | 19 passed after adding the new pages to the role sweep |
| Full browser suite (before adding the new pages to the sweep) | 328 passed, **2 failed**, 11 did not run. `xai-extraction.spec.ts` ("pasting an announcement…": no `drive_intakes` row found for the exact announcement text) fails every time, alone or in the suite; it belongs to the uncommitted drive-intake work, not to this stage, and its 10 later serial tests did not run. The `security.spec.ts` sweep failure for the coordinator did not repeat when that spec was run alone (19/19); the cause was not found. |
| Mutation checks | without the semester insert 3 new DB tests fail; without the coordinator-department check in `achievements.lock_for_review` 2 fail; counting rejected documents as supporting evidence fails the completion test; without the supersede step in `achievements.verify` 2 revision tests fail |
| `npm run lint` | 1 error (`prefer-const`, `src/lib/intake/rules.ts`) and 1 warning in the uncommitted intake code; not touched |

## 2026-11-17 (next) — Product upgrade, stage 1a: career preference; copy-link fix
Decisions (user): "placed" = current role (a verified joining); offers (several per student) and the current company both carry an LPA; career preference is changed by coordinators only; the assistant is a lightweight local intent engine (no external model).
- **Copy link:** root cause was the plain-http dev site (no Clipboard API on insecure pages). `src/lib/clipboard.ts` falls back to `execCommand`, the link field is selectable, and "Copied" shows only when the browser confirms. Copying never touches the invitation.
- **Career preference (migration 0021):** six fixed codes with per-college labels/visibility, `students.career_preference` (default Undecided), append-only history with reason, coordinator-only all-or-nothing change function limited to currently assigned departments, audited. It is never read by eligibility. UI: coordinator list column, filter, bulk change, detail page with history; student and administrator see it read-only. Not yet built: the administrator's settings screen for renaming/hiding categories (the database function and tests exist).
- **Still to do in the upgrade:** rest of stage 1 (semester-wise academics, achievements, profile completion, edit/re-verification workflow, 360 view), drive versioning and invalidation, placement records and analytics, circulars and Campus Hub, the assistant.

## 2026-11-17 (latest) — 12th-or-diploma rule, independent sign-in areas, portal dashboards
- **Eligibility (migration 0019, engine version 2):** 12th and diploma minimums are now ONE check: a student passes when the route they took meets its minimum; a drive that sets only one minimum applies it to either route. Before, a student with only a 12th mark was "needs verified data" whenever a drive also set a diploma minimum. A missing value is still never treated as zero. DB tests cover both routes, one minimum, both minimums.
- **Independent sessions per role:** one session cookie per role (platform admin, college admin, placement officer, coordinator, student), so different roles stay signed in side by side in separate tabs of one browser; refresh keeps each tab's user; signing out ends only that role; a page of another role asks for that role's sign-in (never switches account); sign-in pages and `/login` never redirect. Seven multi-tab scenarios in `e2e/multi-tab.spec.ts`. Limitation: two accounts with the same role cannot share one browser.
- **Portal:** new shell (sidebar with lime active item; phone top bar with notifications and a Menu) and all five dashboards rebuilt on shared panels (`src/components/ui/metrics.tsx`). Other portal pages pick up the new shell and colours but have not been individually redesigned.

## 2026-11-17 (later) — Redesign, separate sign-in, security review
**Redesign (public site and sign-in):** new "Lime & Ink" theme (Archivo, expanded display capitals, lime/ink/mint, orange-red only for action), light and dark; landing, features, how it works, contact, apply, privacy, terms, sign-in and 404/error pages restyled; one theme button (sun/moon) instead of three; skeleton component (not yet wired into portal pages). **The signed-in portal has only picked up the new colours and fonts; its pages have not been redesigned yet.**

**Separate sign-in:** `/login/student`, `/login/college`, `/admin/login` (platform, not linked, noindex); `/login` chooses. A correct password on the wrong page does not sign in. One session per area, side by side in one browser (see DEPLOYMENT.md section 4).

**Security review (whole codebase):** no critical or high findings. Fixed: deploy workflow could run a fork's pull request named `main` next to production secrets (now requires a push to this repository); Vercel CLI pinned (was `latest`); two SQL arrays built as text (inputs were validated; now bound parameters); notification redirect now checks the resolved origin; uploads must declare their size (a chunked body could skip the size gate on self-hosting); a local throwaway admin password printed in `GETTING_STARTED.md` (public repository) removed; dev-tool advisory fixed (`npm audit`: 0). Verified as sound: authentication (Argon2id, constant-time unknown-user path, rate limits, session lifetimes, cookie flags), every Server Action and route guarded, origin checks, CSP and headers, RLS catalogue audit, CSV formula neutralisation, forced-download signed links, AI helper bounded. Not checked: the live Vercel configuration and logs (no CLI access from this session).

## 2026-11-17 — Error pages and a flaky test
**Delivered:** the app's own 404 pages (`src/app/not-found.tsx`, `src/app/(portal)/not-found.tsx`) and error pages (`src/app/error.tsx`, `src/app/(portal)/error.tsx`, `src/app/global-error.tsx`). Next's built-in ones rendered as bare unstyled text because their inline styles are blocked by our CSP. The portal versions keep the signed-in shell. Error pages show a reference (Next's digest) to match the server log, never the error message. Public header/footer moved to `src/components/layout/public-shell.tsx`; the centred card layout to `centered-shell.tsx` (usable from Client Components). Test-only crash pages behind `E2E_FAULT_ROUTES` (a 404 everywhere else).

Fixed a flaky browser test (`onboarding.spec.ts`, inquiries): it waited for a button that turns into "Saving…" at once, so it sometimes navigated before the save was stored. It now waits for the item to leave the "New" list.

| Check | Result (actual, 2026-11-17) |
|---|---|
| `npm run typecheck`, `npm run lint` | clean |
| `npm test` (unit + DB) | **679 passed** |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Full browser suite | **299 passed, 1 failed, 3 did not run** (the flaky inquiries test above, and the 3 serial tests after it). After the fix the onboarding spec passed alone (34/34); the full suite has not been re-run since. |
| Mutation checks | without the 404 page the new 404 tests fail; without both `error.tsx` and `global-error.tsx` the error test fails (removing `error.tsx` alone is covered by `global-error.tsx`) |

Not verified: `global-error.tsx` on its own (only reachable if the root layout crashes; it did render correctly when it caught the test crash in place of `error.tsx`). Live Vercel logs were not checked.

## Phase 16 — Production readiness
Migration `0016_least_privilege.sql`. Decision: TD-35. Documents: `DEPLOYMENT.md`, `DPDP_CHECKLIST.md`, `GETTING_STARTED.md`.

### Verification results (actual, 2026-11-12)
| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | clean |
| `npm test` (unit + DB) | **653 passed** (including the catalog audit, CSP, reconciliation, AI-checker tests); one reconcile test failed once in a combined run and passed on four reruns — cause was other test files leaving document records without files in the shared test database (not clock skew as first guessed); the test now looks only at its own college |
| Full browser suite | **236 passed** (production build; includes security headers, CSP-violation sweep of every role, cookie flags, cross-origin upload refusal, sensitive-path probes, cross-role authorization sweep) |
| CSP detector sanity check | deliberately reintroduced an inline style: the sweep failed as it should; restored |
| Backup/restore drill | passed (37 tables, 296 rows identical; RLS, grants, ledger intact); tamper self-test fails as it should |
| `npm audit --omit=dev` | 0 vulnerabilities |

### What is NOT done (honest) — needs you or a real environment
1. Hosting (OD-01), storage/malware scanning (OD-02), retention and legal review (OD-05): undecided. Privacy and Terms pages are developer drafts.
2. Nothing has run on a real host: no TLS/proxy test, no point-in-time-recovery test, no restore of production-size data, no load testing, no external penetration test.
3. The optional AI helper has never been run against a real provider.
4. No consent capture, retention jobs, student data export/erasure, or grievance channel (see `DPDP_CHECKLIST.md`).
5. Phases 7–16 were built back-to-back at your request without per-phase acceptance reviews; please review the phase sections above.
6. The Docker image was last smoke-tested at Phase 12; the Phase 16 Dockerfile change (health check) and CSP were verified through the browser suite on a production build, but the final image itself has not been re-run.

## Overall status
All 21 modules and all 17 phases (0–16) are implemented and verified locally with the evidence above. The system is ready for a pilot-style review, **not** for real student data until the items above are decided and checked on the real environment.

## Phase 15 — In-app notifications and the optional AI helper
Migrations `0014_notifications.sql`, `0015_ai_audit.sql`. Decisions: TD-33, TD-34.

**Delivered:** inbox with read/unread, mark-all-read, per-category preferences, header bell with unread count, deep links; notifications generated by triggers for drives, rounds, offers, placement decisions, academic and document reviews and staff tasks. Optional AI helper on "Create a drive" that pre-fills the draft form from a pasted announcement.

### Verification results (actual, 2026-11-12)
| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | clean |
| `npm test` (unit + DB) | **636 passed** (209 unit + 427 DB) |
| DB mutation checks (notifications) | 13 of 13 caught; migration restored byte-identical |
| Full browser suite | **217 passed** |
| `npm audit --omit=dev` | 0 vulnerabilities |

### Things worth knowing (honest)
1. **The AI helper has never talked to the real provider.** I had no API key or network access to one. What is verified: the deterministic checking of the model's output (unit tests, including hallucinated quotes, wrong numbers, invented zeros, hostile extra keys), the HTTP request shape and every failure path (unit tests with a stand-in `fetch`), and the whole browser flow against a small stand-in server that speaks the same JSON shape (started by the e2e global setup; test infrastructure only). Before enabling it for real, someone should try it with a real key and a few real announcements; extraction quality is unknown.
2. The browser tests found three problems in my own work, all fixed: the header bell's accessible name did not contain its visible text (an accessibility rule), a stale unread count after opening a notification (links now do a full page load), and a test spec that polluted another spec's "empty" state (renamed so it runs last).
3. Notification text is generic by design (no marks, reasons or document names). Academic rejection reasons and offer-withdrawal reasons stay on their own pages.
4. No retention job for notifications yet (OD-05).

## Phase 14 — Reports and analytics
Migration `0013_reports.sql`. Decision: TD-32.

**Delivered:** `/placement/reports` and `/college/reports` (headline numbers, department/drive/company tables, placement-rate chart, placed-students list, passing-year filter, print button) and CSV downloads for four reports.

### Verification results (actual, 2026-11-12)
| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | clean |
| `npm test` (unit + DB) | **606 passed** (191 unit + 415 DB) |
| DB mutation checks | 10 of 10 caught (a survivor — registered counts including withdrawn registrations — exposed a gap in my scenario and was fixed by adding a withdrawn registration); migration restored byte-identical |
| Reconciliation | DB tests compare every report with raw SQL on a known scenario; the browser test compares the page's headline tiles with raw queries |
| Formula-injection tests | unit tests for eight hostile prefixes in every report type; browser test downloads a CSV for a company named `=SUM(1+1)+…` and finds it prefixed with a quote |
| Full browser suite | **206 passed** (includes print-media emulation, accessibility scan, 360 px layout, role refusals, audit of exports) |
| `npm audit --omit=dev` | 0 vulnerabilities |

### Things worth knowing (honest)
1. Report numbers are only as good as the data entered; for example "registered for a drive" means currently registered, not ever registered.
2. `csvCell` does not neutralise a formula preceded by spaces (e.g. `" =1+1"`); common spreadsheet apps do not evaluate those, but a stricter rule is cheap to add if you prefer.
3. Reports run live queries over the whole college (fine for ~1000 students per college); caching would only be needed at far larger scale.
4. I have not compared these definitions against any particular college's own placement statistics (NIRF/NAAC formats differ). Share a college's report format and I will align the columns.

## Phase 13 — Role dashboards and responsive checks
No database change. Every home page now shows live numbers for its role and a "Needs your attention" list where there is real work.

**Delivered:** officer home (drive counts, placement funnel, pending joining verifications, selected students with no offer, drives closing within 7 days); administrator dashboard gains Placement section (drive counts and the same funnel); coordinator home gains drive participation for their own departments only (RLS-scoped, no WHERE clause); student home shows open drives, registrations, offers and what needs a response (open offers with deadline, eligible drives not yet registered). Removed the stale "appears here as modules are added" notes.

### Verification results (actual, 2026-11-12)
| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | clean |
| `npm test` (unit + DB) | **583 passed** |
| Full browser suite | **201 passed**, including new reconciliation checks (home numbers equal the detail pages; officer and administrator see the same funnel; a placement count never exceeds accepted offers), accessibility scans of the four home pages, and no-sideways-scroll checks at 360 px and 768 px for officer, student, administrator and coordinator placement pages |
| `npm audit --omit=dev` | 0 vulnerabilities |

### Things worth knowing (honest)
1. "Every control functional" is covered by the per-module specs; this phase did not add a separate click-through of every control. Dashboards link only to pages that exist.
2. The platform administrator console was not changed.
3. Several dashboard tiles still use a local `Stat` component (older pages); new tiles use the shared `StatTile`. Cosmetic only.

## Phase 12 — Selections, offers, joining and verified placements
Migration `0012_offers_placements.sql`. Decision: TD-31.

**Delivered:** officer selection and offers page per drive (record final selection, upload offer letter, issue offer with CTC and deadline, extend deadline, withdraw with reason); student "Offers" pages (open letter, accept/decline once, upload joining proof, record joining); officer Placements page (funnel, verify or reject joining with reason); admin Placements page (funnel, override with reason); private file downloads with 60-second signed links.

### Verification results (actual, 2026-11-12)
| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | clean |
| `npm test` (unit + DB) | **583 passed** (178 unit + 405 DB) |
| DB mutation checks | 16 of 16 caught (one survivor — removing the response row lock — was killed by adding a deterministic two-transaction race test); migration restored byte-identical |
| Full browser suite | **190 passed** (Chromium, production build, synthetic data) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Docker image | built; health 200; anonymous page routes → 307 to login; file download → 303; unauthenticated upload → 403 |

### Things worth knowing (honest)
1. A real bug found by DB tests: withdrawing an already-accepted offer violated my own check constraint (the response time must be kept). Fixed in the migration before release.
2. The full browser suite had two failures on one run: a students-list test (the seed grew past one page of 15 students — test now searches) and a platform "inquiries" test that passed on the next two runs. I did not find a cause for the second; treat it as a possible flake and watch it.
3. One `docker build` failed once at `npm run build` and succeeded on the immediate retry without any code change; I did not capture the first error. If it recurs I will investigate.
4. Offer letters and joining proofs are not virus-scanned (same as other uploads) and are retained (no delete) so the audit trail is complete. Joining-proof upload and offer-letter upload have their own rate limit (40/hour per user).
5. Not built (not in the plan): offer expiry as an automatic state (a late offer simply cannot be answered and the officer may extend or withdraw), email/notifications (Phase 15), coordinator views of placements (Phase 14 reports).

## Phase 11 — Rounds, results and release
Migration `0011_rounds.sql`. Decision: TD-30.

**Delivered:** officer rounds page (add/edit/delete round, schedule, candidate list with bulk decision and staff-only remark, release with explicit confirmation, decision history); student drive page shows the schedule and, only after release, their own result; admin read-only round summary.

### Verification results (actual, 2026-11-12)
| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | clean |
| `npm test` (unit + DB) | **563 passed** (178 unit + 385 DB) |
| DB mutation checks | 10 of 10 caught (after one surviving mutant was fixed by pinning the error message in a test); migration restored byte-identical |
| Full browser suite | **183 passed** (Chromium, production build, synthetic data) |
| `npm audit --omit=dev` | 0 vulnerabilities |

### Things worth knowing (honest)
1. A browser test found a real bug: the decision-history query joined `students`, which officers cannot read directly, so it silently returned nothing. Fixed with a staff-only definer function (`rounds.history`) and a DB test.
2. Rules I chose (change if your colleges work differently): results only after registration ends; every candidate needs a decision before release; round k needs round k-1 released. Rounds cannot be reopened after release — a correction process for released results is not built.
3. Notifications to students when a round is released arrive with Phase 15 (in-app notifications); for now students see results when they open the drive page.
4. The e2e seed gained `roundOfficer` and `regD` (own login budgets); seeded officer count in `college.spec.ts` is now 3.

## Phases 8–10 — Drives, eligibility engine, registration
Migrations `0009_drives.sql`, `0010_eligibility_registration.sql`. Decisions: TD-28, TD-29.

**Delivered:** officer drive create/edit/preview/publish/close/archive/unpublish with history; admin read-only drive pages; company page lists drives. SQL eligibility engine with per-criterion reasons and append-only snapshots. Student drive list and detail (own result and reasons, register/withdraw). Officer applicants page (counts, verified numbers, résumé link) and admin counts. Officer résumé access for registered applicants, audited.

### Verification results (actual, 2026-11-12)
| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | clean |
| `npm test` (unit + DB) | **550 passed** (178 unit + 372 DB, 11 DB files) |
| DB mutation checks, Phase 8 | 7 of 7 mutations caught; migration restored byte-identical |
| DB mutation checks, Phase 9–10 | 10 of 10 caught (inclusive/exclusive thresholds, missing-as-zero, unverified counting, deadline, server re-check, unpublish-with-registrations, officer résumé scope, department filter, duplicate registration); migration restored byte-identical |
| Full browser suite `npx playwright test` | **177 passed** (Chromium, production build, synthetic data) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Docker image | built; production config guards enforced (refuses dev cookie/pepper/storage secrets); health 200; anonymous `/student/drives`, `/placement/drives`, `/college/drives`, applicants → 307 to login; runs as uid 1001 |

### Things worth knowing (honest)
1. The engine ran against synthetic data only. Real colleges may define eligibility differently (e.g. best-of CGPA/percentage, backlog definitions); criteria are the six in the master plan.
2. A bug found while testing: `drive_counts` used `NOT IN` on a NULL role (no-context caller), which fell through to a later check instead of being refused outright. Fixed with `IS DISTINCT FROM`; test covers the anonymous caller.
3. Behaviour change: `documents.storage_key_for` now answers officers with "not found" (HTTP 404) rather than "forbidden" for anything they may not open; two earlier tests were updated accordingly.
4. `eligibility.check_drive` records a snapshot when a student views a drive page whose outcome changed (a write during page render, by design for the audit trail). Officer counts are computed live by evaluating every student of the college in the drive's departments — fine at ~1000 students; revisit with caching if scale grows.
5. Registration scenario seed data (REG department, `regCoord`, `regAdmin`, `regA/B/C`) was added to the e2e seed; three earlier specs' seeded counts were updated. Sign-in is throttled per account (8 per 15 minutes), so each spec needs its own login budget.
6. You asked for all phases back-to-back, so Phases 7–10 have not had your individual acceptance reviews.

## Next step
Your review and decisions: OD-01, OD-02, OD-05, counsel's review of `DPDP_CHECKLIST.md`, and a trial of the AI helper (or leaving it off). Then repeat the drill and reconciliation on the real environment.
