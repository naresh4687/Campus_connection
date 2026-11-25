# CampusConnect — deployment and operations guide

Status: written 2026-11-12, updated 2026-11-17. The app now runs on Vercel with Neon Postgres and Neon Object Storage (section 3a), still behind Vercel Authentication. Parts not yet exercised on that environment are marked as such; treat them as a checklist to confirm, not as proven steps.

## 1. What runs where

| Piece | Notes |
|---|---|
| App container | One Next.js (standalone) container built from `Dockerfile` (Node 22, non-root uid 1001, `HEALTHCHECK` on `/api/health`). Stateless: sessions, rate limits and jobs live in PostgreSQL. One instance is enough for ~3 colleges / ~1000 users each; more instances are safe (no in-memory state). |
| PostgreSQL 16 | The only system of record. Three roles: `cc_owner` (migrations only), `cc_app` (runtime; `NOSUPERUSER NOBYPASSRLS`; cannot write any table directly), `cc_auth` (`NOLOGIN BYPASSRLS`; owns the SECURITY DEFINER functions). `docker/postgres/init` shows how the roles are created. |
| Private object storage | S3-compatible bucket, **private**. The app signs 60-second download links only after the database authorises the caller. |
| Optional AI provider | Off by default (TD-34). |

## 2. Configuration (environment variables)

Required in production (the app **refuses to start** with development values):

| Variable | Rule |
|---|---|
| `DATABASE_URL` (or `APP_DATABASE_URL`) | the `cc_app` role. Never the owner: in production the app **refuses to start** with any other login. `APP_DATABASE_URL` wins when both are set, for platforms that manage `DATABASE_URL` themselves (see 3a). |
| `AUTH_PEPPER` | secret, ≥ 32 random characters; must not contain `dev-only`/`change-me`. Rotating it invalidates stored hashed IPs/emails in rate-limit tables only (sessions are separate). |
| `AUTH_COOKIE_SECURE` | `true` (uses the `__Host-` cookie prefix; requires HTTPS). |
| `APP_BASE_URL` | the public https origin; used to build one-time invitation/reset links and redirects. |
| `TRUSTED_PROXY_HOPS` | `1` behind a single trusted load balancer/proxy that sets `X-Forwarded-For`/`-Host`. With `0` per-IP rate limits are skipped (per-account limits still apply). Never set it higher than the real number of proxies. |
| `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` | `S3_PUBLIC_ENDPOINT` must be reachable from browsers (it is part of the signature). Use a key that can only read/write/list/delete in this one bucket. |

Optional (AI-assisted drive creation; see `docs/AI_DRIVE_CREATION.md`): `AI_EXTRACTION_ENABLED`, `AI_PROVIDER` (`local` or `anthropic`), `AI_LOCAL_URL`, `AI_MODEL`, `AI_TIMEOUT_MS`, `ANTHROPIC_API_KEY`, `AI_API_BASE`. Without them the pattern-based reader still works; only the language model is off. Secrets belong in the platform's secret store, not in the image or the repository.

## 3. Release procedure

1. CI: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm audit --omit=dev`, the browser suite (`npm run e2e`) against a throwaway database. Release only when all are green.
2. Build the image (`docker build`). The build downloads Google Fonts through `next/font`; a build with no outbound network fails (one `docker build` failed once during development and succeeded on retry — the likely cause is that fetch, but the first error was not captured).
3. **Migrations are a separate, inspected step**: run `npm run db:migrate` with `MIGRATE_DATABASE_URL` (the `cc_owner` role) from the same commit as the image, *before* starting the new containers. Migrations are forward-only and checksummed; the migrator refuses a database whose applied migrations differ from the files. Take (or confirm) a backup first.
4. Deploy the image; wait for `/api/health` = 200 on the new instances; keep the old ones until then.
5. First deployment only: `PLATFORM_ADMIN_PASSWORD=… npm run admin:create -- email "Name"` creates the single platform administrator (OD-08).
6. Create the bucket (`npm run storage:init` or the provider console) and confirm it is private (an anonymous GET of any object returns 403 — `db/tests/storage.test.ts` shows the check).

Rollback: the application is backward-compatible with the previous schema only if a migration was additive; migrations here are forward-only, so a rollback means restoring the database from backup (section 5) or shipping a new forward migration. Plan accordingly before releasing a destructive change.

## 3a. Automated deployment on Vercel + Neon

Added 2026-11-13. **Tested:** the CI commands, the role-setup script and the full database test suite against a Postgres set up the way a managed database is (admin role that is not a superuser). **Not tested:** the deploy workflow itself, which needs your real Vercel and Neon accounts. Run it once and watch it before relying on it.

### How a release flows

1. Push or merge to `main`. `.github/workflows/ci.yml` runs typecheck, lint, unit tests, `npm audit`, the database tests (Postgres 16) and the browser tests. Pull requests run the same checks.
2. When CI succeeds on `main`, `.github/workflows/deploy.yml` starts and **waits for approval** (GitHub environment `production`, required reviewers).
3. After approval it applies the database migrations to Neon, builds and deploys that exact commit to Vercel, then checks `/api/health` on the live site.
4. `vercel.json` turns off Vercel's own deploy-on-push for `main`, so nothing reaches production except through this workflow. Other branches still get Vercel preview deployments.

If a newer commit reaches `main` while a deploy is waiting for approval, the older run stops instead of rolling production back.

### One-time setup (in this order)

1. **Neon roles.** Generate two passwords (`openssl rand -base64 24`). With the Neon *admin* connection string (the one from the Neon console), connected to the application database:
   `psql "$ADMIN_DATABASE_URL" -v owner_pw="$CC_OWNER_PASSWORD" -v app_pw="$CC_APP_PASSWORD" -f scripts/neon-setup-roles.sql`
   This creates `cc_owner` (migrations), `cc_app` (the running app, row-level security applies) and `cc_auth`, and hands schema `public` to `cc_owner`. Whether your Neon project allows the role that bypasses row-level security (`cc_auth`) is the one thing only Neon can confirm; if the script reports a permission error there, stop and ask Neon support before continuing.
2. **Connection strings.** Build two from the Neon console, replacing the user and password:
   - `APP_DATABASE_URL` (Vercel, Production, mark it Sensitive): `cc_app`, the **pooled** connection string, without `channel_binding`. The Neon integration owns `DATABASE_URL` in Vercel and fills it with the admin login, and Vercel does not let you override it, so the app reads `APP_DATABASE_URL` first and ignores the integration's value. In the integration's settings (Vercel → Storage → the database → Settings → Allowed Environments) choose **Production environment only**, so Preview and Development deployments do not receive the admin login either. The app refuses to start in production unless its login is `cc_app`; the admin login would bypass the per-college isolation.
   - `MIGRATE_DATABASE_URL` (GitHub secret): `cc_owner`, the **direct (unpooled)** connection string. The migration runner takes an advisory lock and needs a normal session.
3. **Run the migrations once by hand** to confirm they work on Neon: `MIGRATE_DATABASE_URL="..." npm run db:migrate`. Then create the platform administrator (`PLATFORM_ADMIN_PASSWORD=… npm run admin:create -- email "Name"`, with `MIGRATE_DATABASE_URL` set).
4. **Object storage.** *Done 2026-11-14:* a private bucket `campusconnect-private` on **Neon Object Storage**, in the same Neon project and region (`aws-ap-southeast-1`), with the seven `S3_*` variables in Vercel Production (key and secret marked Sensitive). Checked directly against the bucket: upload, signed download, anonymous request refused with 403, delete. **Not yet checked:** an upload through the live app. **Caveat:** Neon's S3 key covers the whole branch, not only this bucket, which is wider than the single-bucket key recommended in section 2; acceptable while it is the only bucket. To use another provider instead (Cloudflare R2, AWS S3), create a **private** bucket there and set `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` (and `S3_FORCE_PATH_STYLE` as the provider needs) in Vercel. Without them, document and offer-letter uploads fail. Create the bucket with `npm run storage:init` or the provider console.
5. **Other Vercel Production variables** (see section 2): `AUTH_PEPPER`, `AUTH_COOKIE_SECURE=true`, `APP_BASE_URL` (the public https origin), `TRUSTED_PROXY_HOPS=1`.
6. **GitHub.** Settings → Environments → create `production`, turn on **Required reviewers**, and add yourself. Then add:
   - environment **secrets**: `MIGRATE_DATABASE_URL`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (the two IDs are in `.vercel/project.json` after `npx vercel link`);
   - environment **variable**: `APP_BASE_URL` (the same public origin, used for the health check).
7. Add the repository **variable** `DEPLOY_ENABLED` = `true` (Settings → Secrets and variables → Actions → Variables). Until it is set, the deploy workflow skips itself, so pushing before the setup is finished is safe.
8. **Only now** rely on `vercel.json`. Once it is on `main`, Vercel stops deploying `main` by itself, so steps 1 to 6 must already be in place or pushes will not deploy at all.

### 3b. Free file storage on Cloudflare R2 (instead of Neon Object Storage)

Added 2026-11-24. The code change (the storage client no longer sends the default upload checksum that R2 refuses) is tested against the local S3 server only; **R2 itself has not been tried from here** — do steps 4 and 5 below and upload one file through the live app before relying on it. R2's free tier (about 10 GB, no download fees) is the cheapest place for the private bucket; check Cloudflare's current limits.

1. Cloudflare dashboard → **R2 Object Storage** → create a bucket, for example `campusconnect-private`. Leave it **private** (no public access, no custom domain).
2. R2 → **Manage API tokens** → create a token with **Object Read & Write**, limited to that one bucket. Copy the **Access Key ID**, the **Secret Access Key** and the account's S3 endpoint `https://<account-id>.r2.cloudflarestorage.com` (shown on the same page). The secret is shown once.
3. In Vercel → Project → Settings → Environment Variables (Production), replace the storage values:
   - `S3_ENDPOINT` = `https://<account-id>.r2.cloudflarestorage.com`
   - `S3_PUBLIC_ENDPOINT` = the same value
   - `S3_REGION` = `auto`
   - `S3_BUCKET` = the bucket name
   - `S3_ACCESS_KEY`, `S3_SECRET_KEY` = the token (mark both Sensitive)
   - `S3_FORCE_PATH_STYLE` = `true`
4. If the old bucket already holds files, copy them first so existing links keep working (keys stay identical):
   `SRC_S3_ENDPOINT=… SRC_S3_BUCKET=… SRC_S3_ACCESS_KEY=… SRC_S3_SECRET_KEY=… DEST_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com DEST_S3_REGION=auto DEST_S3_BUCKET=… DEST_S3_ACCESS_KEY=… DEST_S3_SECRET_KEY=… npx tsx scripts/storage-copy.ts --dry-run` and then without `--dry-run`. Nothing is deleted from the old bucket.
5. Redeploy (so the new variables apply), then as a student upload a document and open it, and as an officer open it again. Run `npm run storage:reconcile` against the new bucket afterwards to confirm the database and the bucket agree.
6. Only after that, remove the old Neon storage variables and keep the old bucket for a week as a fallback.

Notes: the bucket is never public — files leave it only through short-lived signed links the app issues after the database approves the request, exactly as before. R2 has no per-object "virus scan" or lifecycle rules set up here; the retention script `npm run storage:reconcile` is unchanged.

### Things that behave differently on Vercel

- **Upload limit.** Vercel rejects request bodies over 4.5 MB, so the app limit is 4 MB (`MAX_DOCUMENT_MB` in `src/lib/documents.ts`). Larger files would need direct-to-bucket uploads.
- **Migrations are forward-only.** If a deploy fails after the migration ran, the database stays migrated. Read the migration before approving, and use Vercel's **Instant Rollback** for the app; restore from a Neon backup only if the migration itself was wrong.
- **Backups.** Turn on Neon's point-in-time restore window, and repeat the restore drill (section 5) against a Neon branch.
- **Connections.** The app sets its per-request context with a transaction-local setting, which is safe with Neon's pooled connections.

## 4. What the system already enforces (verified by tests)

- Tenant isolation and role limits in the database (RLS with `FORCE`), not just in the UI. `db/tests/catalog-audit.test.ts` re-checks after every migration: the runtime role cannot insert/update/delete/truncate any table or column; every table has forced RLS or is invisible to the runtime role; every SECURITY DEFINER function is owned by `cc_auth` and pins its `search_path`; no application function is executable by PUBLIC; views are `security_invoker`; and the exact set of functions the runtime role may call equals a reviewed snapshot.
- A strict CSP with a per-request nonce (`src/proxy.ts`): no inline scripts, no `unsafe-eval`, `frame-ancestors 'none'`, `form-action 'self'`, no external origins. A browser sweep of every role's pages fails on any violation (and was shown to fail when an inline style was reintroduced). Also `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS, Permissions-Policy, no `X-Powered-By`.
- Session cookie `HttpOnly`, `SameSite`, `__Host-` prefix when secure; cross-origin POSTs to upload routes are refused; sign-in is throttled per account (8 per 15 minutes) and per IP when proxies are trusted.
- Sensitive paths (`.env`, `.git`, `package.json`, migrations, source) are not served; unknown identifiers give a plain 404, never a stack trace.
- Authorization sweep: each role is refused every other role's pages; anonymous visitors are sent to sign in.
- One session per ROLE (`src/lib/portals.ts`, `src/server/auth/session.ts`): cookies `cc_session_platform`, `cc_session_college` (college administrator), `cc_session_placement`, `cc_session_coordinator` and `cc_session_student` (with the `__Host-` prefix when secure), so any mix of roles can be signed in side by side in one browser, one tab each, without replacing each other. The proxy decides a request's role slot from its path (`/platform…`, `/college…`, `/placement…`, `/coordinator…`, `/student…`) or, on shared pages (account, notifications), from `?as=`, and always overwrites the `x-cc-slot` header it passes on (a client-sent one, or the older `x-cc-portal`, is dropped). A cookie only counts for its own role (a session whose role differs is ignored), and every page and action still checks the role on the server. A page of a role you are not signed in as asks for that role's sign-in; it never switches to another signed-in account. Sign-out ends only that role's session. Sign-in pages never redirect (they offer "Continue as …"). Shared downloads try each signed-in account and the database decides. Limitation: two accounts with the SAME role cannot be signed in in one browser at once (use another browser profile). Cookies from before this change are ignored, so everyone signs in once more after the deploy.
- Separate sign-in pages (`src/lib/portals.ts`): students `/login/student`, college staff `/login/college`, the platform administrator `/admin/login` (not linked, `noindex`). A correct password on the wrong page is refused and logged as `LOGIN_FAILED` with reason `wrong_sign_in_page`; students and staff are pointed to their own page, while the platform page only ever says "Invalid email or password.". The platform page is a convenience, not a secret: its protection is the password and the sign-in limits.

### Two-step sign-in
- **Switched off by default.** Set `TWO_STEP_SIGN_IN=on` to enable it; the points below apply only then.
- Platform and college administrators must set up an authenticator app at their next sign-in; others may turn it on from Account.
- Secrets are encrypted with a key derived from `AUTH_PEPPER`. **Changing `AUTH_PEPPER` breaks every enrolment**: remove the rows in `user_mfa` and `mfa_recovery_codes` and let people enrol again.
- Lost phone and recovery codes: a college administrator removes it for their staff and students, the platform administrator for college administrators, and for the platform administrator run `npm run admin:reset-mfa -- <email>` with `MIGRATE_DATABASE_URL`.
- `AUTH_MFA_ENFORCEMENT` is for the browser tests only. Never set it in a real deployment.

### Legal pages
Optional `OPERATOR_NAME`, `OPERATOR_ADDRESS` and `PRIVACY_CONTACT_EMAIL` appear on the privacy and terms pages. Both pages are drafts, including the proposed retention schedule and the under-18 rule.

## 5. Backups and restore

**Production mechanism (to be set up with the hosting provider, OD-01):** managed PostgreSQL with automated daily snapshots **and point-in-time recovery**, retention agreed with the college (OD-05), stored in a different failure domain/region than the primary, access restricted and audited. Object storage needs its own versioning/replication or backup; the database does not contain file bytes.

**Drill (what has actually been run):** `scripts/backup-restore-drill.sh [database]` takes a `pg_dump` backup, restores it into a brand-new database, and verifies (1) every table has the same row count and content checksum, (2) forced RLS, no runtime writes and pinned definer functions survived, (3) the runtime role still sees 0 rows with no user context, (4) the migrator accepts the restored database (ledger and checksums intact). It also has a self-test (`DRILL_SELFTEST=tamper`) that must make it fail; that was confirmed. Result on 2026-11-12 against the browser-test database: 37 tables, 296 rows, 497 KB dump, backup+restore ≈ 10 s, all checks passed.
What the drill does **not** prove: point-in-time recovery, restore on the real provider, restore time at production size, or object-storage recovery. Repeat it on the real environment before go-live and then on a schedule (suggested: monthly), recording the date and result.

## 6. Stored-file reconciliation

`npm run storage:reconcile` (read-only) compares the database's file references with the bucket: objects with no record (orphans, e.g. after a failed purge or an interrupted upload), records whose object is missing (the serious case — exit code 1), deleted records whose bytes remain, and objects the application did not create (never touched). `-- --delete-orphans --yes` deletes only unreferenced objects that the app itself created and that are older than the grace period (default 60 minutes, so uploads in flight are safe); it never changes database rows. Tested against the real database and an object store (`db/tests/reconcile.test.ts`). Suggested cadence: weekly report, investigate any "missing" immediately.

## 7. Malware scanning (not implemented — decision OD-02)

Uploads are validated by content (PDF/PNG/JPEG signature, size, extension and declared type must agree) and served only as attachments through short-lived links, which limits exposure but is **not malware scanning**. Every file record has a `scan_status` (`NOT_SCANNED` today). Recommended approach once a scanner exists: scan before the file becomes downloadable — upload to a quarantine key prefix, scan (for example a ClamAV `clamd` sidecar over its INSTREAM protocol, or the storage provider's scanning feature), then set `CLEAN` and make the file downloadable; `INFECTED` blocks download and alerts staff. The reconciliation tool is the place to catch files stuck in quarantine. Until then, tell colleges plainly that files are not virus-scanned (the upload screens already say so).

## 8. Monitoring and logs

- `/api/health` (200 ok / 503 when the database is unreachable) for the load balancer and container health.
- Error pages: unexpected errors show the app's own "Something went wrong" page (`src/app/error.tsx`, `src/app/(portal)/error.tsx`, `src/app/global-error.tsx`) with a short **reference** — Next's error digest. The error message itself never reaches the browser; search the Vercel logs for the reference to find it. Unknown URLs and records show `src/app/not-found.tsx` / `src/app/(portal)/not-found.tsx` (status 404). Next's built-in versions could not be used: their inline styles are blocked by the CSP.
- `E2E_FAULT_ROUTES` turns on two deliberate-crash pages for the browser tests. **Never set it** outside the Playwright test server; without it those pages are a 404.
- Application logs go to stdout. Server errors log a short message and a database error code; the code does not log request bodies, announcement text, tokens, passwords or marks. One caveat: for unexpected database errors the logged message is PostgreSQL's own, which can echo an offending input value (for example `invalid input syntax for type uuid: "…"`), so treat logs as potentially containing small fragments of user input. Review before enabling any log shipper that adds request metadata (URLs of one-time links contain tokens until used).
- Suggested alerts: health failing; sign-in rate-limit hits spiking; 5xx rate; database disk/connection saturation; backup job failures; "MISSING" in the weekly reconciliation.
- The audit log (College audit page; platform audit page) records who did what, including each report export and AI-helper use (counts only).

## 9. Incident basics

Suspected account compromise: disable the user (College → Staff / Students) — their sessions end at once; issue a one-time password reset link. Suspected data exposure: preserve logs, take a database snapshot, identify affected colleges from the audit log, and follow the notification duties in `DPDP_CHECKLIST.md`. Secrets leaked: rotate the affected secret (database role password, S3 key, `AUTH_PEPPER`, AI key) and restart.

## 10. Known limits and go-live blockers

Blocking go-live (need your decisions or the real environment):
1. **OD-01 hosting:** running on Vercel + Neon (`aws-ap-southeast-1`, Singapore). Still to confirm: Neon's point-in-time-restore window and plan, the budget, whether a Singapore region is acceptable to the colleges, and a custom domain. **Vercel Authentication is still on**, so the public cannot reach the site; turn it off for Production only when the items below are settled.
2. **OD-02 malware scanning** approach (section 7). Storage itself is set up (section 3a, step 4).
3. **OD-05 retention and legal review**; privacy notice and terms texts on the public site are drafts written by the developer and must be reviewed by counsel. See `DPDP_CHECKLIST.md`.
4. The restore drill and `storage:reconcile` must be repeated on the real environment; load/soak testing has not been done (design target is ~3 colleges / ~3,000 users).
5. The optional AI helper has never been run against a real provider (TD-34); leave it off until someone has tried it with real announcements.
6. Email is intentionally not built (TD-12): invitations and password resets are one-time links shown to the administrator, who must pass them on securely.

Not blocking but worth doing: dependency update routine (`npm audit` in CI), pinning the base image by digest, a log shipper with PII scrubbing, rate-limit tuning after real traffic, and periodic review of the reviewed-function snapshot when migrations change.
