-- One-time setup of the three database roles CampusConnect needs, for a managed Postgres such as Neon.
-- (Locally, docker/postgres/init/01-roles-and-dbs.sh does the same thing.)
--
-- Run ONCE, as the provider's admin role (on Neon: the default owner role from the connection string in the Neon console), connected to the
-- application database, with passwords you generate (for example `openssl rand -base64 24`):
--
--   psql "$ADMIN_DATABASE_URL" -v owner_pw="$CC_OWNER_PASSWORD" -v app_pw="$CC_APP_PASSWORD" -f scripts/neon-setup-roles.sql
--
-- Then:
--   * DATABASE_URL in Vercel         -> cc_app   (pooled connection string)
--   * MIGRATE_DATABASE_URL in GitHub -> cc_owner (direct, unpooled connection string)
-- and never use the admin role for the running app: it would bypass the database's per-college isolation.
--
--   cc_owner : migrations only.
--   cc_app   : the running app. Not a superuser, subject to row-level security, no DDL; gets per-table grants from the migrations.
--   cc_auth  : NOLOGIN. Owns the SECURITY DEFINER functions. BYPASSRLS, but only with the exact grants the migrations give it.

\set ON_ERROR_STOP on
\if :{?owner_pw}
\else
  \echo 'Missing -v owner_pw=...'
  \quit
\endif
\if :{?app_pw}
\else
  \echo 'Missing -v app_pw=...'
  \quit
\endif

CREATE ROLE cc_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE cc_app   LOGIN PASSWORD :'app_pw'   NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE cc_auth  NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT cc_auth TO cc_owner;   -- lets migrations assign function ownership

-- cc_owner creates the schemas, tables and extensions (pgcrypto, citext) inside this database.
SELECT format('GRANT CONNECT, CREATE ON DATABASE %I TO cc_owner', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO cc_app', current_database()) \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database()) \gexec

-- The migrations adjust privileges on schema public (grant to cc_app, revoke from PUBLIC), which only its owner may do. On a managed database the admin role
-- owns it, so hand it to cc_owner (the local docker setup gets the same result because cc_owner owns the database there).
GRANT cc_owner TO CURRENT_USER;
ALTER SCHEMA public OWNER TO cc_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO cc_app, cc_auth;
