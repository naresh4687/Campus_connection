# CampusConnect — deployment and operations guide

Status: written 2026-11-12 from the code and tests in this repository. Nothing here has been exercised on a real hosting provider (OD-01 is still open), so treat the provider-specific parts as a checklist to confirm, not as proven steps.

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
| `DATABASE_URL` | the `cc_app` role. Never the owner. |
| `AUTH_PEPPER` | secret, ≥ 32 random characters; must not contain `dev-only`/`change-me`. Rotating it invalidates stored hashed IPs/emails in rate-limit tables only (sessions are separate). |
| `AUTH_COOKIE_SECURE` | `true` (uses the `__Host-` cookie prefix; requires HTTPS). |
| `APP_BASE_URL` | the public https origin; used to build one-time invitation/reset links and redirects. |
| `TRUSTED_PROXY_HOPS` | `1` behind a single trusted load balancer/proxy that sets `X-Forwarded-For`/`-Host`. With `0` per-IP rate limits are skipped (per-account limits still apply). Never set it higher than the real number of proxies. |
| `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` | `S3_PUBLIC_ENDPOINT` must be reachable from browsers (it is part of the signature). Use a key that can only read/write/list/delete in this one bucket. |

Optional: `AI_EXTRACTION_ENABLED`, `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_API_BASE` (see TD-34). Secrets belong in the platform's secret store, not in the image or the repository.

## 3. Release procedure

1. CI: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm audit --omit=dev`, the browser suite (`npm run e2e`) against a throwaway database. Release only when all are green.
2. Build the image (`docker build`). The build downloads Google Fonts through `next/font`; a build with no outbound network fails (one `docker build` failed once during development and succeeded on retry — the likely cause is that fetch, but the first error was not captured).
3. **Migrations are a separate, inspected step**: run `npm run db:migrate` with `MIGRATE_DATABASE_URL` (the `cc_owner` role) from the same commit as the image, *before* starting the new containers. Migrations are forward-only and checksummed; the migrator refuses a database whose applied migrations differ from the files. Take (or confirm) a backup first.
4. Deploy the image; wait for `/api/health` = 200 on the new instances; keep the old ones until then.
5. First deployment only: `PLATFORM_ADMIN_PASSWORD=… npm run admin:create -- email "Name"` creates the single platform administrator (OD-08).
6. Create the bucket (`npm run storage:init` or the provider console) and confirm it is private (an anonymous GET of any object returns 403 — `db/tests/storage.test.ts` shows the check).

Rollback: the application is backward-compatible with the previous schema only if a migration was additive; migrations here are forward-only, so a rollback means restoring the database from backup (section 5) or shipping a new forward migration. Plan accordingly before releasing a destructive change.

## 4. What the system already enforces (verified by tests)

- Tenant isolation and role limits in the database (RLS with `FORCE`), not just in the UI. `db/tests/catalog-audit.test.ts` re-checks after every migration: the runtime role cannot insert/update/delete/truncate any table or column; every table has forced RLS or is invisible to the runtime role; every SECURITY DEFINER function is owned by `cc_auth` and pins its `search_path`; no application function is executable by PUBLIC; views are `security_invoker`; and the exact set of functions the runtime role may call equals a reviewed snapshot.
- A strict CSP with a per-request nonce (`src/proxy.ts`): no inline scripts, no `unsafe-eval`, `frame-ancestors 'none'`, `form-action 'self'`, no external origins. A browser sweep of every role's pages fails on any violation (and was shown to fail when an inline style was reintroduced). Also `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS, Permissions-Policy, no `X-Powered-By`.
- Session cookie `HttpOnly`, `SameSite`, `__Host-` prefix when secure; cross-origin POSTs to upload routes are refused; sign-in is throttled per account (8 per 15 minutes) and per IP when proxies are trusted.
- Sensitive paths (`.env`, `.git`, `package.json`, migrations, source) are not served; unknown identifiers give a plain 404, never a stack trace.
- Authorization sweep: each role is refused every other role's pages; anonymous visitors are sent to sign in.

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
- Application logs go to stdout. Server errors log a short message and a database error code; the code does not log request bodies, announcement text, tokens, passwords or marks. One caveat: for unexpected database errors the logged message is PostgreSQL's own, which can echo an offending input value (for example `invalid input syntax for type uuid: "…"`), so treat logs as potentially containing small fragments of user input. Review before enabling any log shipper that adds request metadata (URLs of one-time links contain tokens until used).
- Suggested alerts: health failing; sign-in rate-limit hits spiking; 5xx rate; database disk/connection saturation; backup job failures; "MISSING" in the weekly reconciliation.
- The audit log (College audit page; platform audit page) records who did what, including each report export and AI-helper use (counts only).

## 9. Incident basics

Suspected account compromise: disable the user (College → Staff / Students) — their sessions end at once; issue a one-time password reset link. Suspected data exposure: preserve logs, take a database snapshot, identify affected colleges from the audit log, and follow the notification duties in `DPDP_CHECKLIST.md`. Secrets leaked: rotate the affected secret (database role password, S3 key, `AUTH_PEPPER`, AI key) and restart.

## 10. Known limits and go-live blockers

Blocking go-live (need your decisions or the real environment):
1. **OD-01 hosting** vendor, region and budget; HTTPS termination; managed Postgres with PITR; secrets store.
2. **OD-02 storage and malware scanning** provider and approach (section 7).
3. **OD-05 retention and legal review**; privacy notice and terms texts on the public site are drafts written by the developer and must be reviewed by counsel. See `DPDP_CHECKLIST.md`.
4. The restore drill and `storage:reconcile` must be repeated on the real environment; load/soak testing has not been done (design target is ~3 colleges / ~3,000 users).
5. The optional AI helper has never been run against a real provider (TD-34); leave it off until someone has tried it with real announcements.
6. Email is intentionally not built (TD-12): invitations and password resets are one-time links shown to the administrator, who must pass them on securely.

Not blocking but worth doing: dependency update routine (`npm audit` in CI), pinning the base image by digest, a log shipper with PII scrubbing, rate-limit tuning after real traffic, and periodic review of the reviewed-function snapshot when migrations change.
