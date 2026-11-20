-- 0036: notification links may not contain "#"; point the coordinator-placement notification at the page itself.
GRANT CREATE ON SCHEMA placement TO cc_auth;
SET LOCAL ROLE cc_auth;
DO $$
DECLARE v text := pg_get_functiondef('placement.record_manual_placement(uuid, uuid, numeric, date, text)'::regprocedure); v_new text;
BEGIN
  v_new := replace(v, '/placement/placements#coordinator-placements', '/placement/placements');
  IF v_new = v THEN RAISE EXCEPTION 'record_manual_placement did not have the expected text'; END IF;
  EXECUTE v_new;
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA placement FROM cc_auth;
