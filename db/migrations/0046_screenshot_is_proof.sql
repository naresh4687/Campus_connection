-- 0046: a screenshot is proof kept on file, not something staff must verify. Uploading one completes the registration straight away, and the student may replace it
-- while the drive is open. (Earlier review states stay in the data for old rows; nothing new enters them.)
CREATE OR REPLACE FUNCTION registrations.submit_evidence(p_drive uuid, p_key text, p_name text, p_type text, p_size int, p_sha256 text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_sid uuid; d drives%ROWTYPE; g registrations%ROWTYPE; v_ver int; v_id uuid; v_first boolean;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_sid FROM students WHERE user_id = v_user AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student record not found' USING ERRCODE = '22023'; END IF;
  IF p_key !~ ('^c/' || v_c::text || '/s/' || v_sid::text || '/[0-9a-f-]{36}$') THEN RAISE EXCEPTION 'invalid storage key' USING ERRCODE = '22023'; END IF;
  SELECT * INTO d FROM drives WHERE id = p_drive AND college_id = v_c;
  IF NOT FOUND OR d.registration_method <> 'EXTERNAL' THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO g FROM registrations WHERE drive_id = p_drive AND student_id = v_sid AND method = 'EXTERNAL' FOR UPDATE;
  IF NOT FOUND OR g.status = 'WITHDRAWN' THEN RAISE EXCEPTION 'Start the registration first: open the company’s form from the drive page.' USING ERRCODE = '22023'; END IF;
  -- Open drive, or a late screenshot that staff allowed.
  IF NOT (d.status = 'PUBLISHED' AND d.application_deadline > now()) AND NOT (g.evidence_status IN ('REJECTED', 'RESUBMISSION_REQUIRED') OR (g.late_ok_until IS NOT NULL AND g.late_ok_until > now())) THEN
    RAISE EXCEPTION 'The deadline for this drive has passed. Ask the placement office whether a late screenshot can be accepted.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_ver FROM registration_evidence WHERE registration_id = g.id;
  UPDATE registration_evidence SET status = 'SUPERSEDED' WHERE registration_id = g.id AND status IN ('SUBMITTED_PENDING_REVIEW', 'REJECTED', 'RESUBMISSION_REQUIRED') AND version < v_ver;
  INSERT INTO registration_evidence (college_id, registration_id, student_id, drive_id, version, storage_key, original_name, content_type, size_bytes, sha256, submitted_by)
  VALUES (v_c, g.id, v_sid, p_drive, v_ver, p_key, p_name, p_type, p_size, p_sha256, v_user) RETURNING id INTO v_id;
  v_first := (g.status = 'PENDING_EXTERNAL');
  UPDATE registrations SET status = 'REGISTERED', registered_at = CASE WHEN v_first THEN now() ELSE registered_at END, evidence_status = 'SUBMITTED_PENDING_REVIEW', evidence_updated_at = now(), late_ok_until = NULL WHERE id = g.id;
  INSERT INTO registration_events (college_id, registration_id, event) VALUES (v_c, g.id, 'EVIDENCE_SUBMITTED');
  PERFORM notifications.push_many(v_c, ARRAY[v_user], 'DRIVES', 'You are registered', 'Your screenshot for ' || d.company_name || ' is saved and your registration is complete.', '/student/drives/' || p_drive::text);
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'STUDENT', CASE WHEN v_ver > 1 THEN 'EXTERNAL_EVIDENCE_REPLACED' ELSE 'EXTERNAL_EVIDENCE_SUBMITTED' END, 'drive', p_drive::text, jsonb_build_object('version', v_ver), NULL);
  RETURN v_id;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'The file details were not accepted (type, size or name).' USING ERRCODE = '22023';
END $$;
