-- 0027_student_drive_history: the "drive history and placement status" part of the student 360 view.
-- Coordinators have no row access to selections, offers or placements (0012), and that stays. This function returns a NARROW, read-only
-- summary for one student - drive, registration, whether selected, offer status, verified placement - and only to the college's
-- administrator or to a coordinator currently assigned to the student's department. The offered package (LPA) is returned to the
-- administrator only; a coordinator gets null. Nothing is written and eligibility never reads it.

GRANT CREATE ON SCHEMA students TO cc_auth;      -- temporary; revoked at the end

SET LOCAL ROLE cc_auth;
CREATE FUNCTION students.drive_history(p_student uuid)
  RETURNS TABLE (drive_id uuid, company_name text, job_title text, registration_status text, registered_at timestamptz, selected boolean,
                 offer_status text, offered_ctc_lpa numeric, placement_status text, joined_on date)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_role text := app.current_role(); v_s students%ROWTYPE;
BEGIN
  IF v_u IS NULL OR v_c IS NULL OR v_role IS NULL THEN RETURN; END IF;
  SELECT * INTO v_s FROM students WHERE id = p_student AND college_id = v_c;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT (v_role = 'COLLEGE_ADMIN'
          OR (v_role = 'COORDINATOR' AND EXISTS (SELECT 1 FROM coordinator_assignments ca WHERE ca.user_id = v_u AND ca.college_id = v_c AND ca.department_id = v_s.department_id AND ca.ended_at IS NULL))) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT d.id, d.company_name::text, d.job_title::text, r.status::text, r.registered_at, (s.id IS NOT NULL),
           s.offer_status::text, CASE WHEN v_role = 'COLLEGE_ADMIN' THEN s.offered_ctc_lpa END, pl.status::text, pl.joined_on
      FROM registrations r
      JOIN drives d ON d.id = r.drive_id AND d.college_id = r.college_id
      LEFT JOIN selections s ON s.registration_id = r.id AND s.college_id = r.college_id
      LEFT JOIN placements pl ON pl.selection_id = s.id AND pl.college_id = r.college_id
     WHERE r.student_id = p_student AND r.college_id = v_c
     ORDER BY r.registered_at DESC, d.id;
END $$;
RESET ROLE;
REVOKE ALL ON FUNCTION students.drive_history(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION students.drive_history(uuid) TO cc_app;

REVOKE CREATE ON SCHEMA students FROM cc_auth;
