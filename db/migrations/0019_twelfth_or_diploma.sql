-- 0019_twelfth_or_diploma: the 12th and diploma minimums become ONE check ("12th or diploma").
-- Before, a drive with both minimums asked every student for both percentages, so a student who did 12th (and no diploma)
-- was always "needs verified data". Now the student passes when the route they took meets its minimum; a drive that sets
-- only one minimum applies it to either route. A missing value still never counts as zero. Engine version 2 (snapshots
-- taken before this keep engine version 1).

GRANT CREATE ON SCHEMA eligibility TO cc_auth;   -- temporary (replacement); revoked at the end
SET LOCAL ROLE cc_auth;

CREATE OR REPLACE FUNCTION eligibility.evaluate(p_student uuid, p_drive uuid) RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  s students%ROWTYPE; c drive_criteria%ROWTYPE; v academic_submissions%ROWTYPE; ch jsonb := '[]'::jsonb; fails int := 0; missing int := 0; v_found boolean; v_open text; v_has_rejected boolean;
  v_dept_name text; v_req text; v_act text;
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
  -- 12th OR diploma: students reach engineering by one route or the other, so this is ONE check. A student passes when the route
  -- they have meets its minimum; a drive that sets only one minimum applies it to either route. A blank route is simply not taken.
  IF c.min_twelfth IS NOT NULL OR c.min_diploma IS NOT NULL THEN
    v_req := concat_ws(' or ', '12th >= ' || coalesce(c.min_twelfth, c.min_diploma) || '%', 'diploma >= ' || coalesce(c.min_diploma, c.min_twelfth) || '%');
    IF NOT v_found THEN missing := missing + 1; ch := eligibility.add_check(ch, 'TWELFTH_OR_DIPLOMA', v_req, NULL, 'MISSING', 'Needs a verified record.');
    ELSE
      v_act := concat_ws(', ', '12th ' || v.twelfth_percentage::text || '%', 'diploma ' || v.diploma_percentage::text || '%');
      IF (v.twelfth_percentage IS NOT NULL AND v.twelfth_percentage >= coalesce(c.min_twelfth, c.min_diploma))
         OR (v.diploma_percentage IS NOT NULL AND v.diploma_percentage >= coalesce(c.min_diploma, c.min_twelfth)) THEN
        ch := eligibility.add_check(ch, 'TWELFTH_OR_DIPLOMA', v_req, v_act, 'PASS', NULL);
      ELSIF v.twelfth_percentage IS NULL AND v.diploma_percentage IS NULL THEN   -- cannot happen (a record needs one); kept explicit
        missing := missing + 1; ch := eligibility.add_check(ch, 'TWELFTH_OR_DIPLOMA', v_req, NULL, 'MISSING', 'Your record has neither a 12th nor a diploma percentage.');
      ELSE
        fails := fails + 1; ch := eligibility.add_check(ch, 'TWELFTH_OR_DIPLOMA', v_req, v_act, 'FAIL', 'Your 12th or diploma percentage is below the minimum.');
      END IF;
    END IF;
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
                            'engine_version', '2', 'submission_id', CASE WHEN v_found THEN v.id END, 'checks', ch);
END $$;

RESET ROLE;
REVOKE CREATE ON SCHEMA eligibility FROM cc_auth;
