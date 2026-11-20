-- 0033_extend_deadline: a placement officer can extend the deadline of a PUBLISHED drive (the deadline closes registration automatically; extending reopens it).
--   A published drive's content is frozen, so the guard gets one narrow exception: the transaction-local flag app.deadline_extension, which only
--   placement.extend_deadline() sets, and which that function uses to change nothing but the deadline.

GRANT CREATE ON SCHEMA placement TO cc_auth;
DO $$
DECLARE v text := pg_get_functiondef('placement.drive_guard()'::regprocedure); v_new text;
BEGIN
  v_new := replace(v, 'IF OLD.status <> ''DRAFT'' AND OLD.status = NEW.status AND', 'IF OLD.status <> ''DRAFT'' AND OLD.status = NEW.status AND coalesce(current_setting(''app.deadline_extension'', true), '''') <> ''on'' AND');
  IF v_new = v THEN RAISE EXCEPTION 'drive_guard did not have the expected text'; END IF;
  EXECUTE v_new;
END $$;

CREATE FUNCTION placement.extend_deadline(p_drive uuid, p_deadline timestamptz, p_reason text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); d drives%ROWTYPE; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF v_user IS NULL OR v_c IS NULL OR app.current_role() IS DISTINCT FROM 'PLACEMENT_OFFICER' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO d FROM drives WHERE id = p_drive AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Drive not found.' USING ERRCODE = '22023'; END IF;
  IF d.status <> 'PUBLISHED' THEN RAISE EXCEPTION 'Only a published drive can have its deadline extended.' USING ERRCODE = '22023'; END IF;
  IF p_deadline IS NULL OR p_deadline <= now() THEN RAISE EXCEPTION 'Choose a new deadline in the future.' USING ERRCODE = '22023'; END IF;
  IF p_deadline <= d.application_deadline THEN RAISE EXCEPTION 'The new deadline must be later than the current one.' USING ERRCODE = '22023'; END IF;
  IF v_reason IS NULL OR length(v_reason) < 5 THEN RAISE EXCEPTION 'Say why the deadline is extended (at least 5 characters).' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.deadline_extension', 'on', true);
  UPDATE drives SET application_deadline = p_deadline, updated_by = v_user, updated_at = now() WHERE id = p_drive;
  PERFORM set_config('app.deadline_extension', 'off', true);
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'PLACEMENT_OFFICER', 'DRIVE_DEADLINE_EXTENDED', 'drive', p_drive::text, jsonb_build_object('from', d.application_deadline, 'to', p_deadline, 'reason', v_reason), NULL);
END $$;
ALTER FUNCTION placement.extend_deadline(uuid, timestamptz, text) OWNER TO cc_auth;
REVOKE CREATE ON SCHEMA placement FROM cc_auth;
REVOKE ALL ON FUNCTION placement.extend_deadline(uuid, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION placement.extend_deadline(uuid, timestamptz, text) TO cc_app;
