-- 0032_participation: who has and has not registered for a drive, by department, with reminders and an audited download.
--   participation(): one row per student in the drive's departments, with the ENGINE's eligibility result and the registration status. Officers and the
--   administrator see every department; a coordinator only the departments they are currently assigned to.
--   remind_students(): notifies students who are eligible and have not registered (or have not uploaded their external screenshot). Officers: any department;
--   coordinators: their own. At most one reminder per drive and scope in six hours.
--   remind_coordinators(): an officer tells each department's coordinators how many eligible students of theirs have not registered.
--   Nothing here changes a registration or decides eligibility.

CREATE FUNCTION registrations.participation(p_drive uuid, p_dept uuid) RETURNS TABLE (
  student_id uuid, full_name text, register_number text, department_id uuid, department_code text, college_email text, phone text, has_account boolean,
  eligibility text, registration_status text, evidence_status text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_role text := app.current_role();
BEGIN
  IF v_c IS NULL OR coalesce(v_role, '') NOT IN ('PLACEMENT_OFFICER', 'COORDINATOR', 'COLLEGE_ADMIN') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM drives d WHERE d.id = p_drive AND d.college_id = v_c AND d.status IN ('PUBLISHED', 'CLOSED')
                   AND (v_role <> 'COORDINATOR' OR EXISTS (SELECT 1 FROM drive_departments dd WHERE dd.drive_id = d.id AND dd.department_id = ANY (announcements.my_departments())))) THEN
    RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT st.id, st.full_name::text, st.register_number::text, st.department_id, dp.code::text, st.college_email::text, st.phone::text, (st.user_id IS NOT NULL),
         (eligibility.evaluate(st.id, p_drive)->>'result')::text, g.status::text, g.evidence_status::text
    FROM students st JOIN departments dp ON dp.id = st.department_id
    LEFT JOIN registrations g ON g.drive_id = p_drive AND g.student_id = st.id
   WHERE st.college_id = v_c AND st.department_id IN (SELECT dd.department_id FROM drive_departments dd WHERE dd.drive_id = p_drive)
     AND (p_dept IS NULL OR st.department_id = p_dept)
     AND (v_role <> 'COORDINATOR' OR st.department_id = ANY (announcements.my_departments()))
   ORDER BY dp.code, st.full_name;
END $$;

-- The audited download: the application calls this before it streams a file, so every export of student details is on record.
CREATE FUNCTION registrations.log_participation_export(p_drive uuid, p_view text, p_rows int) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_user uuid := app.current_user_id(); v_role text := app.current_role();
BEGIN
  IF v_c IS NULL OR coalesce(v_role, '') NOT IN ('PLACEMENT_OFFICER', 'COORDINATOR', 'COLLEGE_ADMIN') OR v_user IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM drives WHERE id = p_drive AND college_id = v_c) THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, v_role, 'DRIVE_PARTICIPATION_EXPORTED', 'drive', p_drive::text, jsonb_build_object('view', left(coalesce(p_view, ''), 30), 'rows', p_rows), NULL);
END $$;

CREATE FUNCTION registrations.remind_students(p_drive uuid, p_dept uuid) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_user uuid := app.current_user_id(); v_role text := app.current_role(); d drives%ROWTYPE;
  v_scope text := coalesce(p_dept::text, 'ALL'); v_new uuid[]; v_pend uuid[]; v_n int;
BEGIN
  IF v_c IS NULL OR coalesce(v_role, '') NOT IN ('PLACEMENT_OFFICER', 'COORDINATOR') OR v_user IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO d FROM drives WHERE id = p_drive AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  IF d.status <> 'PUBLISHED' OR d.application_deadline <= now() THEN RAISE EXCEPTION 'Registration for this drive is closed, so a reminder would not help.' USING ERRCODE = '22023'; END IF;
  IF v_role = 'COORDINATOR' AND p_dept IS NOT NULL AND NOT (p_dept = ANY (announcements.my_departments())) THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF v_role = 'COORDINATOR' AND cardinality(announcements.my_departments()) = 0 THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM audit_log a WHERE a.college_id = v_c AND a.action = 'DRIVE_REMINDER_SENT' AND a.entity_id = p_drive::text AND a.occurred_at > now() - interval '6 hours'
               AND (a.metadata->>'scope' = v_scope OR a.metadata->>'scope' = 'ALL' OR v_scope = 'ALL')) THEN
    RAISE EXCEPTION 'A reminder for this drive was already sent in the last 6 hours. Please wait before sending another.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(x.user_id) FILTER (WHERE x.reg IS NULL OR x.reg = 'WITHDRAWN'), '{}'), coalesce(array_agg(x.user_id) FILTER (WHERE x.reg = 'PENDING_EXTERNAL'), '{}') INTO v_new, v_pend
    FROM (SELECT st.user_id, p.registration_status AS reg
            FROM registrations.participation(p_drive, p_dept) p JOIN students st ON st.id = p.student_id
           WHERE p.eligibility = 'ELIGIBLE' AND p.has_account AND (p.registration_status IS NULL OR p.registration_status IN ('WITHDRAWN', 'PENDING_EXTERNAL'))) x;
  PERFORM notifications.push_many(v_c, v_new, 'DRIVES', 'Registration open: ' || d.job_title, d.company_name || '. You are eligible and have not registered yet. The deadline is ' || to_char(d.application_deadline AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM') || ' IST.', '/student/drives/' || p_drive::text);
  PERFORM notifications.push_many(v_c, v_pend, 'DRIVES', 'Finish your registration: ' || d.company_name, 'You started registering through the company’s website but have not uploaded the confirmation screenshot yet.', '/student/drives/' || p_drive::text);
  v_n := cardinality(v_new) + cardinality(v_pend);
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, v_role, 'DRIVE_REMINDER_SENT', 'drive', p_drive::text, jsonb_build_object('scope', v_scope, 'students', v_n), NULL);
  RETURN v_n;
END $$;

CREATE FUNCTION registrations.remind_coordinators(p_drive uuid) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_user uuid := app.current_user_id(); d drives%ROWTYPE; r record; v_users uuid[]; v_total int := 0;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'PLACEMENT_OFFICER' OR v_user IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO d FROM drives WHERE id = p_drive AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  IF d.status <> 'PUBLISHED' OR d.application_deadline <= now() THEN RAISE EXCEPTION 'Registration for this drive is closed, so a reminder would not help.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM audit_log a WHERE a.college_id = v_c AND a.action = 'DRIVE_COORDINATORS_NOTIFIED' AND a.entity_id = p_drive::text AND a.occurred_at > now() - interval '6 hours') THEN
    RAISE EXCEPTION 'Coordinators were already notified about this drive in the last 6 hours.' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT p.department_id, p.department_code, count(*)::int AS n FROM registrations.participation(p_drive, NULL) p
            WHERE p.eligibility = 'ELIGIBLE' AND (p.registration_status IS NULL OR p.registration_status IN ('WITHDRAWN', 'PENDING_EXTERNAL')) GROUP BY p.department_id, p.department_code LOOP
    v_users := notifications.coordinators_of(v_c, r.department_id);
    PERFORM notifications.push_many(v_c, v_users, 'DRIVES', r.n || ' eligible student' || CASE WHEN r.n = 1 THEN '' ELSE 's' END || ' of ' || r.department_code || ' have not registered',
      d.company_name || ' — ' || d.job_title || '. Open the list to follow up or download it.', '/coordinator/drives/' || p_drive::text);
    v_total := v_total + cardinality(v_users);
  END LOOP;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'PLACEMENT_OFFICER', 'DRIVE_COORDINATORS_NOTIFIED', 'drive', p_drive::text, jsonb_build_object('coordinators', v_total), NULL);
  RETURN v_total;
END $$;

GRANT CREATE ON SCHEMA registrations TO cc_auth;
ALTER FUNCTION registrations.participation(uuid, uuid) OWNER TO cc_auth;
ALTER FUNCTION registrations.log_participation_export(uuid, text, int) OWNER TO cc_auth;
ALTER FUNCTION registrations.remind_students(uuid, uuid) OWNER TO cc_auth;
ALTER FUNCTION registrations.remind_coordinators(uuid) OWNER TO cc_auth;
REVOKE CREATE ON SCHEMA registrations FROM cc_auth;
REVOKE ALL ON FUNCTION registrations.participation(uuid, uuid), registrations.log_participation_export(uuid, text, int), registrations.remind_students(uuid, uuid), registrations.remind_coordinators(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrations.participation(uuid, uuid), registrations.log_participation_export(uuid, text, int), registrations.remind_students(uuid, uuid), registrations.remind_coordinators(uuid) TO cc_app;
