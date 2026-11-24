-- 0042: on-campus drives. A placement officer creates one (for a posted drive or a new company), adds rounds, and every round gets an attendance link.
-- Students open the link while signed in and mark themselves present; the officer then marks who is eligible for the next round, and so on.
-- Students never read these tables directly: they use the vetted functions below, which check eligibility in the database.

CREATE SCHEMA campus; REVOKE ALL ON SCHEMA campus FROM PUBLIC; GRANT USAGE ON SCHEMA campus TO cc_app; GRANT USAGE, CREATE ON SCHEMA campus TO cc_auth;

CREATE TABLE campus_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id     uuid NOT NULL,
  drive_id       uuid,                                   -- the posted drive this on-campus drive belongs to (then only its registered students may attend round 1)
  company_name   text NOT NULL CHECK (length(btrim(company_name)) BETWEEN 2 AND 150),
  title          text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 150),
  details        text CHECK (details IS NULL OR length(details) <= 3000),
  venue          text CHECK (venue IS NULL OR length(venue) <= 200),
  event_at       timestamptz NOT NULL,
  department_ids uuid[] NOT NULL DEFAULT '{}',           -- empty = every department
  passing_years  int[]  NOT NULL DEFAULT '{}',           -- empty = every batch
  status         text NOT NULL DEFAULT 'UPCOMING' CHECK (status IN ('UPCOMING', 'COMPLETED', 'CANCELLED')),
  created_by     uuid NOT NULL REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, id),
  FOREIGN KEY (college_id, drive_id) REFERENCES drives (college_id, id)
);
CREATE INDEX campus_events_college_idx ON campus_events (college_id, event_at DESC);

CREATE TABLE campus_rounds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id   uuid NOT NULL,
  event_id     uuid NOT NULL,
  round_number int NOT NULL CHECK (round_number BETWEEN 1 AND 10),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  scheduled_at timestamptz,
  token        text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),   -- the attendance link
  status       text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'OPEN', 'CLOSED')),
  opened_at    timestamptz,
  closed_at    timestamptz,
  UNIQUE (event_id, round_number),
  UNIQUE (college_id, id),
  FOREIGN KEY (college_id, event_id) REFERENCES campus_events (college_id, id)
);

CREATE TABLE campus_attendance (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  round_id   uuid NOT NULL,
  student_id uuid NOT NULL,
  marked_at  timestamptz NOT NULL DEFAULT now(),
  method     text NOT NULL CHECK (method IN ('SELF', 'MANUAL')),
  marked_by  uuid REFERENCES users (id),
  UNIQUE (round_id, student_id),
  FOREIGN KEY (college_id, round_id) REFERENCES campus_rounds (college_id, id),
  FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id)
);
CREATE INDEX campus_attendance_student_idx ON campus_attendance (student_id);

-- A row means: this student was marked eligible for the round AFTER round_id.
CREATE TABLE campus_advancement (
  college_id uuid NOT NULL,
  round_id   uuid NOT NULL,
  student_id uuid NOT NULL,
  decided_by uuid NOT NULL REFERENCES users (id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, student_id),
  FOREIGN KEY (college_id, round_id) REFERENCES campus_rounds (college_id, id),
  FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id)
);

GRANT SELECT, INSERT, UPDATE ON campus_events TO cc_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON campus_rounds TO cc_auth;
GRANT SELECT, INSERT, DELETE ON campus_attendance, campus_advancement TO cc_auth;
GRANT SELECT ON campus_events, campus_rounds, campus_attendance, campus_advancement TO cc_app;
ALTER TABLE campus_events      ENABLE ROW LEVEL SECURITY; ALTER TABLE campus_events      FORCE ROW LEVEL SECURITY;
ALTER TABLE campus_rounds      ENABLE ROW LEVEL SECURITY; ALTER TABLE campus_rounds      FORCE ROW LEVEL SECURITY;
ALTER TABLE campus_attendance  ENABLE ROW LEVEL SECURITY; ALTER TABLE campus_attendance  FORCE ROW LEVEL SECURITY;
ALTER TABLE campus_advancement ENABLE ROW LEVEL SECURITY; ALTER TABLE campus_advancement FORCE ROW LEVEL SECURITY;
-- Placement officers and college administrators read their college's on-campus drives. Students and coordinators read none directly.
CREATE POLICY campus_events_staff      ON campus_events      FOR SELECT TO cc_app USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN'));
CREATE POLICY campus_rounds_staff      ON campus_rounds      FOR SELECT TO cc_app USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN'));
CREATE POLICY campus_attendance_staff  ON campus_attendance  FOR SELECT TO cc_app USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN'));
CREATE POLICY campus_advancement_staff ON campus_advancement FOR SELECT TO cc_app USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN'));

-- ───────────── internal: may this student attend this round? ─────────────
-- Round 1: the event's audience (a posted drive's registered students, or the whole college), narrowed by the department / batch filters.
-- Round 2 and later: only students the officer marked eligible after the previous round.
CREATE FUNCTION campus.eligible(p_round uuid, p_student uuid) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r campus_rounds%ROWTYPE; e campus_events%ROWTYPE; st students%ROWTYPE;
BEGIN
  SELECT * INTO r FROM campus_rounds WHERE id = p_round; IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO st FROM students WHERE id = p_student AND college_id = r.college_id; IF NOT FOUND THEN RETURN false; END IF;
  IF r.round_number > 1 THEN
    RETURN EXISTS (SELECT 1 FROM campus_advancement a JOIN campus_rounds pr ON pr.id = a.round_id WHERE pr.event_id = r.event_id AND pr.round_number = r.round_number - 1 AND a.student_id = p_student);
  END IF;
  SELECT * INTO e FROM campus_events WHERE id = r.event_id;
  IF cardinality(e.department_ids) > 0 AND NOT (st.department_id = ANY (e.department_ids)) THEN RETURN false; END IF;
  IF cardinality(e.passing_years) > 0 AND NOT (st.passing_year = ANY (e.passing_years)) THEN RETURN false; END IF;
  IF e.drive_id IS NOT NULL THEN RETURN EXISTS (SELECT 1 FROM registrations g WHERE g.drive_id = e.drive_id AND g.student_id = p_student AND g.status = 'REGISTERED'); END IF;
  RETURN true;
END $$;

-- ───────────── officer: create and run an on-campus drive ─────────────
-- p_rounds: [{"name": "Aptitude", "scheduled_at": "2026-12-01T09:00:00Z"}, ...] (at least one).
CREATE FUNCTION campus.create_event(p_drive uuid, p_company text, p_title text, p_details text, p_venue text, p_event_at timestamptz, p_depts uuid[], p_years int[], p_rounds jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; v_id uuid; v_company text := btrim(coalesce(p_company, '')); d drives%ROWTYPE; x jsonb; v_no int := 0;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  IF p_event_at IS NULL THEN RAISE EXCEPTION 'Choose the date and time of the drive.' USING ERRCODE = '22023'; END IF;
  IF p_rounds IS NULL OR jsonb_typeof(p_rounds) <> 'array' OR jsonb_array_length(p_rounds) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Add between 1 and 10 rounds.' USING ERRCODE = '22023'; END IF;
  IF p_drive IS NOT NULL THEN
    SELECT * INTO d FROM drives WHERE id = p_drive AND college_id = v_c;
    IF NOT FOUND THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
    IF d.status NOT IN ('PUBLISHED', 'CLOSED') THEN RAISE EXCEPTION 'Choose a published drive.' USING ERRCODE = '22023'; END IF;
    v_company := d.company_name;
  END IF;
  IF length(v_company) < 2 THEN RAISE EXCEPTION 'Enter the company name.' USING ERRCODE = '22023'; END IF;
  IF cardinality(coalesce(p_depts, '{}')) > 0 AND (SELECT count(*) FROM departments WHERE id = ANY (p_depts) AND college_id = v_c) <> cardinality(p_depts) THEN RAISE EXCEPTION 'Choose departments of your college.' USING ERRCODE = '22023'; END IF;
  INSERT INTO campus_events (college_id, drive_id, company_name, title, details, venue, event_at, department_ids, passing_years, created_by)
  VALUES (v_c, p_drive, v_company, btrim(coalesce(nullif(btrim(p_title), ''), v_company || ' campus drive')), nullif(btrim(coalesce(p_details, '')), ''), nullif(btrim(coalesce(p_venue, '')), ''),
          p_event_at, coalesce(p_depts, '{}'), coalesce(p_years, '{}'), v_u) RETURNING id INTO v_id;
  FOR x IN SELECT * FROM jsonb_array_elements(p_rounds) LOOP
    v_no := v_no + 1;
    INSERT INTO campus_rounds (college_id, event_id, round_number, name, scheduled_at)
    VALUES (v_c, v_id, v_no, btrim(coalesce(nullif(btrim(x ->> 'name'), ''), 'Round ' || v_no)), nullif(x ->> 'scheduled_at', '')::timestamptz);
  END LOOP;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'CAMPUS_EVENT_CREATED', 'campus_event', v_id::text, jsonb_build_object('company', v_company, 'rounds', v_no), NULL);
  RETURN v_id;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Some details are invalid. Check the names and the date.' USING ERRCODE = '22023';
END $$;

CREATE FUNCTION campus.update_event(p_id uuid, p_title text, p_details text, p_venue text, p_event_at timestamptz) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  UPDATE campus_events SET title = btrim(p_title), details = nullif(btrim(coalesce(p_details, '')), ''), venue = nullif(btrim(coalesce(p_venue, '')), ''), event_at = p_event_at, updated_at = now()
   WHERE id = p_id AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'on-campus drive not found' USING ERRCODE = '22023'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'CAMPUS_EVENT_UPDATED', 'campus_event', p_id::text, '{}'::jsonb, NULL);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Some details are invalid.' USING ERRCODE = '22023';
END $$;

CREATE FUNCTION campus.set_event_status(p_id uuid, p_status text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  IF p_status NOT IN ('UPCOMING', 'COMPLETED', 'CANCELLED') THEN RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023'; END IF;
  UPDATE campus_events SET status = p_status, updated_at = now() WHERE id = p_id AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'on-campus drive not found' USING ERRCODE = '22023'; END IF;
  IF p_status <> 'UPCOMING' THEN UPDATE campus_rounds SET status = 'CLOSED', closed_at = now() WHERE event_id = p_id AND status = 'OPEN'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'CAMPUS_EVENT_' || p_status, 'campus_event', p_id::text, '{}'::jsonb, NULL);
END $$;

CREATE FUNCTION campus.add_round(p_event uuid, p_name text, p_scheduled timestamptz) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; v_no int; v_id uuid;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  PERFORM 1 FROM campus_events WHERE id = p_event AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'on-campus drive not found' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(max(round_number), 0) + 1 INTO v_no FROM campus_rounds WHERE event_id = p_event;
  IF v_no > 10 THEN RAISE EXCEPTION 'An on-campus drive can have at most 10 rounds.' USING ERRCODE = '22023'; END IF;
  INSERT INTO campus_rounds (college_id, event_id, round_number, name, scheduled_at) VALUES (v_c, p_event, v_no, btrim(coalesce(nullif(btrim(p_name), ''), 'Round ' || v_no)), p_scheduled) RETURNING id INTO v_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'CAMPUS_ROUND_ADDED', 'campus_event', p_event::text, jsonb_build_object('round', v_no), NULL);
  RETURN v_id;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Some details are invalid.' USING ERRCODE = '22023';
END $$;

-- Opening a round starts attendance (the link works) and tells the students who may attend. Closing stops it.
CREATE FUNCTION campus.set_round_status(p_round uuid, p_status text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; r campus_rounds%ROWTYPE; e campus_events%ROWTYPE; v_users uuid[];
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  IF p_status NOT IN ('OPEN', 'CLOSED') THEN RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM campus_rounds WHERE id = p_round AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'round not found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO e FROM campus_events WHERE id = r.event_id;
  IF p_status = 'OPEN' THEN
    IF e.status <> 'UPCOMING' THEN RAISE EXCEPTION 'This on-campus drive is %. Reopen it first.', lower(e.status) USING ERRCODE = '22023'; END IF;
    IF r.status = 'OPEN' THEN RETURN; END IF;
    IF r.round_number > 1 AND NOT EXISTS (SELECT 1 FROM campus_advancement a JOIN campus_rounds pr ON pr.id = a.round_id WHERE pr.event_id = r.event_id AND pr.round_number = r.round_number - 1) THEN
      RAISE EXCEPTION 'Mark at least one student eligible after round % before opening this round.', r.round_number - 1 USING ERRCODE = '22023';
    END IF;
    UPDATE campus_rounds SET status = 'OPEN', opened_at = coalesce(opened_at, now()), closed_at = NULL WHERE id = p_round;
    IF r.opened_at IS NULL THEN
      SELECT coalesce(array_agg(st.user_id), '{}') INTO v_users FROM students st WHERE st.college_id = v_c AND st.user_id IS NOT NULL AND campus.eligible(p_round, st.id);
      PERFORM notifications.push_many(v_c, v_users, 'ROUNDS', 'Attendance open: ' || r.name, e.company_name || ' on-campus drive. Open it and mark yourself present.', '/student/campus');
    END IF;
  ELSE
    IF r.status <> 'OPEN' THEN RETURN; END IF;
    UPDATE campus_rounds SET status = 'CLOSED', closed_at = now() WHERE id = p_round;
  END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'CAMPUS_ROUND_' || p_status, 'campus_event', r.event_id::text, jsonb_build_object('round', r.round_number), NULL);
END $$;

-- The officer marks students present or absent by hand (late arrivals, phone problems). Round 1: any student of the college; later rounds: only those eligible for it.
CREATE FUNCTION campus.set_attendance(p_round uuid, p_students uuid[], p_present boolean) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; r campus_rounds%ROWTYPE; s uuid; v_count int := 0; v_ok boolean;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  IF p_students IS NULL OR cardinality(p_students) = 0 THEN RETURN 0; END IF;
  IF cardinality(p_students) > 500 THEN RAISE EXCEPTION 'Choose at most 500 students at a time.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM campus_rounds WHERE id = p_round AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'round not found' USING ERRCODE = '22023'; END IF;
  FOREACH s IN ARRAY p_students LOOP
    IF p_present THEN
      v_ok := CASE WHEN r.round_number = 1 THEN EXISTS (SELECT 1 FROM students WHERE id = s AND college_id = v_c) ELSE campus.eligible(p_round, s) END;
      IF v_ok THEN INSERT INTO campus_attendance (college_id, round_id, student_id, method, marked_by) VALUES (v_c, p_round, s, 'MANUAL', v_u) ON CONFLICT (round_id, student_id) DO NOTHING; v_count := v_count + 1; END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM campus_advancement WHERE round_id = p_round AND student_id = s) THEN RAISE EXCEPTION 'A student already marked eligible for the next round cannot be marked absent. Remove that first.' USING ERRCODE = '22023'; END IF;
      DELETE FROM campus_attendance WHERE round_id = p_round AND student_id = s; v_count := v_count + 1;
    END IF;
  END LOOP;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'CAMPUS_ATTENDANCE_SET', 'campus_event', r.event_id::text, jsonb_build_object('round', r.round_number, 'present', p_present, 'count', v_count), NULL);
  RETURN v_count;
END $$;

-- Marks students eligible (or not) for the NEXT round. Only students present in this round can be marked; they are told.
CREATE FUNCTION campus.set_advancement(p_round uuid, p_students uuid[], p_advance boolean) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; r campus_rounds%ROWTYPE; e campus_events%ROWTYPE; nxt campus_rounds%ROWTYPE; v_new uuid[]; v_users uuid[]; v_count int;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  IF p_students IS NULL OR cardinality(p_students) = 0 THEN RETURN 0; END IF;
  IF cardinality(p_students) > 500 THEN RAISE EXCEPTION 'Choose at most 500 students at a time.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM campus_rounds WHERE id = p_round AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'round not found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO e FROM campus_events WHERE id = r.event_id;
  SELECT * INTO nxt FROM campus_rounds WHERE event_id = r.event_id AND round_number = r.round_number + 1;
  IF p_advance THEN
    WITH ins AS (
      INSERT INTO campus_advancement (college_id, round_id, student_id, decided_by)
      SELECT v_c, p_round, a.student_id, v_u FROM campus_attendance a WHERE a.round_id = p_round AND a.student_id = ANY (p_students)
      ON CONFLICT (round_id, student_id) DO NOTHING RETURNING student_id)
    SELECT coalesce(array_agg(student_id), '{}') INTO v_new FROM ins;
    v_count := cardinality(v_new);
    IF v_count > 0 AND nxt.id IS NOT NULL THEN
      SELECT coalesce(array_agg(st.user_id), '{}') INTO v_users FROM students st WHERE st.id = ANY (v_new) AND st.user_id IS NOT NULL;
      PERFORM notifications.push_many(v_c, v_users, 'ROUNDS', 'You are eligible for the next round', e.company_name || ': ' || nxt.name || '. Watch for the attendance link.', '/student/campus');
    END IF;
  ELSE
    IF nxt.id IS NOT NULL AND EXISTS (SELECT 1 FROM campus_attendance WHERE round_id = nxt.id AND student_id = ANY (p_students)) THEN
      RAISE EXCEPTION 'A student who already attended the next round cannot be removed from it.' USING ERRCODE = '22023';
    END IF;
    DELETE FROM campus_advancement WHERE round_id = p_round AND student_id = ANY (p_students);
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'CAMPUS_ADVANCEMENT_SET', 'campus_event', r.event_id::text, jsonb_build_object('round', r.round_number, 'advance', p_advance, 'count', v_count), NULL);
  RETURN v_count;
END $$;

-- Per round: how many may attend, how many did, how many were moved on.
CREATE FUNCTION campus.round_stats(p_event uuid) RETURNS TABLE (round_id uuid, round_number int, eligible int, present int, advanced int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); e campus_events%ROWTYPE;
BEGIN
  IF v_c IS NULL OR app.current_role() NOT IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO e FROM campus_events WHERE id = p_event AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'on-campus drive not found' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
  SELECT r.id, r.round_number,
    CASE WHEN r.round_number = 1 THEN
      (SELECT count(*)::int FROM students st WHERE st.college_id = v_c
          AND (cardinality(e.department_ids) = 0 OR st.department_id = ANY (e.department_ids))
          AND (cardinality(e.passing_years) = 0 OR st.passing_year = ANY (e.passing_years))
          AND (e.drive_id IS NULL OR EXISTS (SELECT 1 FROM registrations g WHERE g.drive_id = e.drive_id AND g.student_id = st.id AND g.status = 'REGISTERED')))
    ELSE (SELECT count(*)::int FROM campus_advancement a JOIN campus_rounds pr ON pr.id = a.round_id WHERE pr.event_id = r.event_id AND pr.round_number = r.round_number - 1) END,
    (SELECT count(*)::int FROM campus_attendance a WHERE a.round_id = r.id),
    (SELECT count(*)::int FROM campus_advancement a WHERE a.round_id = r.id)
  FROM campus_rounds r WHERE r.event_id = p_event ORDER BY r.round_number;
END $$;

-- Students present in a round, with whether they were moved on.
CREATE FUNCTION campus.round_roster(p_round uuid) RETURNS TABLE (student_id uuid, full_name text, register_number text, department_code text, passing_year int, marked_at timestamptz, method text, advanced boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id();
BEGIN
  IF v_c IS NULL OR app.current_role() NOT IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT st.id, st.full_name::text, st.register_number::text, dp.code::text, st.passing_year, a.marked_at, a.method,
         EXISTS (SELECT 1 FROM campus_advancement v WHERE v.round_id = p_round AND v.student_id = st.id)
    FROM campus_attendance a JOIN students st ON st.id = a.student_id JOIN departments dp ON dp.id = st.department_id
   WHERE a.round_id = p_round AND a.college_id = v_c ORDER BY dp.code, st.full_name;
END $$;

-- Students who may attend the round but are not marked present (to mark by hand). Optional search by name or register number.
CREATE FUNCTION campus.round_missing(p_round uuid, p_q text) RETURNS TABLE (student_id uuid, full_name text, register_number text, department_code text, passing_year int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); r campus_rounds%ROWTYPE; q text := nullif(btrim(coalesce(p_q, '')), '');
BEGIN
  IF v_c IS NULL OR app.current_role() <> 'PLACEMENT_OFFICER' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM campus_rounds WHERE id = p_round AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'round not found' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
  SELECT st.id, st.full_name::text, st.register_number::text, dp.code::text, st.passing_year
    FROM students st JOIN departments dp ON dp.id = st.department_id
   WHERE st.college_id = v_c AND NOT EXISTS (SELECT 1 FROM campus_attendance a WHERE a.round_id = p_round AND a.student_id = st.id)
     AND (q IS NULL OR st.full_name ILIKE '%' || q || '%' OR st.register_number::text ILIKE '%' || q || '%')
     AND (r.round_number = 1 AND (q IS NOT NULL OR campus.eligible(p_round, st.id)) OR r.round_number > 1 AND campus.eligible(p_round, st.id))
   ORDER BY dp.code, st.full_name LIMIT 200;
END $$;

-- ───────────── student: see my on-campus drives, and mark attendance ─────────────
-- One row per round of every on-campus drive the student may take part in. The link token is revealed only while attendance is open for them.
CREATE FUNCTION campus.my_events() RETURNS TABLE (event_id uuid, title text, company_name text, event_at timestamptz, venue text, details text, event_status text,
                                                  round_id uuid, round_number int, round_name text, round_status text, scheduled_at timestamptz, eligible boolean, present boolean, advanced boolean, token text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_s uuid;
BEGIN
  IF v_c IS NULL OR app.current_role() <> 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_s FROM students WHERE user_id = app.current_user_id() AND college_id = v_c;
  IF v_s IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH mine AS (
    SELECT r.*, campus.eligible(r.id, v_s) AS ok FROM campus_rounds r WHERE r.college_id = v_c)
  SELECT e.id, e.title, e.company_name, e.event_at, e.venue, e.details, e.status, m.id, m.round_number, m.name, m.status, m.scheduled_at, m.ok,
         EXISTS (SELECT 1 FROM campus_attendance a WHERE a.round_id = m.id AND a.student_id = v_s),
         EXISTS (SELECT 1 FROM campus_advancement a WHERE a.round_id = m.id AND a.student_id = v_s),
         CASE WHEN m.ok AND m.status = 'OPEN' THEN m.token END
    FROM mine m JOIN campus_events e ON e.id = m.event_id
   WHERE e.status <> 'CANCELLED' AND (m.ok OR EXISTS (SELECT 1 FROM campus_attendance a WHERE a.round_id = m.id AND a.student_id = v_s)
          OR EXISTS (SELECT 1 FROM mine x WHERE x.event_id = e.id AND x.round_number = 1 AND x.ok))
   ORDER BY e.event_at DESC, e.id, m.round_number;
END $$;

-- What the attendance link shows a student before they confirm.
CREATE FUNCTION campus.peek_token(p_token text) RETURNS TABLE (event_id uuid, title text, company_name text, event_at timestamptz, venue text, round_number int, round_name text, round_status text, eligible boolean, present boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_s uuid;
BEGIN
  IF v_c IS NULL OR app.current_role() <> 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_s FROM students WHERE user_id = app.current_user_id() AND college_id = v_c;
  RETURN QUERY
  SELECT e.id, e.title, e.company_name, e.event_at, e.venue, r.round_number, r.name, r.status, v_s IS NOT NULL AND campus.eligible(r.id, v_s),
         EXISTS (SELECT 1 FROM campus_attendance a WHERE a.round_id = r.id AND a.student_id = v_s)
    FROM campus_rounds r JOIN campus_events e ON e.id = r.event_id WHERE r.token = p_token AND r.college_id = v_c AND e.status <> 'CANCELLED';
END $$;

-- The student marks themself present by the link. 'MARKED' or 'ALREADY'; anything else is explained as an error.
CREATE FUNCTION campus.mark_attendance(p_token text) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_u uuid := app.current_user_id(); v_s uuid; r campus_rounds%ROWTYPE; e campus_events%ROWTYPE; v_n int;
BEGIN
  IF v_c IS NULL OR app.current_role() <> 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_s FROM students WHERE user_id = v_u AND college_id = v_c;
  IF v_s IS NULL THEN RAISE EXCEPTION 'Your student record could not be found.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM campus_rounds WHERE token = p_token AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'This attendance link is not valid.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO e FROM campus_events WHERE id = r.event_id;
  IF e.status <> 'UPCOMING' THEN RAISE EXCEPTION 'This on-campus drive is %.', lower(e.status) USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM campus_attendance WHERE round_id = r.id AND student_id = v_s) THEN RETURN 'ALREADY'; END IF;
  IF r.status <> 'OPEN' THEN RAISE EXCEPTION '%', CASE WHEN r.status = 'PLANNED' THEN 'Attendance for this round has not opened yet.' ELSE 'Attendance for this round is closed. Ask the placement office.' END USING ERRCODE = '22023'; END IF;
  IF NOT campus.eligible(r.id, v_s) THEN
    RAISE EXCEPTION '%', CASE WHEN r.round_number > 1 THEN 'You are not on the list for this round.' ELSE 'You are not on the list for this drive. Ask the placement office.' END USING ERRCODE = '22023';
  END IF;
  INSERT INTO campus_attendance (college_id, round_id, student_id, method) VALUES (v_c, r.id, v_s, 'SELF') ON CONFLICT (round_id, student_id) DO NOTHING;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'STUDENT', 'CAMPUS_ATTENDANCE_MARKED', 'campus_event', r.event_id::text, jsonb_build_object('round', r.round_number), NULL);
  RETURN 'MARKED';
END $$;

-- ───────────── ownership and privileges (same pattern as every other vetted function) ─────────────
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'campus' LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION campus.create_event(uuid, text, text, text, text, timestamptz, uuid[], int[], jsonb), campus.update_event(uuid, text, text, text, timestamptz),
  campus.set_event_status(uuid, text), campus.add_round(uuid, text, timestamptz), campus.set_round_status(uuid, text), campus.set_attendance(uuid, uuid[], boolean),
  campus.set_advancement(uuid, uuid[], boolean), campus.round_stats(uuid), campus.round_roster(uuid), campus.round_missing(uuid, text),
  campus.my_events(), campus.peek_token(text), campus.mark_attendance(text) TO cc_app;      -- campus.eligible is internal
REVOKE CREATE ON SCHEMA campus FROM cc_auth;
