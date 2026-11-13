-- 0011_rounds: recruitment rounds, per-student results, and release.
-- Rules enforced in the database: only officers write; rounds exist only for PUBLISHED/CLOSED drives; results are recorded only after
-- registration is over (drive closed or deadline passed); round k>1 candidates are those SELECTED in a RELEASED round k-1; a round is
-- released only when every candidate has a decision; released rounds and their results are frozen; students see a result only after release.
-- Officer remarks live in the append-only history (never visible to students).

CREATE SCHEMA rounds; REVOKE ALL ON SCHEMA rounds FROM PUBLIC; GRANT USAGE ON SCHEMA rounds TO cc_app; GRANT USAGE, CREATE ON SCHEMA rounds TO cc_auth;

CREATE TABLE drive_rounds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id   uuid NOT NULL,
  drive_id     uuid NOT NULL,
  round_number int NOT NULL CHECK (round_number BETWEEN 1 AND 20),
  name         text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  kind         text NOT NULL CHECK (kind IN ('APTITUDE', 'TECHNICAL', 'GROUP_DISCUSSION', 'HR', 'OTHER')),
  scheduled_at timestamptz,
  venue        text CHECK (venue IS NULL OR char_length(venue) <= 300),
  instructions text CHECK (instructions IS NULL OR char_length(instructions) <= 2000),
  released_at  timestamptz,
  released_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (drive_id, round_number),
  UNIQUE (college_id, id),
  FOREIGN KEY (college_id, drive_id) REFERENCES drives (college_id, id),
  CONSTRAINT rounds_release_pair CHECK ((released_at IS NULL) = (released_by IS NULL))
);
CREATE TABLE round_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id      uuid NOT NULL,
  round_id        uuid NOT NULL,
  registration_id uuid NOT NULL,
  result          text NOT NULL CHECK (result IN ('PENDING', 'SELECTED', 'REJECTED', 'ABSENT')),
  updated_by      uuid NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, registration_id),
  FOREIGN KEY (college_id, round_id) REFERENCES drive_rounds (college_id, id),
  FOREIGN KEY (college_id, registration_id) REFERENCES registrations (college_id, id)
);
CREATE TABLE round_result_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  college_id      uuid NOT NULL,
  round_id        uuid NOT NULL,
  registration_id uuid NOT NULL,
  from_result     text,
  to_result       text NOT NULL,
  note            text CHECK (note IS NULL OR char_length(note) <= 500),
  actor_user_id   uuid NOT NULL,
  actor_name      text NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (college_id, round_id) REFERENCES drive_rounds (college_id, id),
  FOREIGN KEY (college_id, registration_id) REFERENCES registrations (college_id, id)
);
CREATE INDEX round_results_reg_idx ON round_results (registration_id);

CREATE FUNCTION rounds.guard_round() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.released_at IS NOT NULL THEN RAISE EXCEPTION 'a released round cannot be deleted' USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;
  IF (NEW.college_id, NEW.drive_id, NEW.round_number) IS DISTINCT FROM (OLD.college_id, OLD.drive_id, OLD.round_number) THEN RAISE EXCEPTION 'a round cannot be moved or renumbered' USING ERRCODE = '42501'; END IF;
  IF OLD.released_at IS NOT NULL AND (NEW.* IS DISTINCT FROM OLD.*) THEN RAISE EXCEPTION 'a released round is frozen' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rounds_guard BEFORE UPDATE OR DELETE ON drive_rounds FOR EACH ROW EXECUTE FUNCTION rounds.guard_round();
CREATE FUNCTION rounds.guard_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_released timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'results are retained' USING ERRCODE = '42501'; END IF;
  SELECT released_at INTO v_released FROM drive_rounds WHERE id = COALESCE(NEW.round_id, OLD.round_id);
  IF v_released IS NOT NULL THEN RAISE EXCEPTION 'results of a released round are frozen' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.round_id, NEW.registration_id, NEW.college_id) IS DISTINCT FROM (OLD.round_id, OLD.registration_id, OLD.college_id) THEN RAISE EXCEPTION 'a result cannot be moved' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER results_guard BEFORE INSERT OR UPDATE OR DELETE ON round_results FOR EACH ROW EXECUTE FUNCTION rounds.guard_result();
CREATE FUNCTION rounds.append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'this history is append-only' USING ERRCODE = '42501'; END $$;
CREATE TRIGGER result_events_no_change BEFORE UPDATE OR DELETE ON round_result_events FOR EACH ROW EXECUTE FUNCTION rounds.append_only();

GRANT SELECT, INSERT, UPDATE, DELETE ON drive_rounds TO cc_auth;
GRANT SELECT, INSERT, UPDATE ON round_results TO cc_auth;
GRANT SELECT, INSERT ON round_result_events TO cc_auth;
GRANT SELECT ON drive_rounds, round_results, round_result_events TO cc_app;
ALTER TABLE drive_rounds        ENABLE ROW LEVEL SECURITY; ALTER TABLE drive_rounds        FORCE ROW LEVEL SECURITY;
ALTER TABLE round_results       ENABLE ROW LEVEL SECURITY; ALTER TABLE round_results       FORCE ROW LEVEL SECURITY;
ALTER TABLE round_result_events ENABLE ROW LEVEL SECURITY; ALTER TABLE round_result_events FORCE ROW LEVEL SECURITY;

-- Rounds (schedule): staff of the college; students only for drives they are currently registered for. Coordinators have no access.
CREATE POLICY rounds_select ON drive_rounds FOR SELECT TO cc_app USING (
  college_id = (SELECT app.current_college_id()) AND (
    (SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN')
    OR ((SELECT app.current_role()) = 'STUDENT' AND EXISTS (SELECT 1 FROM registrations r WHERE r.drive_id = drive_rounds.drive_id AND r.status = 'REGISTERED' AND r.student_id IN (SELECT st.id FROM students st)))));
-- Results: staff see all; a student sees ONLY their own and ONLY once the round is released.
CREATE POLICY results_select ON round_results FOR SELECT TO cc_app USING (
  college_id = (SELECT app.current_college_id()) AND (
    (SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN')
    OR ((SELECT app.current_role()) = 'STUDENT'
        AND round_id IN (SELECT dr.id FROM drive_rounds dr WHERE dr.released_at IS NOT NULL)
        AND registration_id IN (SELECT r.id FROM registrations r WHERE r.student_id IN (SELECT st.id FROM students st)))));
CREATE POLICY result_events_select ON round_result_events FOR SELECT TO cc_app USING (
  college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN'));

-- ───────────── functions ─────────────
CREATE FUNCTION rounds.save_round(p_id uuid, p_drive uuid, p_name text, p_kind text, p_scheduled timestamptz, p_venue text, p_instructions text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; d drives%ROWTYPE; v_id uuid; v_no int; r drive_rounds%ROWTYPE;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  IF btrim(coalesce(p_name, '')) = '' THEN RAISE EXCEPTION 'A round needs a name.' USING ERRCODE = '22023'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('APTITUDE', 'TECHNICAL', 'GROUP_DISCUSSION', 'HR', 'OTHER') THEN RAISE EXCEPTION 'Choose a valid round type.' USING ERRCODE = '22023'; END IF;
  IF p_id IS NULL THEN
    SELECT * INTO d FROM drives WHERE id = p_drive AND college_id = v_c FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
    IF d.status NOT IN ('PUBLISHED', 'CLOSED') THEN RAISE EXCEPTION 'Rounds can be added only to a published or closed drive.' USING ERRCODE = '22023'; END IF;
    SELECT coalesce(max(round_number), 0) + 1 INTO v_no FROM drive_rounds WHERE drive_id = p_drive;
    IF v_no > 20 THEN RAISE EXCEPTION 'A drive can have at most 20 rounds.' USING ERRCODE = '22023'; END IF;
    INSERT INTO drive_rounds (college_id, drive_id, round_number, name, kind, scheduled_at, venue, instructions)
    VALUES (v_c, p_drive, v_no, btrim(p_name), p_kind, p_scheduled, nullif(btrim(coalesce(p_venue, '')), ''), nullif(btrim(coalesce(p_instructions, '')), '')) RETURNING id INTO v_id;
    PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'ROUND_CREATED', 'drive', p_drive::text, jsonb_build_object('round', v_no), NULL);
  ELSE
    SELECT * INTO r FROM drive_rounds WHERE id = p_id AND college_id = v_c FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'round not found' USING ERRCODE = '22023'; END IF;
    IF r.released_at IS NOT NULL THEN RAISE EXCEPTION 'This round has been released and can no longer be edited.' USING ERRCODE = '22023'; END IF;
    UPDATE drive_rounds SET name = btrim(p_name), kind = p_kind, scheduled_at = p_scheduled, venue = nullif(btrim(coalesce(p_venue, '')), ''), instructions = nullif(btrim(coalesce(p_instructions, '')), ''), updated_at = now() WHERE id = p_id;
    v_id := p_id;
    PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'ROUND_UPDATED', 'drive', r.drive_id::text, jsonb_build_object('round', r.round_number), NULL);
  END IF;
  RETURN v_id;
END $$;

-- Only the LAST round can be deleted, and only while unreleased and without results.
CREATE FUNCTION rounds.delete_round(p_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; r drive_rounds%ROWTYPE;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  SELECT * INTO r FROM drive_rounds WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'round not found' USING ERRCODE = '22023'; END IF;
  IF r.released_at IS NOT NULL THEN RAISE EXCEPTION 'A released round cannot be deleted.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM drive_rounds WHERE drive_id = r.drive_id AND round_number > r.round_number) THEN RAISE EXCEPTION 'Only the last round can be deleted.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM round_results WHERE round_id = p_id) THEN RAISE EXCEPTION 'Results have been recorded for this round, so it cannot be deleted.' USING ERRCODE = '22023'; END IF;
  DELETE FROM drive_rounds WHERE id = p_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'ROUND_DELETED', 'drive', r.drive_id::text, jsonb_build_object('round', r.round_number), NULL);
END $$;

-- Who may be given a result in this round: round 1 = everyone currently registered; round k = those SELECTED in (released) round k-1.
CREATE FUNCTION rounds.candidates(p_round uuid) RETURNS TABLE (registration_id uuid)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r drive_rounds%ROWTYPE; v_prev uuid;
BEGIN
  SELECT * INTO r FROM drive_rounds WHERE id = p_round;
  IF NOT FOUND THEN RETURN; END IF;
  IF r.round_number = 1 THEN
    RETURN QUERY SELECT g.id FROM registrations g WHERE g.drive_id = r.drive_id AND g.status = 'REGISTERED';
  ELSE
    SELECT id INTO v_prev FROM drive_rounds WHERE drive_id = r.drive_id AND round_number = r.round_number - 1 AND released_at IS NOT NULL;
    IF v_prev IS NULL THEN RETURN; END IF;
    RETURN QUERY SELECT rr.registration_id FROM round_results rr WHERE rr.round_id = v_prev AND rr.result = 'SELECTED';
  END IF;
END $$;

CREATE FUNCTION rounds.set_results(p_round uuid, p_regs uuid[], p_result text, p_note text) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; r drive_rounds%ROWTYPE; d drives%ROWTYPE; g uuid; v_old text; v_count int := 0; v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  IF p_result IS NULL OR p_result NOT IN ('PENDING', 'SELECTED', 'REJECTED', 'ABSENT') THEN RAISE EXCEPTION 'Choose a valid result.' USING ERRCODE = '22023'; END IF;
  IF p_regs IS NULL OR cardinality(p_regs) = 0 THEN RAISE EXCEPTION 'Choose at least one student.' USING ERRCODE = '22023'; END IF;
  IF cardinality(p_regs) > 500 THEN RAISE EXCEPTION 'At most 500 students at a time.' USING ERRCODE = '22023'; END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 500 THEN RAISE EXCEPTION 'The remark is too long (500 characters).' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM drive_rounds WHERE id = p_round AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'round not found' USING ERRCODE = '22023'; END IF;
  IF r.released_at IS NOT NULL THEN RAISE EXCEPTION 'This round has been released; its results are final.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO d FROM drives WHERE id = r.drive_id;
  IF d.status NOT IN ('PUBLISHED', 'CLOSED') THEN RAISE EXCEPTION 'This drive is not active.' USING ERRCODE = '22023'; END IF;
  IF d.status = 'PUBLISHED' AND d.application_deadline > now() THEN RAISE EXCEPTION 'Results can be recorded only after registration has ended (close the drive or wait for the deadline).' USING ERRCODE = '22023'; END IF;
  IF r.round_number > 1 AND NOT EXISTS (SELECT 1 FROM drive_rounds WHERE drive_id = r.drive_id AND round_number = r.round_number - 1 AND released_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Release the previous round before recording results for this one.' USING ERRCODE = '22023';
  END IF;
  FOREACH g IN ARRAY (SELECT array_agg(DISTINCT x) FROM unnest(p_regs) x) LOOP
    IF NOT EXISTS (SELECT 1 FROM rounds.candidates(p_round) c WHERE c.registration_id = g) THEN
      RAISE EXCEPTION 'A chosen student is not a candidate for this round.' USING ERRCODE = '22023';
    END IF;
    SELECT result INTO v_old FROM round_results WHERE round_id = p_round AND registration_id = g FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO round_results (college_id, round_id, registration_id, result, updated_by) VALUES (v_c, p_round, g, p_result, v_u);
    ELSIF v_old = p_result AND v_note IS NULL THEN
      CONTINUE;
    ELSE
      UPDATE round_results SET result = p_result, updated_by = v_u, updated_at = now() WHERE round_id = p_round AND registration_id = g;
    END IF;
    INSERT INTO round_result_events (college_id, round_id, registration_id, from_result, to_result, note, actor_user_id, actor_name) VALUES (v_c, p_round, g, v_old, p_result, v_note, v_u, v_n);
    v_count := v_count + 1;
  END LOOP;
  IF v_count > 0 THEN PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'ROUND_RESULTS_SET', 'drive', r.drive_id::text, jsonb_build_object('round', r.round_number, 'count', v_count, 'result', p_result), NULL); END IF;
  RETURN v_count;
END $$;

CREATE FUNCTION rounds.release_round(p_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; r drive_rounds%ROWTYPE; v_undecided int;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  SELECT * INTO r FROM drive_rounds WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'round not found' USING ERRCODE = '22023'; END IF;
  IF r.released_at IS NOT NULL THEN RAISE EXCEPTION 'This round has already been released.' USING ERRCODE = '22023'; END IF;
  IF r.round_number > 1 AND NOT EXISTS (SELECT 1 FROM drive_rounds WHERE drive_id = r.drive_id AND round_number = r.round_number - 1 AND released_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Release the previous round first.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_undecided FROM rounds.candidates(p_id) c LEFT JOIN round_results rr ON rr.round_id = p_id AND rr.registration_id = c.registration_id WHERE rr.result IS NULL OR rr.result = 'PENDING';
  IF v_undecided > 0 THEN RAISE EXCEPTION '% student(s) still have no decision. Record a result for every candidate before releasing.', v_undecided USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM rounds.candidates(p_id)) THEN RAISE EXCEPTION 'There are no candidates in this round.' USING ERRCODE = '22023'; END IF;
  UPDATE drive_rounds SET released_at = now(), released_by = v_u, updated_at = now() WHERE id = p_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'ROUND_RELEASED', 'drive', r.drive_id::text, jsonb_build_object('round', r.round_number), NULL);
END $$;

-- Officer/admin roster for one round: every candidate with their current decision and the verified numbers are NOT included (this is about results).
CREATE FUNCTION rounds.roster(p_round uuid) RETURNS TABLE (registration_id uuid, student_id uuid, full_name text, register_number text, department_code text, result text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id();
BEGIN
  IF app.current_role() IS DISTINCT FROM 'PLACEMENT_OFFICER' AND app.current_role() IS DISTINCT FROM 'COLLEGE_ADMIN' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM drive_rounds WHERE id = p_round AND college_id = v_c) THEN RAISE EXCEPTION 'round not found' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
  SELECT c.registration_id, st.id, st.full_name, st.register_number::text, dp.code::text, coalesce(rr.result, 'PENDING')
    FROM rounds.candidates(p_round) c JOIN registrations g ON g.id = c.registration_id JOIN students st ON st.id = g.student_id JOIN departments dp ON dp.id = st.department_id
    LEFT JOIN round_results rr ON rr.round_id = p_round AND rr.registration_id = c.registration_id
   ORDER BY st.full_name, st.id;
END $$;

-- Staff: decision history for a drive, with student names (officers cannot read the students table directly).
CREATE FUNCTION rounds.history(p_drive uuid) RETURNS TABLE (round_number int, full_name text, from_result text, to_result text, note text, actor_name text, occurred_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id();
BEGIN
  IF app.current_role() IS DISTINCT FROM 'PLACEMENT_OFFICER' AND app.current_role() IS DISTINCT FROM 'COLLEGE_ADMIN' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM drives WHERE id = p_drive AND college_id = v_c) THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
  SELECT dr.round_number, st.full_name, e.from_result, e.to_result, e.note, e.actor_name, e.occurred_at
    FROM round_result_events e JOIN drive_rounds dr ON dr.id = e.round_id JOIN registrations g ON g.id = e.registration_id JOIN students st ON st.id = g.student_id
   WHERE dr.drive_id = p_drive AND e.college_id = v_c ORDER BY e.id DESC LIMIT 200;
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'rounds' AND p.proname NOT IN ('guard_round', 'guard_result', 'append_only') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION rounds.save_round(uuid, uuid, text, text, timestamptz, text, text), rounds.delete_round(uuid), rounds.set_results(uuid, uuid[], text, text),
  rounds.release_round(uuid), rounds.roster(uuid), rounds.history(uuid) TO cc_app;      -- rounds.candidates is internal
REVOKE CREATE ON SCHEMA rounds FROM cc_auth;
