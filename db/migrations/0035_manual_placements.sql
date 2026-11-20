-- 0035_manual_placements: a department coordinator can record that one of THEIR students is placed in a company, with the package (LPA).
--   This is separate from the rounds -> offers -> joining flow (it is for placements that happened outside CampusConnect). A coordinator's record starts
--   PENDING_VERIFICATION and a placement officer verifies or rejects it; an officer's own record is verified at once. Only students of the coordinator's
--   current departments, and only companies of the same college. Written and read through these functions only (no direct table access).

CREATE TABLE manual_placements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id    uuid NOT NULL,
  company_id    uuid NOT NULL,
  student_id    uuid NOT NULL,
  department_id uuid NOT NULL,
  ctc_lpa       numeric(6,2) NOT NULL CHECK (ctc_lpa > 0 AND ctc_lpa <= 1000),
  joined_on     date,
  note          text CHECK (note IS NULL OR length(note) <= 300),
  status        text NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (status IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED')),
  recorded_by   uuid NOT NULL REFERENCES users (id),
  recorded_role text NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_by   uuid REFERENCES users (id),
  reviewed_at   timestamptz,
  review_note   text CHECK (review_note IS NULL OR length(review_note) <= 300),
  FOREIGN KEY (college_id, company_id) REFERENCES companies (college_id, id),
  FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id)
);
CREATE UNIQUE INDEX manual_placements_one_active ON manual_placements (student_id, company_id) WHERE status <> 'REJECTED';
GRANT SELECT, INSERT, UPDATE ON manual_placements TO cc_auth;
ALTER TABLE manual_placements ENABLE ROW LEVEL SECURITY; ALTER TABLE manual_placements FORCE ROW LEVEL SECURITY;

CREATE FUNCTION placement.company_choices() RETURNS TABLE (id uuid, name text, industry text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT c.id, c.name::text, c.industry::text FROM companies c WHERE c.college_id = app.current_college_id() AND app.current_role() IN ('PLACEMENT_OFFICER', 'COORDINATOR', 'COLLEGE_ADMIN') AND c.status = 'ACTIVE' ORDER BY c.name
$$;

CREATE FUNCTION placement.record_manual_placement(p_company uuid, p_student uuid, p_ctc numeric, p_joined date, p_note text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_role text := app.current_role(); st students%ROWTYPE; v_id uuid; v_co text;
BEGIN
  IF v_user IS NULL OR v_c IS NULL OR v_role NOT IN ('COORDINATOR', 'PLACEMENT_OFFICER') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO st FROM students WHERE id = p_student AND college_id = v_c;
  IF NOT FOUND OR (v_role = 'COORDINATOR' AND NOT (st.department_id = ANY (announcements.my_departments()))) THEN RAISE EXCEPTION 'You can only record students of your own departments.' USING ERRCODE = '42501'; END IF;
  SELECT name::text INTO v_co FROM companies WHERE id = p_company AND college_id = v_c AND status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose one of the college''s companies.' USING ERRCODE = '22023'; END IF;
  IF p_ctc IS NULL OR p_ctc <= 0 OR p_ctc > 1000 THEN RAISE EXCEPTION 'Enter the package in LPA (for example 6.5).' USING ERRCODE = '22023'; END IF;
  IF p_joined IS NOT NULL AND p_joined > current_date + 366 THEN RAISE EXCEPTION 'The joining date is too far ahead.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM manual_placements WHERE student_id = p_student AND company_id = p_company AND status <> 'REJECTED') THEN RAISE EXCEPTION 'This student is already recorded as placed in this company.' USING ERRCODE = '23505'; END IF;
  INSERT INTO manual_placements (college_id, company_id, student_id, department_id, ctc_lpa, joined_on, note, status, recorded_by, recorded_role, reviewed_by, reviewed_at)
  VALUES (v_c, p_company, p_student, st.department_id, p_ctc, p_joined, nullif(btrim(coalesce(p_note, '')), ''), CASE WHEN v_role = 'PLACEMENT_OFFICER' THEN 'VERIFIED' ELSE 'PENDING_VERIFICATION' END, v_user, v_role,
          CASE WHEN v_role = 'PLACEMENT_OFFICER' THEN v_user END, CASE WHEN v_role = 'PLACEMENT_OFFICER' THEN now() END) RETURNING id INTO v_id;
  IF v_role = 'COORDINATOR' THEN
    PERFORM notifications.push_many(v_c, notifications.officers(v_c), 'PLACEMENT', 'Placement recorded by a coordinator', st.full_name || ' placed at ' || v_co || ' (' || p_ctc || ' LPA). Please verify it.', '/placement/placements#coordinator-placements');
  END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, v_role, 'MANUAL_PLACEMENT_RECORDED', 'student', p_student::text, jsonb_build_object('company', p_company, 'ctc_lpa', p_ctc), NULL);
  RETURN v_id;
END $$;

CREATE FUNCTION placement.manual_placements(p_company uuid, p_only_pending boolean) RETURNS TABLE (
  id uuid, company_id uuid, company_name text, student_id uuid, full_name text, register_number text, department_code text, ctc_lpa numeric, joined_on date, note text, status text, recorded_role text, recorded_at timestamptz, review_note text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_role text := app.current_role();
BEGIN
  IF v_c IS NULL OR v_role NOT IN ('COORDINATOR', 'PLACEMENT_OFFICER', 'COLLEGE_ADMIN') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT m.id, m.company_id, co.name::text, st.id, st.full_name::text, st.register_number::text, dp.code::text, m.ctc_lpa, m.joined_on, m.note::text, m.status::text, m.recorded_role::text, m.recorded_at, m.review_note::text
    FROM manual_placements m JOIN companies co ON co.id = m.company_id JOIN students st ON st.id = m.student_id JOIN departments dp ON dp.id = m.department_id
   WHERE m.college_id = v_c AND (p_company IS NULL OR m.company_id = p_company) AND (NOT p_only_pending OR m.status = 'PENDING_VERIFICATION')
     AND (v_role <> 'COORDINATOR' OR m.department_id = ANY (announcements.my_departments()))
   ORDER BY m.recorded_at DESC LIMIT 300;
END $$;

CREATE FUNCTION placement.review_manual_placement(p_id uuid, p_verify boolean, p_note text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); m manual_placements%ROWTYPE; v_suser uuid; v_co text; v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF v_user IS NULL OR app.current_role() IS DISTINCT FROM 'PLACEMENT_OFFICER' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO m FROM manual_placements WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Record not found.' USING ERRCODE = '22023'; END IF;
  IF m.status <> 'PENDING_VERIFICATION' THEN RAISE EXCEPTION 'This record was already reviewed.' USING ERRCODE = '22023'; END IF;
  IF NOT p_verify AND (v_note IS NULL OR length(v_note) < 5) THEN RAISE EXCEPTION 'Give a reason for rejecting (at least 5 characters).' USING ERRCODE = '22023'; END IF;
  UPDATE manual_placements SET status = CASE WHEN p_verify THEN 'VERIFIED' ELSE 'REJECTED' END, reviewed_by = v_user, reviewed_at = now(), review_note = v_note WHERE id = p_id;
  SELECT user_id INTO v_suser FROM students WHERE id = m.student_id; SELECT name::text INTO v_co FROM companies WHERE id = m.company_id;
  IF p_verify AND v_suser IS NOT NULL THEN PERFORM notifications.push_many(v_c, ARRAY[v_suser], 'PLACEMENT', 'Placement recorded', 'Your placement at ' || v_co || ' (' || m.ctc_lpa || ' LPA) was verified.', '/student'); END IF;
  PERFORM notifications.push_many(v_c, ARRAY[m.recorded_by], 'PLACEMENT', CASE WHEN p_verify THEN 'Placement verified' ELSE 'Placement not accepted' END, v_co || CASE WHEN p_verify THEN ': verified by the placement office.' ELSE ': ' || v_note END, '/coordinator/companies/' || m.company_id::text);
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'PLACEMENT_OFFICER', CASE WHEN p_verify THEN 'MANUAL_PLACEMENT_VERIFIED' ELSE 'MANUAL_PLACEMENT_REJECTED' END, 'student', m.student_id::text, '{}'::jsonb, NULL);
END $$;

GRANT CREATE ON SCHEMA placement TO cc_auth;
ALTER FUNCTION placement.company_choices() OWNER TO cc_auth;
ALTER FUNCTION placement.record_manual_placement(uuid, uuid, numeric, date, text) OWNER TO cc_auth;
ALTER FUNCTION placement.manual_placements(uuid, boolean) OWNER TO cc_auth;
ALTER FUNCTION placement.review_manual_placement(uuid, boolean, text) OWNER TO cc_auth;
REVOKE CREATE ON SCHEMA placement FROM cc_auth;
REVOKE ALL ON FUNCTION placement.company_choices(), placement.record_manual_placement(uuid, uuid, numeric, date, text), placement.manual_placements(uuid, boolean), placement.review_manual_placement(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION placement.company_choices(), placement.record_manual_placement(uuid, uuid, numeric, date, text), placement.manual_placements(uuid, boolean), placement.review_manual_placement(uuid, boolean, text) TO cc_app;
