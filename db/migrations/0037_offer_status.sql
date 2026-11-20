-- 0037_offer_status: a placement record is an OFFER (the student got an offer) or an ACCEPTED offer. A student can have offers from many companies but ONE accepted offer
--   in total (enforced by a partial unique index, so no code path can break it). Officers can add offers for any student, mark an offer accepted (refused if another is already
--   accepted), put it back to "got offer", or withdraw it (the record is kept as rejected).

ALTER TABLE manual_placements ADD COLUMN offer_status text NOT NULL DEFAULT 'OFFERED' CHECK (offer_status IN ('OFFERED', 'ACCEPTED'));
CREATE UNIQUE INDEX manual_placements_one_accepted ON manual_placements (student_id) WHERE offer_status = 'ACCEPTED' AND status <> 'REJECTED';

DROP FUNCTION placement.record_manual_placement(uuid, uuid, numeric, date, text);
DROP FUNCTION placement.manual_placements(uuid, boolean);

CREATE FUNCTION placement.record_manual_placement(p_company uuid, p_student uuid, p_ctc numeric, p_joined date, p_note text, p_offer_status text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_role text := app.current_role(); st students%ROWTYPE; v_id uuid; v_co text; v_other text;
BEGIN
  IF v_user IS NULL OR v_c IS NULL OR v_role NOT IN ('COORDINATOR', 'PLACEMENT_OFFICER') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF p_offer_status IS NULL OR p_offer_status NOT IN ('OFFERED', 'ACCEPTED') THEN RAISE EXCEPTION 'Choose whether the student got an offer or accepted one.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO st FROM students WHERE id = p_student AND college_id = v_c;
  IF NOT FOUND OR (v_role = 'COORDINATOR' AND NOT (st.department_id = ANY (announcements.my_departments()))) THEN RAISE EXCEPTION 'You can only record students of your own departments.' USING ERRCODE = '42501'; END IF;
  SELECT name::text INTO v_co FROM companies WHERE id = p_company AND college_id = v_c AND status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose one of the college''s companies.' USING ERRCODE = '22023'; END IF;
  IF p_ctc IS NULL OR p_ctc <= 0 OR p_ctc > 1000 THEN RAISE EXCEPTION 'Enter the package in LPA (for example 6.5).' USING ERRCODE = '22023'; END IF;
  IF p_joined IS NOT NULL AND p_joined > current_date + 366 THEN RAISE EXCEPTION 'The joining date is too far ahead.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM manual_placements WHERE student_id = p_student AND company_id = p_company AND status <> 'REJECTED') THEN RAISE EXCEPTION 'This student already has a record for this company.' USING ERRCODE = '23505'; END IF;
  IF p_offer_status = 'ACCEPTED' THEN
    SELECT c.name::text INTO v_other FROM manual_placements m JOIN companies c ON c.id = m.company_id WHERE m.student_id = p_student AND m.offer_status = 'ACCEPTED' AND m.status <> 'REJECTED';
    IF FOUND THEN RAISE EXCEPTION 'This student has already accepted an offer (%). A student can accept only one.', v_other USING ERRCODE = '23505'; END IF;
  END IF;
  INSERT INTO manual_placements (college_id, company_id, student_id, department_id, ctc_lpa, joined_on, note, status, offer_status, recorded_by, recorded_role, reviewed_by, reviewed_at)
  VALUES (v_c, p_company, p_student, st.department_id, p_ctc, p_joined, nullif(btrim(coalesce(p_note, '')), ''), CASE WHEN v_role = 'PLACEMENT_OFFICER' THEN 'VERIFIED' ELSE 'PENDING_VERIFICATION' END, p_offer_status, v_user, v_role,
          CASE WHEN v_role = 'PLACEMENT_OFFICER' THEN v_user END, CASE WHEN v_role = 'PLACEMENT_OFFICER' THEN now() END) RETURNING id INTO v_id;
  IF v_role = 'COORDINATOR' THEN
    PERFORM notifications.push_many(v_c, notifications.officers(v_c), 'PLACEMENT', 'Placement recorded by a coordinator', st.full_name || ' ' || CASE WHEN p_offer_status = 'ACCEPTED' THEN 'accepted an offer at ' ELSE 'got an offer from ' END || v_co || ' (' || p_ctc || ' LPA). Please verify it.', '/placement/placements');
  ELSIF st.user_id IS NOT NULL THEN
    PERFORM notifications.push_many(v_c, ARRAY[st.user_id], 'PLACEMENT', CASE WHEN p_offer_status = 'ACCEPTED' THEN 'Accepted offer recorded' ELSE 'Offer recorded' END, v_co || ' (' || p_ctc || ' LPA) was recorded for you by the placement office.', '/student');
  END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, v_role, 'MANUAL_PLACEMENT_RECORDED', 'student', p_student::text, jsonb_build_object('company', p_company, 'ctc_lpa', p_ctc, 'offer', p_offer_status), NULL);
  RETURN v_id;
END $$;

CREATE FUNCTION placement.manual_placements(p_company uuid, p_only_pending boolean) RETURNS TABLE (
  id uuid, company_id uuid, company_name text, student_id uuid, full_name text, register_number text, department_code text, ctc_lpa numeric, joined_on date, note text, status text, recorded_role text, recorded_at timestamptz, review_note text, offer_status text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_role text := app.current_role();
BEGIN
  IF v_c IS NULL OR v_role NOT IN ('COORDINATOR', 'PLACEMENT_OFFICER', 'COLLEGE_ADMIN') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT m.id, m.company_id, co.name::text, st.id, st.full_name::text, st.register_number::text, dp.code::text, m.ctc_lpa, m.joined_on, m.note::text, m.status::text, m.recorded_role::text, m.recorded_at, m.review_note::text, m.offer_status::text
    FROM manual_placements m JOIN companies co ON co.id = m.company_id JOIN students st ON st.id = m.student_id JOIN departments dp ON dp.id = m.department_id
   WHERE m.college_id = v_c AND (p_company IS NULL OR m.company_id = p_company) AND (NOT p_only_pending OR m.status = 'PENDING_VERIFICATION')
     AND (v_role <> 'COORDINATOR' OR m.department_id = ANY (announcements.my_departments()))
   ORDER BY m.recorded_at DESC LIMIT 500;
END $$;

CREATE FUNCTION placement.set_offer_status(p_id uuid, p_offer_status text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); m manual_placements%ROWTYPE; v_other text; v_suser uuid; v_co text;
BEGIN
  IF v_user IS NULL OR app.current_role() IS DISTINCT FROM 'PLACEMENT_OFFICER' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF p_offer_status NOT IN ('OFFERED', 'ACCEPTED') THEN RAISE EXCEPTION 'Choose offered or accepted.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO m FROM manual_placements WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF NOT FOUND OR m.status = 'REJECTED' THEN RAISE EXCEPTION 'Record not found.' USING ERRCODE = '22023'; END IF;
  IF p_offer_status = 'ACCEPTED' THEN
    SELECT c.name::text INTO v_other FROM manual_placements x JOIN companies c ON c.id = x.company_id WHERE x.student_id = m.student_id AND x.offer_status = 'ACCEPTED' AND x.status <> 'REJECTED' AND x.id <> p_id;
    IF FOUND THEN RAISE EXCEPTION 'This student has already accepted an offer (%). A student can accept only one.', v_other USING ERRCODE = '23505'; END IF;
  END IF;
  UPDATE manual_placements SET offer_status = p_offer_status, status = CASE WHEN status = 'PENDING_VERIFICATION' THEN 'VERIFIED' ELSE status END, reviewed_by = coalesce(reviewed_by, v_user), reviewed_at = coalesce(reviewed_at, now()) WHERE id = p_id;
  SELECT user_id INTO v_suser FROM students WHERE id = m.student_id; SELECT name::text INTO v_co FROM companies WHERE id = m.company_id;
  IF v_suser IS NOT NULL AND p_offer_status <> m.offer_status THEN PERFORM notifications.push_many(v_c, ARRAY[v_suser], 'PLACEMENT', CASE WHEN p_offer_status = 'ACCEPTED' THEN 'Accepted offer recorded' ELSE 'Offer updated' END, v_co || CASE WHEN p_offer_status = 'ACCEPTED' THEN ': your acceptance was recorded.' ELSE ': marked as an offer (not accepted).' END, '/student'); END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'PLACEMENT_OFFICER', 'MANUAL_OFFER_STATUS_SET', 'student', m.student_id::text, jsonb_build_object('offer', p_offer_status), NULL);
END $$;

CREATE FUNCTION placement.withdraw_manual_offer(p_id uuid, p_note text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); m manual_placements%ROWTYPE;
BEGIN
  IF v_user IS NULL OR app.current_role() IS DISTINCT FROM 'PLACEMENT_OFFICER' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO m FROM manual_placements WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF NOT FOUND OR m.status = 'REJECTED' THEN RAISE EXCEPTION 'Record not found.' USING ERRCODE = '22023'; END IF;
  UPDATE manual_placements SET status = 'REJECTED', reviewed_by = v_user, reviewed_at = now(), review_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Withdrawn by the placement office') WHERE id = p_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'PLACEMENT_OFFICER', 'MANUAL_OFFER_WITHDRAWN', 'student', m.student_id::text, '{}'::jsonb, NULL);
END $$;

GRANT CREATE ON SCHEMA placement TO cc_auth;
ALTER FUNCTION placement.record_manual_placement(uuid, uuid, numeric, date, text, text) OWNER TO cc_auth;
ALTER FUNCTION placement.manual_placements(uuid, boolean) OWNER TO cc_auth;
ALTER FUNCTION placement.set_offer_status(uuid, text) OWNER TO cc_auth;
ALTER FUNCTION placement.withdraw_manual_offer(uuid, text) OWNER TO cc_auth;
REVOKE CREATE ON SCHEMA placement FROM cc_auth;
REVOKE ALL ON FUNCTION placement.record_manual_placement(uuid, uuid, numeric, date, text, text), placement.manual_placements(uuid, boolean), placement.set_offer_status(uuid, text), placement.withdraw_manual_offer(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION placement.record_manual_placement(uuid, uuid, numeric, date, text, text), placement.manual_placements(uuid, boolean), placement.set_offer_status(uuid, text), placement.withdraw_manual_offer(uuid, text) TO cc_app;
