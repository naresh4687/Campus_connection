#!/bin/bash
# Runs once, on first initialisation of an empty data directory.
#   cc_owner : owns databases/objects, used ONLY by migrations. Never used by the running app.
#   cc_auth  : NOLOGIN. Owns the SECURITY DEFINER functions in schema auth/app (pre-session lookups,
#              session/invitation/reset handling). BYPASSRLS, but only the exact table grants the
#              migrations give it. Nobody can log in as it; cc_app cannot SET ROLE to it.
#   cc_app   : runtime role. Not superuser, NOBYPASSRLS, no DDL. Gets explicit per-table grants in migrations.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres <<SQL
CREATE ROLE cc_owner LOGIN PASSWORD '${CC_OWNER_PASSWORD}' NOSUPERUSER NOBYPASSRLS CREATEDB;
CREATE ROLE cc_app   LOGIN PASSWORD '${CC_APP_PASSWORD}'   NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE cc_auth NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT cc_auth TO cc_owner; -- lets migrations assign function ownership and tests inspect via SET ROLE
CREATE DATABASE campusconnect_dev  OWNER cc_owner;
CREATE DATABASE campusconnect_test OWNER cc_owner;
SQL
for db in campusconnect_dev campusconnect_test; do
  psql -v ON_ERROR_STOP=1 --username postgres --dbname "$db" <<SQL
REVOKE ALL ON DATABASE $db FROM PUBLIC;
GRANT CONNECT ON DATABASE $db TO cc_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
done
