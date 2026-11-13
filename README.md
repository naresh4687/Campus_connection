# CampusConnect

College placement management SaaS (multi-tenant). See `CAMPUSCONNECT_MASTER_PLAN.md`, `TECHNICAL_DECISIONS.md`, `IMPLEMENTATION_STATUS.md`.

[![CI](https://github.com/naresh4687/Campus_connection/actions/workflows/ci.yml/badge.svg)](https://github.com/naresh4687/Campus_connection/actions/workflows/ci.yml)

## Automated checks and deployment

Every push and pull request runs typecheck, lint, unit, database and browser tests (`.github/workflows/ci.yml`). Production deploys to Vercel + Neon go through `.github/workflows/deploy.yml` after CI passes and a reviewer approves. Setup steps are in `DEPLOYMENT.md` section 3a.

## Local development

Requirements: Node 22, Docker (with Compose).

```bash
cp .env.example .env            # throwaway local values only
docker compose up -d            # PostgreSQL 16 on 127.0.0.1:5433 (roles + dev/test databases) and the private object store on 127.0.0.1:9000
npm ci
npm run db:migrate              # applies db/migrations to the dev database
npm run storage:init            # creates the private document bucket (never makes it public)
PLATFORM_ADMIN_PASSWORD='choose-a-long-password' npm run admin:create -- you@example.com "Your Name"
npm run dev                     # http://localhost:3000
```

If the Postgres volume was created before Phase 1, create the definer role once:
`docker exec campusconnect-postgres-1 psql -U postgres -c "CREATE ROLE cc_auth NOLOGIN BYPASSRLS" -c "GRANT cc_auth TO cc_owner"`

## Configuration

See `.env.example`. Notable: `AUTH_PEPPER` (≥32 chars secret), `AUTH_COOKIE_SECURE`, `TRUSTED_PROXY_HOPS`, and **`APP_BASE_URL`** (public origin used to build one-time invitation links; required in production).

## Private documents

Student documents live in a private S3-compatible bucket (`S3_*` variables, see `.env.example`); downloads are 60-second signed links issued only after a database authorisation check. Run `npm run storage:init` once per environment. `npm run test:db` includes tests against the real store, so `docker compose up -d` first. Production needs real storage credentials (the app refuses the dev ones).

## Student CSV import

Admins upload a CSV at `College → Students → Import from CSV` (2 MB, 5000 rows, UTF-8, header row). Columns are mapped in the UI; Excel/Sheets "CSV UTF-8" exports work. Imports only create students; existing ones are never changed.

## Public site content

Feature availability labels and workflow copy are in `src/lib/site-content.ts`. Only mark a feature "available" when it is built and tested, and update it as each phase ships.

## Checks

| Command | What it does |
|---|---|
| `npm run typecheck` / `npm run lint` | static checks |
| `npm run test:unit` | unit tests |
| `npm run test:db` | security/integration tests against real PostgreSQL. **Drops and rebuilds the `*_test` database** each run (guarded: refuses anything not named `*_test`) |
| `npm run e2e` | Playwright browser tests (functional flows, axe accessibility scan, phone-width layout): builds the app, rebuilds + seeds the `*_test` database with synthetic data, runs against it |
| `npm test` | unit + db |
| `scripts/backup-restore-drill.sh [db]` | backs up a database, restores it into a scratch database and verifies data, RLS, grants and the migration ledger (see DEPLOYMENT.md) |
| `npm run storage:reconcile` | read-only report of orphaned/missing stored files (see DEPLOYMENT.md) |

Run `test:db` and `e2e` one after the other, **never at the same time** (they share and reset the same test database; overlapping runs cause spurious failures).

## Operations and compliance documents

`DEPLOYMENT.md` (release steps, configuration, backups, monitoring, malware-scanning approach, go-live blockers) and `DPDP_CHECKLIST.md` (engineering checklist for India's data-protection law; not legal advice).

## Conventions that matter

- Tenant data is only touched through `withTenantTx` / `withSession` (`src/server/db`). Never use the raw pool in feature code.
- Credentials, sessions, invitations and resets are only reachable through the `auth.*` SQL functions.
- Migrations are forward-only and checksummed: never edit an applied migration; add a new one.
- The runtime database role can write nothing directly: every write is a vetted SQL function. `db/tests/catalog-audit.test.ts` fails if a migration widens that, and keeps a reviewed snapshot of the functions the runtime role may call (`UPDATE_SNAPSHOT=1` to refresh after a deliberate change).
- A strict nonce-based CSP is set in `src/proxy.ts`: no inline scripts, and no `style=""` attributes (use classes or SVG attributes).
- Real `.env` files are git-ignored. Test data is synthetic.
