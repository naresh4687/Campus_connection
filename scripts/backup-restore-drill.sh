#!/usr/bin/env bash
# Backup and restore DRILL (local Docker Postgres). It proves that a logical backup of a CampusConnect database can be restored into a
# fresh database with identical data, intact roles/grants/RLS and an intact migration ledger. It does NOT replace the production
# mechanism (managed Postgres with point-in-time recovery, TD-14) and it does not back up object storage.
#
#   scripts/backup-restore-drill.sh [source_db]        (default: campusconnect_test)
set -euo pipefail
SRC="${1:-campusconnect_test}"
CONTAINER="${PG_CONTAINER:-campusconnect-postgres-1}"
DRILL="drill_restore_$(date +%s)"
ADMIN="postgresql://postgres:${POSTGRES_SUPERUSER_PASSWORD:-dev_superuser_pw}@localhost:5432"
OWNER_HOST_URL="postgresql://cc_owner:${CC_OWNER_PASSWORD:-dev_owner_pw}@127.0.0.1:5433"
psql_in() { docker exec -i "$CONTAINER" psql "$ADMIN/$1" -At -v ON_ERROR_STOP=1 "${@:2}"; }
fail() { echo "DRILL FAILED: $*" >&2; cleanup; exit 1; }
cleanup() { psql_in postgres -c "DROP DATABASE IF EXISTS $DRILL" >/dev/null 2>&1 || true; docker exec "$CONTAINER" rm -f /tmp/drill.dump >/dev/null 2>&1 || true; }
trap 'cleanup' EXIT

echo "== 1. backup $SRC (pg_dump custom format)"
t0=$(date +%s)
docker exec "$CONTAINER" pg_dump "$ADMIN/$SRC" -Fc -f /tmp/drill.dump
SIZE=$(docker exec "$CONTAINER" stat -c %s /tmp/drill.dump)
SUM=$(docker exec "$CONTAINER" sha256sum /tmp/drill.dump | cut -d' ' -f1)
echo "   dump: $SIZE bytes, sha256 $SUM"

echo "== 2. restore into a brand-new database $DRILL"
psql_in postgres -c "CREATE DATABASE $DRILL" >/dev/null
docker exec "$CONTAINER" pg_restore -d "$ADMIN/$DRILL" --exit-on-error /tmp/drill.dump
t1=$(date +%s); echo "   backup+restore took $((t1 - t0)) s"

if [ "${DRILL_SELFTEST:-}" = "tamper" ]; then   # negative control: change one value in the restored copy; the comparison below MUST then fail
  psql_in "$DRILL" -c "UPDATE users SET full_name = full_name || ' (tampered)' WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)" >/dev/null
fi

echo "== 3. every table has the same rows and the same content checksum"
TABLES=$(psql_in "$SRC" -c "SELECT n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY 1")
N=0; BAD=0; ROWS=0
for T in $TABLES; do
  Q="SELECT count(*) || ' ' || coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), 'empty') FROM $T x"
  A=$(psql_in "$SRC" -c "$Q"); B=$(psql_in "$DRILL" -c "$Q")
  N=$((N + 1)); ROWS=$((ROWS + ${A%% *}))
  if [ "$A" != "$B" ]; then echo "   MISMATCH in $T: source [$A] restored [$B]"; BAD=$((BAD + 1)); fi
done
[ "$BAD" -eq 0 ] || fail "$BAD table(s) differ"
echo "   $N tables, $ROWS rows: identical"
[ "$ROWS" -gt 100 ] || fail "the source database is nearly empty ($ROWS rows); run the browser tests first so the drill has data"

echo "== 4. security properties survived the restore"
V=$(psql_in "$DRILL" -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)")
[ "$V" = "4" ] || fail "unexpected number of tables without forced RLS ($V; expected the 4 internal tables)"
W=$(psql_in "$DRILL" -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND (has_table_privilege('cc_app', c.oid, 'INSERT') OR has_table_privilege('cc_app', c.oid, 'UPDATE') OR has_table_privilege('cc_app', c.oid, 'DELETE') OR has_any_column_privilege('cc_app', c.oid, 'INSERT') OR has_any_column_privilege('cc_app', c.oid, 'UPDATE'))")
[ "$W" = "0" ] || fail "the runtime role can write $W table(s) after restore"
D=$(psql_in "$DRILL" -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') AND (pg_get_userbyid(p.proowner) <> 'cc_auth' OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))")
[ "$D" = "0" ] || fail "$D definer function(s) lost their owner or pinned search_path"
echo "   forced RLS, no runtime writes, definer functions pinned: ok"
# Row-level security still hides data from the runtime role when no user context is set.
VISIBLE=$(docker exec -i "$CONTAINER" psql "postgresql://cc_app:${CC_APP_PASSWORD:-dev_app_pw}@localhost:5432/$DRILL" -At -c "SELECT count(*) FROM students")
TOTAL=$(psql_in "$DRILL" -c "SELECT count(*) FROM students")
[ "$VISIBLE" = "0" ] && [ "$TOTAL" -gt 0 ] || fail "RLS check: runtime role sees $VISIBLE of $TOTAL students without a user context"
echo "   RLS: runtime role sees 0 of $TOTAL students with no user context: ok"

echo "== 5. the migration ledger is intact: the migrator accepts the restored database (checksums verified, nothing to apply)"
OUT=$(MIGRATE_DATABASE_URL="$OWNER_HOST_URL/$DRILL" npx tsx scripts/migrate.ts 2>&1 | tail -3)
echo "$OUT" | sed 's/^/   /'
echo "$OUT" | grep -q "^applied: (none)" || fail "the migrator wanted to apply migrations to the restored database"

echo "DRILL PASSED: $SRC -> $DRILL ($N tables, $ROWS rows, $SIZE bytes, dump sha256 ${SUM:0:16}...)"
