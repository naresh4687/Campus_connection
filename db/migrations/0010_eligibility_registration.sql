-- 0010_eligibility_registration: the deterministic academic eligibility engine (single implementation, inside the database),
-- append-only evaluation snapshots, and student registration for drives with every rule enforced server-side in one transaction.
--
-- Engine rules (TD-10): inclusive thresholds; a missing value is NEVER zero (-> NEEDS_DATA); only the VERIFIED academic record
-- counts; identity criteria (department / degree / passing year) can make a student NOT_ELIGIBLE even without academic data.
-- AI and non-academic data are never inputs. engine_version is stored with every snapshot.

CREATE SCHEMA eligibility;  REVOKE ALL ON SCHEMA eligibility FROM PUBLIC;  GRANT USAGE ON SCHEMA eligibility TO cc_app;  GRANT USAGE, CREATE ON SCHEMA eligibility TO cc_auth;
CREATE SCHEMA registrations; REVOKE ALL ON SCHEMA registrations FROM PUBLIC; GRANT USAGE ON SCHEMA registrations TO cc_app; GRANT USAGE, CREATE ON SCHEMA registrations TO cc_auth;
GRANT CREATE ON SCHEMA placement TO cc_auth;     -- temporary; revoked at the end
GRANT CREATE ON SCHEMA documents TO cc_auth;     -- temporary; revoked at the end

CREATE TABLE eligibility_evaluations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id     uuid NOT NULL,
  drive_id       uuid NOT NULL,
  student_id     uuid NOT NULL,
  submission_id  uuid,                         -- the VERIFIED academic submission the numbers came from (NULL if none existed)
  result         text NOT NULL CHECK (result IN ('ELIGIBLE', 'NOT_ELIGIBLE', 'NEEDS_DATA')),
  checks         jsonb NOT NULL,
  engine_version text NOT NULL,
  context        text NOT NULL CHECK (context IN ('CHECK', 'REGISTRATION')),
  evaluated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, id),
  FOREIGN KEY (college_id, drive_id) REFERENCES drives (college_id, id),
  FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id)
);
CREATE INDEX eval_student_drive_idx ON eligibility_evaluations (student_id, drive_id, evaluated_at DESC);
CREATE FUNCTION eligibility.append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'this history is append-only' USING ERRCODE = '42501'; END $$;
CREATE TRIGGER eval_no_change BEFORE UPDATE OR DELETE ON eligibility_evaluations FOR EACH ROW EXECUTE FUNCTION eligibility.append_only();

CREATE TABLE registrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id    uuid NOT NULL,
  drive_id      uuid NOT NULL,
  student_id    uuid NOT NULL,
  status        text NOT NULL DEFAULT 'REGISTERED' CHECK (status IN ('REGISTERED', 'WITHDRAWN')),
  evaluation_id uuid NOT NULL,                  -- the registration-time evaluation (ELIGIBLE) this registration rests on
  registered_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at  timestamptz,
  UNIQUE (drive_id, student_id),
  UNIQUE (college_id, id),
  FOREIGN KEY (college_id, drive_id) REFERENCES drives (college_id, id),
  FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id),
  FOREIGN KEY (college_id, evaluation_id) REFERENCES eligibility_evaluations (college_id, id),
  CONSTRAINT registrations_withdrawn CHECK ((status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL))
);
CREATE INDEX registrations_drive_idx ON registrations (drive_id, status);
CREATE TABLE registration_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  college_id      uuid NOT NULL,
  registration_id uuid NOT NULL,
  event           text NOT NULL CHECK (event IN ('REGISTERED', 'WITHDRAWN', 'RE_REGISTERED')),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (college_id, registration_id) REFERENCES registrations (college_id, id)
);
CREATE TRIGGER reg_events_no_change BEFORE UPDATE OR DELETE ON registration_events FOR EACH ROW EXECUTE FUNCTION eligibility.append_only();
CREATE FUNCTION registrations.guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'registrations are retained' USING ERRCODE = '42501'; END IF;
  IF (NEW.college_id, NEW.drive_id, NEW.student_id) IS DISTINCT FROM (OLD.college_id, OLD.drive_id, OLD.student_id) THEN RAISE EXCEPTION 'a registration cannot be moved' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER registrations_guard BEFORE UPDATE OR DELETE ON registrations FOR EACH ROW EXECUTE FUNCTION registrations.guard();

GRANT SELECT, INSERT ON eligibility_evaluations, registration_events TO cc_auth;
GRANT SELECT, INSERT, UPDATE ON registrations TO cc_auth;
GRANT SELECT ON eligibility_evaluations, registrations, registration_events TO cc_app;
ALTER TABLE eligibility_evaluations ENABLE ROW LEVEL SECURITY; ALTER TABLE eligibility_evaluations FORCE ROW LEVEL SECURITY;
ALTER TABLE registrations           ENABLE ROW LEVEL SECURITY; ALTER TABLE registrations           FORCE ROW LEVEL SECURITY;
ALTER TABLE registration_events     ENABLE ROW LEVEL SECURITY; ALTER TABLE registration_events     FORCE ROW LEVEL SECURITY;

-- Evaluations: whoever can see the student (self, coordinator of the department, admin). Officers see registrations, not evaluations.
CREATE POLICY eval_select ON eligibility_evaluations FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND student_id IN (SELECT st.id FROM students st));
CREATE POLICY registrations_select ON registrations FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND ((SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN') OR student_id IN (SELECT st.id FROM students st)));
CREATE POLICY reg_events_select ON registration_events FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND registration_id IN (SELECT r.id FROM registrations r));

-- ───────────── the engine ─────────────
CREATE FUNCTION eligibility.add_check(p_checks jsonb, p_criterion text, p_required text, p_actual text, p_status text, p_message text) RETURNS jsonb
  LANGUAGE sql IMMUTABLE AS $$
  SELECT p_checks || jsonb_build_array(jsonb_build_object('criterion', p_criterion, 'required', p_required, 'actual', p_actual, 'status', p_status, 'message', p_message))
$$;

CREATE FUNCTION eligibility.evaluate(p_student uuid, p_drive uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  s students%ROWTYPE; c drive_criteria%ROWTYPE; v academic_submissions%ROWTYPE; ch jsonb := '[]'::jsonb; fails int := 0; missing int := 0; v_found boolean; v_open text; v_has_rejected boolean;
  v_dept_name text;
BEGIN
  SELECT * INTO s FROM students WHERE id = p_student;
  SELECT * INTO c FROM drive_criteria WHERE drive_id = p_drive;
  IF s.id IS NULL OR c.drive_id IS NULL OR s.college_id <> c.college_id THEN RAISE EXCEPTION 'student or drive not found' USING ERRCODE = '22023'; END IF;
  SELECT code::text INTO v_dept_name FROM departments WHERE id = s.department_id;

  -- identity criteria: decided without any academic data
  IF EXISTS (SELECT 1 FROM drive_departments WHERE drive_id = p_drive AND department_id = s.department_id) THEN
    ch := eligibility.add_check(ch, 'DEPARTMENT', 'Eligible departments', v_dept_name, 'PASS', NULL);
  ELSE
    fails := fails + 1; ch := eligibility.add_check(ch, 'DEPARTMENT', 'Eligible departments', v_dept_name, 'FAIL', 'Your department is not eligible for this drive.');
  END IF;
  IF cardinality(c.degrees) > 0 THEN
    IF s.degree = ANY (c.degrees) THEN ch := eligibility.add_check(ch, 'DEGREE', array_to_string(c.degrees, ', '), s.degree, 'PASS', NULL);
    ELSE fails := fails + 1; ch := eligibility.add_check(ch, 'DEGREE', array_to_string(c.degrees, ', '), s.degree, 'FAIL', 'Your degree is not eligible for this drive.'); END IF;
  END IF;
  IF s.passing_year = ANY (c.passing_years) THEN ch := eligibility.add_check(ch, 'PASSING_YEAR', array_to_string(c.passing_years, ', '), s.passing_year::text, 'PASS', NULL);
  ELSE fails := fails + 1; ch := eligibility.add_check(ch, 'PASSING_YEAR', array_to_string(c.passing_years, ', '), s.passing_year::text, 'FAIL', 'Your passing year is not eligible for this drive.'); END IF;

  -- academic criteria: only the VERIFIED record counts
  SELECT * INTO v FROM academic_submissions WHERE student_id = p_student AND status = 'VERIFIED';
  v_found := FOUND;
  IF NOT v_found THEN
    SELECT CASE WHEN EXISTS (SELECT 1 FROM academic_submissions WHERE student_id = p_student AND status = 'SUBMITTED') THEN 'PENDING' END INTO v_open;
    v_has_rejected := EXISTS (SELECT 1 FROM academic_submissions WHERE student_id = p_student AND status = 'REJECTED');
    missing := missing + 1;
    ch := eligibility.add_check(ch, 'ACADEMIC_RECORD', 'A verified academic record', 'none', 'MISSING',
      CASE WHEN v_open = 'PENDING' THEN 'Your academic record is awaiting verification by your coordinator.'
           WHEN v_has_rejected THEN 'Your last academic submission was rejected. Correct it and resubmit.'
           ELSE 'Submit your academic details so a coordinator can verify them.' END);
  ELSE
    ch := eligibility.add_check(ch, 'ACADEMIC_RECORD', 'A verified academic record', 'verified (version ' || v.version || ')', 'PASS', NULL);
  END IF;

  IF c.min_cgpa IS NOT NULL THEN
    IF NOT v_found THEN missing := missing + 1; ch := eligibility.add_check(ch, 'CGPA', '>= ' || c.min_cgpa, NULL, 'MISSING', 'Needs a verified record.');
    ELSIF v.cgpa >= c.min_cgpa THEN ch := eligibility.add_check(ch, 'CGPA', '>= ' || c.min_cgpa, v.cgpa::text, 'PASS', NULL);
    ELSE fails := fails + 1; ch := eligibility.add_check(ch, 'CGPA', '>= ' || c.min_cgpa, v.cgpa::text, 'FAIL', 'Your CGPA is below the minimum.'); END IF;
  END IF;
  IF c.min_tenth IS NOT NULL THEN
    IF NOT v_found THEN missing := missing + 1; ch := eligibility.add_check(ch, 'TENTH', '>= ' || c.min_tenth || '%', NULL, 'MISSING', 'Needs a verified record.');
    ELSIF v.tenth_percentage >= c.min_tenth THEN ch := eligibility.add_check(ch, 'TENTH', '>= ' || c.min_tenth || '%', v.tenth_percentage::text || '%', 'PASS', NULL);
    ELSE fails := fails + 1; ch := eligibility.add_check(ch, 'TENTH', '>= ' || c.min_tenth || '%', v.tenth_percentage::text || '%', 'FAIL', 'Your 10th percentage is below the minimum.'); END IF;
  END IF;
  IF c.min_twelfth IS NOT NULL THEN
    IF NOT v_found THEN missing := missing + 1; ch := eligibility.add_check(ch, 'TWELFTH', '>= ' || c.min_twelfth || '%', NULL, 'MISSING', 'Needs a verified record.');
    ELSIF v.twelfth_percentage IS NULL THEN missing := missing + 1; ch := eligibility.add_check(ch, 'TWELFTH', '>= ' || c.min_twelfth || '%', NULL, 'MISSING', 'Your 12th percentage is not on your verified record. It is never treated as zero.');
    ELSIF v.twelfth_percentage >= c.min_twelfth THEN ch := eligibility.add_check(ch, 'TWELFTH', '>= ' || c.min_twelfth || '%', v.twelfth_percentage::text || '%', 'PASS', NULL);
    ELSE fails := fails + 1; ch := eligibility.add_check(ch, 'TWELFTH', '>= ' || c.min_twelfth || '%', v.twelfth_percentage::text || '%', 'FAIL', 'Your 12th percentage is below the minimum.'); END IF;
  END IF;
  IF c.min_diploma IS NOT NULL THEN
    IF NOT v_found THEN missing := missing + 1; ch := eligibility.add_check(ch, 'DIPLOMA', '>= ' || c.min_diploma || '%', NULL, 'MISSING', 'Needs a verified record.');
    ELSIF v.diploma_percentage IS NULL THEN missing := missing + 1; ch := eligibility.add_check(ch, 'DIPLOMA', '>= ' || c.min_diploma || '%', NULL, 'MISSING', 'Your diploma percentage is not on your verified record. It is never treated as zero.');
    ELSIF v.diploma_percentage >= c.min_diploma THEN ch := eligibility.add_check(ch, 'DIPLOMA', '>= ' || c.min_diploma || '%', v.diploma_percentage::text || '%', 'PASS', NULL);
    ELSE fails := fails + 1; ch := eligibility.add_check(ch, 'DIPLOMA', '>= ' || c.min_diploma || '%', v.diploma_percentage::text || '%', 'FAIL', 'Your diploma percentage is below the minimum.'); END IF;
  END IF;
  IF c.max_active_backlogs IS NOT NULL THEN
    IF NOT v_found THEN missing := missing + 1; ch := eligibility.add_check(ch, 'ACTIVE_BACKLOGS', '<= ' || c.max_active_backlogs, NULL, 'MISSING', 'Needs a verified record.');
    ELSIF v.active_backlogs <= c.max_active_backlogs THEN ch := eligibility.add_check(ch, 'ACTIVE_BACKLOGS', '<= ' || c.max_active_backlogs, v.active_backlogs::text, 'PASS', NULL);
    ELSE fails := fails + 1; ch := eligibility.add_check(ch, 'ACTIVE_BACKLOGS', '<= ' || c.max_active_backlogs, v.active_backlogs::text, 'FAIL', 'You have more active backlogs than allowed.'); END IF;
  END IF;
  IF c.max_historical_arrears IS NOT NULL THEN
    IF NOT v_found THEN missing := missing + 1; ch := eligibility.add_check(ch, 'HISTORICAL_ARREARS', '<= ' || c.max_historical_arrears, NULL, 'MISSING', 'Needs a verified record.');
    ELSIF v.historical_arrears <= c.max_historical_arrears THEN ch := eligibility.add_check(ch, 'HISTORICAL_ARREARS', '<= ' || c.max_historical_arrears, v.historical_arrears::text, 'PASS', NULL);
    ELSE fails := fails + 1; ch := eligibility.add_check(ch, 'HISTORICAL_ARREARS', '<= ' || c.max_historical_arrears, v.historical_arrears::text, 'FAIL', 'You have more historical arrears than allowed.'); END IF;
  END IF;

  RETURN jsonb_build_object('result', CASE WHEN fails > 0 THEN 'NOT_ELIGIBLE' WHEN missing > 0 THEN 'NEEDS_DATA' ELSE 'ELIGIBLE' END,
                            'engine_version', '1', 'submission_id', CASE WHEN v_found THEN v.id END, 'checks', ch);
END $$;

-- Student checks themselves against a visible drive (records a snapshot unless an identical one was just taken).
CREATE FUNCTION eligibility.check_drive(p_drive uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_sid uuid; r jsonb; v_last eligibility_evaluations%ROWTYPE;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_sid FROM students WHERE user_id = v_user AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'student record not found' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM drives WHERE id = p_drive AND college_id = v_c AND status IN ('PUBLISHED', 'CLOSED')) THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  r := eligibility.evaluate(v_sid, p_drive);
  SELECT * INTO v_last FROM eligibility_evaluations WHERE student_id = v_sid AND drive_id = p_drive ORDER BY evaluated_at DESC, id LIMIT 1;
  IF NOT FOUND OR v_last.checks IS DISTINCT FROM r->'checks' OR v_last.result <> r->>'result' THEN
    INSERT INTO eligibility_evaluations (college_id, drive_id, student_id, submission_id, result, checks, engine_version, context)
    VALUES (v_c, p_drive, v_sid, (r->>'submission_id')::uuid, r->>'result', r->'checks', r->>'engine_version', 'CHECK');
  END IF;
  RETURN r;
END $$;

-- Per-drive summary for the signed-in student (not persisted).
CREATE FUNCTION eligibility.my_drives() RETURNS TABLE (drive_id uuid, result text, registration_status text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_sid uuid; d record;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_sid FROM students WHERE user_id = v_user AND college_id = v_c;
  IF NOT FOUND THEN RETURN; END IF;
  FOR d IN SELECT id FROM drives WHERE college_id = v_c AND status IN ('PUBLISHED', 'CLOSED') LOOP
    drive_id := d.id; result := eligibility.evaluate(v_sid, d.id)->>'result';
    SELECT r.status INTO registration_status FROM registrations r WHERE r.drive_id = d.id AND r.student_id = v_sid;
    RETURN NEXT;
  END LOOP;
END $$;

-- Officers: aggregate counts only (no student-level data).
CREATE FUNCTION eligibility.drive_counts(p_drive uuid) RETURNS TABLE (eligible int, needs_data int, not_eligible int, registered int, withdrawn int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); s record; r text; e int := 0; n int := 0; x int := 0; total int;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'PLACEMENT_OFFICER' AND app.current_role() IS DISTINCT FROM 'COLLEGE_ADMIN' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM drives WHERE id = p_drive AND college_id = v_c) THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO total FROM students WHERE college_id = v_c;
  FOR s IN SELECT st.id FROM students st WHERE st.college_id = v_c AND st.department_id IN (SELECT department_id FROM drive_departments WHERE drive_id = p_drive) LOOP
    r := eligibility.evaluate(s.id, p_drive)->>'result';
    IF r = 'ELIGIBLE' THEN e := e + 1; ELSIF r = 'NEEDS_DATA' THEN n := n + 1; ELSE x := x + 1; END IF;
  END LOOP;
  eligible := e; needs_data := n;
  not_eligible := total - e - n;                       -- everyone else, including students outside the eligible departments
  registered := (SELECT count(*) FROM registrations WHERE drive_id = p_drive AND status = 'REGISTERED');
  withdrawn := (SELECT count(*) FROM registrations WHERE drive_id = p_drive AND status = 'WITHDRAWN');
  RETURN NEXT;
END $$;

-- ───────────── registration ─────────────
CREATE FUNCTION registrations.register(p_drive uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_sid uuid; d drives%ROWTYPE; r jsonb; v_eval uuid; v_reg registrations%ROWTYPE; v_id uuid; v_why text;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_sid FROM students WHERE user_id = v_user AND college_id = v_c FOR UPDATE;       -- serialises this student's registrations
  IF NOT FOUND THEN RAISE EXCEPTION 'student record not found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO d FROM drives WHERE id = p_drive AND college_id = v_c FOR SHARE;
  IF NOT FOUND OR d.status NOT IN ('PUBLISHED', 'CLOSED') THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  IF d.status <> 'PUBLISHED' THEN RAISE EXCEPTION 'Registration for this drive is closed.' USING ERRCODE = '22023'; END IF;
  IF d.application_deadline <= now() THEN RAISE EXCEPTION 'The application deadline has passed.' USING ERRCODE = '22023'; END IF;
  r := eligibility.evaluate(v_sid, p_drive);               -- re-checked HERE, never trusted from the client
  INSERT INTO eligibility_evaluations (college_id, drive_id, student_id, submission_id, result, checks, engine_version, context)
  VALUES (v_c, p_drive, v_sid, (r->>'submission_id')::uuid, r->>'result', r->'checks', r->>'engine_version', 'REGISTRATION') RETURNING id INTO v_eval;
  IF r->>'result' <> 'ELIGIBLE' THEN
    SELECT string_agg(x->>'message', ' ') INTO v_why FROM jsonb_array_elements(r->'checks') x WHERE x->>'status' <> 'PASS' AND x->>'message' IS NOT NULL;
    -- the refusal rolls this transaction back (no registration, no snapshot); the student sees the reasons
    RAISE EXCEPTION 'You are not eligible to register: %', coalesce(v_why, r->>'result') USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_reg FROM registrations WHERE drive_id = p_drive AND student_id = v_sid FOR UPDATE;
  IF FOUND THEN
    IF v_reg.status = 'REGISTERED' THEN RAISE EXCEPTION 'You are already registered for this drive.' USING ERRCODE = '23505'; END IF;
    UPDATE registrations SET status = 'REGISTERED', withdrawn_at = NULL, evaluation_id = v_eval, registered_at = now() WHERE id = v_reg.id;
    INSERT INTO registration_events (college_id, registration_id, event) VALUES (v_c, v_reg.id, 'RE_REGISTERED');
    v_id := v_reg.id;
  ELSE
    INSERT INTO registrations (college_id, drive_id, student_id, evaluation_id) VALUES (v_c, p_drive, v_sid, v_eval) RETURNING id INTO v_id;
    INSERT INTO registration_events (college_id, registration_id, event) VALUES (v_c, v_id, 'REGISTERED');
  END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'STUDENT', 'DRIVE_REGISTERED', 'drive', p_drive::text, '{}'::jsonb, NULL);
  RETURN v_id;
END $$;

CREATE FUNCTION registrations.withdraw(p_drive uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_sid uuid; d drives%ROWTYPE; v_reg registrations%ROWTYPE;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_sid FROM students WHERE user_id = v_user AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student record not found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO d FROM drives WHERE id = p_drive AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_reg FROM registrations WHERE drive_id = p_drive AND student_id = v_sid FOR UPDATE;
  IF NOT FOUND OR v_reg.status <> 'REGISTERED' THEN RAISE EXCEPTION 'You are not registered for this drive.' USING ERRCODE = '22023'; END IF;
  IF d.status <> 'PUBLISHED' OR d.application_deadline <= now() THEN RAISE EXCEPTION 'You can only withdraw before the application deadline.' USING ERRCODE = '22023'; END IF;
  UPDATE registrations SET status = 'WITHDRAWN', withdrawn_at = now() WHERE id = v_reg.id;
  INSERT INTO registration_events (college_id, registration_id, event) VALUES (v_c, v_reg.id, 'WITHDRAWN');
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'STUDENT', 'DRIVE_WITHDRAWN', 'drive', p_drive::text, '{}'::jsonb, NULL);
END $$;

-- Officers see the students registered for their drives (and only those), with the verified numbers they were judged on.
CREATE FUNCTION registrations.list_for_drive(p_drive uuid) RETURNS TABLE (
  student_id uuid, full_name text, register_number text, department_code text, degree text, passing_year int, college_email text, phone text,
  cgpa numeric, tenth numeric, twelfth numeric, diploma numeric, active_backlogs int, historical_arrears int, registered_at timestamptz, resume_id uuid)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id();
BEGIN
  IF app.current_role() IS DISTINCT FROM 'PLACEMENT_OFFICER' THEN RAISE EXCEPTION 'placement officers only' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM drives WHERE id = p_drive AND college_id = v_c) THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
  SELECT st.id, st.full_name, st.register_number::text, dp.code::text, st.degree, st.passing_year, st.college_email::text, st.phone,
         a.cgpa, a.tenth_percentage, a.twelfth_percentage, a.diploma_percentage, a.active_backlogs, a.historical_arrears, r.registered_at,
         (SELECT d.id FROM documents d WHERE d.student_id = st.id AND d.kind = 'RESUME' AND d.status = 'ACTIVE' ORDER BY d.uploaded_at DESC LIMIT 1)
    FROM registrations r JOIN students st ON st.id = r.student_id JOIN departments dp ON dp.id = st.department_id
    JOIN eligibility_evaluations ev ON ev.id = r.evaluation_id LEFT JOIN academic_submissions a ON a.id = ev.submission_id
   WHERE r.drive_id = p_drive AND r.college_id = v_c AND r.status = 'REGISTERED' ORDER BY st.full_name;
END $$;

-- ───────────── ownership + execute privileges ─────────────
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname IN ('eligibility', 'registrations') AND p.proname NOT IN ('append_only', 'guard', 'add_check') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION eligibility.check_drive(uuid), eligibility.my_drives(), eligibility.drive_counts(uuid),
  registrations.register(uuid), registrations.withdraw(uuid), registrations.list_for_drive(uuid) TO cc_app;
-- eligibility.evaluate is internal: the app never asks the engine for an arbitrary student's result.

-- ───────────── Phase 8 rule: a drive that has registrations cannot be unpublished ─────────────
SET LOCAL ROLE cc_auth;
CREATE OR REPLACE FUNCTION placement.set_drive_status(p_id uuid, p_to text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; v_from text;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  IF p_to NOT IN ('DRAFT', 'CLOSED', 'ARCHIVED') THEN RAISE EXCEPTION 'use publish_drive to publish' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_from FROM drives WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  IF NOT ((v_from = 'PUBLISHED' AND p_to IN ('DRAFT', 'CLOSED')) OR (v_from IN ('DRAFT', 'CLOSED') AND p_to = 'ARCHIVED')) THEN
    RAISE EXCEPTION 'A % drive cannot be moved to %.', lower(v_from), lower(p_to) USING ERRCODE = '22023';
  END IF;
  IF p_to = 'DRAFT' AND EXISTS (SELECT 1 FROM registrations WHERE drive_id = p_id AND status = 'REGISTERED') THEN
    RAISE EXCEPTION 'Students have registered for this drive, so it can no longer be unpublished. Close it instead.' USING ERRCODE = '22023';
  END IF;
  UPDATE drives SET status = p_to, updated_by = v_u, updated_at = now(), closed_at = CASE WHEN p_to = 'CLOSED' THEN now() ELSE closed_at END, archived_at = CASE WHEN p_to = 'ARCHIVED' THEN now() ELSE archived_at END WHERE id = p_id;
  PERFORM placement.drive_event(p_id, v_c, CASE p_to WHEN 'DRAFT' THEN 'UNPUBLISHED' ELSE p_to END, v_u, v_n);
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'DRIVE_' || CASE p_to WHEN 'DRAFT' THEN 'UNPUBLISHED' ELSE p_to END, 'drive', p_id::text, '{}'::jsonb, NULL);
END $$;

-- ───────────── officers may open the résumé of a student registered for one of their drives ─────────────
CREATE OR REPLACE FUNCTION documents.storage_key_for(p_doc uuid) RETURNS TABLE (storage_key text, content_type text, original_name text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_role text := app.current_role(); d documents%ROWTYPE; v_owner boolean;
BEGIN
  SELECT * INTO d FROM documents WHERE id = p_doc AND college_id = v_c;
  IF NOT FOUND OR v_role IS NULL THEN RAISE EXCEPTION 'document not found' USING ERRCODE = '22023'; END IF;
  IF d.status <> 'ACTIVE' THEN RAISE EXCEPTION 'document not found' USING ERRCODE = '22023'; END IF;
  v_owner := EXISTS (SELECT 1 FROM students WHERE id = d.student_id AND user_id = v_user);
  IF v_role = 'STUDENT' THEN
    IF NOT v_owner THEN RAISE EXCEPTION 'document not found' USING ERRCODE = '22023'; END IF;
  ELSIF v_role = 'COORDINATOR' THEN
    IF d.kind = 'RESUME' OR NOT EXISTS (SELECT 1 FROM students st JOIN coordinator_assignments ca ON ca.department_id = st.department_id AND ca.college_id = st.college_id
                                         WHERE st.id = d.student_id AND ca.user_id = v_user AND ca.ended_at IS NULL) THEN
      RAISE EXCEPTION 'document not found' USING ERRCODE = '22023';
    END IF;
  ELSIF v_role = 'PLACEMENT_OFFICER' THEN
    IF d.kind <> 'RESUME' OR NOT EXISTS (SELECT 1 FROM registrations r WHERE r.student_id = d.student_id AND r.college_id = v_c AND r.status = 'REGISTERED') THEN
      RAISE EXCEPTION 'document not found' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT v_owner THEN PERFORM documents.event(p_doc, v_c, 'ACCESSED', NULL); END IF;
  RETURN QUERY SELECT d.storage_key, d.content_type, d.original_name;
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA placement FROM cc_auth;
REVOKE CREATE ON SCHEMA documents FROM cc_auth;
REVOKE CREATE ON SCHEMA eligibility FROM cc_auth;
REVOKE CREATE ON SCHEMA registrations FROM cc_auth;
