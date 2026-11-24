-- 0043: filterable reports. One function per fact table; the page and the CSV downloads aggregate them, so every number on a page can be traced to rows.
-- Filters (all optional, NULL = no filter): passing year, department, degree, company, and a date range. "Placed" = a VERIFIED placement of an ACCEPTED offer
-- (as before) or a VERIFIED manually recorded placement whose offer was accepted. Placement date = the joining date (else when the offer was accepted / recorded).

CREATE FUNCTION reports.student_pool(p_year int, p_dept uuid, p_degree text) RETURNS TABLE (
  student_id uuid, full_name text, register_number text, department_id uuid, department_code text, degree text, passing_year int, college_email text, phone text, cgpa numeric,
  github_url text, leetcode_url text, linkedin_url text, registered int, selected int, offers_accepted int, placed boolean, campus_attended int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid;
BEGIN
  SELECT o_college INTO v_c FROM reports.scope();
  RETURN QUERY
  SELECT st.id, st.full_name::text, st.register_number::text, st.department_id, dp.code::text, st.degree, st.passing_year, st.college_email::text, st.phone,
         (SELECT a.cgpa FROM academic_submissions a WHERE a.student_id = st.id AND a.status = 'VERIFIED' ORDER BY a.version DESC LIMIT 1),
         st.github_url, st.leetcode_url, st.linkedin_url,
         (SELECT count(*)::int FROM registrations r WHERE r.student_id = st.id AND r.status = 'REGISTERED'),
         (SELECT count(*)::int FROM selections s WHERE s.student_id = st.id AND s.offer_status <> 'WITHDRAWN'),
         (SELECT count(*)::int FROM selections s WHERE s.student_id = st.id AND s.offer_status = 'ACCEPTED'),
         (reports.is_placed(st.id) OR EXISTS (SELECT 1 FROM manual_placements m WHERE m.student_id = st.id AND m.status = 'VERIFIED' AND m.offer_status = 'ACCEPTED')),
         (SELECT count(*)::int FROM campus_attendance ca WHERE ca.student_id = st.id)
    FROM students st JOIN departments dp ON dp.id = st.department_id
   WHERE st.college_id = v_c AND (p_year IS NULL OR st.passing_year = p_year) AND (p_dept IS NULL OR st.department_id = p_dept) AND (p_degree IS NULL OR st.degree = p_degree)
   ORDER BY dp.code, st.full_name LIMIT 20000;
END $$;

CREATE FUNCTION reports.placement_rows(p_year int, p_dept uuid, p_degree text, p_company uuid, p_drive uuid, p_from date, p_to date) RETURNS TABLE (
  student_id uuid, full_name text, register_number text, department_code text, degree text, passing_year int, college_email text, phone text, cgpa numeric,
  company_id uuid, company_name text, job_title text, drive_id uuid, ctc_lpa numeric, placed_on date, source text, github_url text, leetcode_url text, linkedin_url text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid;
BEGIN
  SELECT o_college INTO v_c FROM reports.scope();
  RETURN QUERY
  WITH rows AS (
    SELECT st.id AS sid, d.company_id AS cid, d.company_name::text AS cname, d.job_title::text AS jt, d.id AS did, s.offered_ctc_lpa AS ctc, p.joined_on AS on_date, 'PLATFORM'::text AS src
      FROM placements p JOIN selections s ON s.id = p.selection_id JOIN drives d ON d.id = p.drive_id JOIN students st ON st.id = p.student_id
     WHERE p.college_id = v_c AND p.status = 'VERIFIED' AND s.offer_status = 'ACCEPTED'
    UNION ALL
    SELECT st.id, m.company_id, c.name::text, NULL::text, NULL::uuid, m.ctc_lpa, coalesce(m.joined_on, (m.recorded_at AT TIME ZONE 'Asia/Kolkata')::date), 'MANUAL'
      FROM manual_placements m JOIN companies c ON c.id = m.company_id JOIN students st ON st.id = m.student_id
     WHERE m.college_id = v_c AND m.status = 'VERIFIED' AND m.offer_status = 'ACCEPTED')
  SELECT st.id, st.full_name::text, st.register_number::text, dp.code::text, st.degree, st.passing_year, st.college_email::text, st.phone,
         (SELECT a.cgpa FROM academic_submissions a WHERE a.student_id = st.id AND a.status = 'VERIFIED' ORDER BY a.version DESC LIMIT 1),
         r.cid, r.cname, r.jt, r.did, r.ctc, r.on_date, r.src, st.github_url, st.leetcode_url, st.linkedin_url
    FROM rows r JOIN students st ON st.id = r.sid JOIN departments dp ON dp.id = st.department_id
   WHERE (p_year IS NULL OR st.passing_year = p_year) AND (p_dept IS NULL OR st.department_id = p_dept) AND (p_degree IS NULL OR st.degree = p_degree)
     AND (p_company IS NULL OR r.cid = p_company) AND (p_drive IS NULL OR r.did = p_drive)
     AND (p_from IS NULL OR r.on_date >= p_from) AND (p_to IS NULL OR r.on_date <= p_to)
   ORDER BY r.on_date DESC, st.full_name LIMIT 20000;
END $$;

-- Per drive, counting only students who match the filters.
CREATE FUNCTION reports.funnel_rows(p_year int, p_dept uuid, p_degree text, p_company uuid, p_from date, p_to date) RETURNS TABLE (
  drive_id uuid, job_title text, company_id uuid, company_name text, status text, published_on date, registered int, selected int, offers_issued int, accepted int, placed int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid;
BEGIN
  SELECT o_college INTO v_c FROM reports.scope();
  RETURN QUERY
  WITH me AS (SELECT st.id FROM students st WHERE st.college_id = v_c AND (p_year IS NULL OR st.passing_year = p_year) AND (p_dept IS NULL OR st.department_id = p_dept) AND (p_degree IS NULL OR st.degree = p_degree))
  SELECT d.id, d.job_title::text, d.company_id, d.company_name::text, d.status, (d.published_at AT TIME ZONE 'Asia/Kolkata')::date,
         (SELECT count(*)::int FROM registrations r WHERE r.drive_id = d.id AND r.status = 'REGISTERED' AND r.student_id IN (SELECT id FROM me)),
         (SELECT count(*)::int FROM selections s WHERE s.drive_id = d.id AND s.offer_status <> 'WITHDRAWN' AND s.student_id IN (SELECT id FROM me)),
         (SELECT count(*)::int FROM selections s WHERE s.drive_id = d.id AND s.issued_at IS NOT NULL AND s.student_id IN (SELECT id FROM me)),
         (SELECT count(*)::int FROM selections s WHERE s.drive_id = d.id AND s.offer_status = 'ACCEPTED' AND s.student_id IN (SELECT id FROM me)),
         (SELECT count(*)::int FROM placements p JOIN selections s ON s.id = p.selection_id WHERE p.drive_id = d.id AND p.status = 'VERIFIED' AND s.offer_status = 'ACCEPTED' AND p.student_id IN (SELECT id FROM me))
    FROM drives d
   WHERE d.college_id = v_c AND d.status IN ('PUBLISHED', 'CLOSED', 'ARCHIVED') AND d.published_at IS NOT NULL AND (p_company IS NULL OR d.company_id = p_company)
     AND (p_from IS NULL OR (d.published_at AT TIME ZONE 'Asia/Kolkata')::date >= p_from) AND (p_to IS NULL OR (d.published_at AT TIME ZONE 'Asia/Kolkata')::date <= p_to)
   ORDER BY d.published_at DESC, d.id;
END $$;

-- On-campus drives held in the period, one row per round.
CREATE FUNCTION reports.campus_rounds(p_from date, p_to date) RETURNS TABLE (
  event_id uuid, company_name text, title text, event_at timestamptz, event_status text, posted_drive boolean, round_number int, round_name text, round_status text, eligible int, present int, advanced int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid;
BEGIN
  SELECT o_college INTO v_c FROM reports.scope();
  RETURN QUERY
  SELECT e.id, e.company_name::text, e.title::text, e.event_at, e.status, e.drive_id IS NOT NULL, r.round_number, r.name::text, r.status, x.eligible, x.present, x.advanced
    FROM campus_events e JOIN campus_rounds r ON r.event_id = e.id CROSS JOIN LATERAL (SELECT s.eligible, s.present, s.advanced FROM campus.round_stats(e.id) s WHERE s.round_id = r.id) x
   WHERE e.college_id = v_c AND e.status <> 'CANCELLED' AND (p_from IS NULL OR (e.event_at AT TIME ZONE 'Asia/Kolkata')::date >= p_from) AND (p_to IS NULL OR (e.event_at AT TIME ZONE 'Asia/Kolkata')::date <= p_to)
   ORDER BY e.event_at DESC, e.id, r.round_number;
END $$;

-- Exports are audited with the report name and the filters used (never personal data).
CREATE OR REPLACE FUNCTION reports.log_export(p_report text, p_year int) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_r text;
BEGIN
  SELECT * INTO v_u, v_c, v_r FROM reports.scope();
  IF p_report NOT IN ('departments', 'drives', 'companies', 'placed', 'unplaced', 'campus') THEN RAISE EXCEPTION 'unknown report' USING ERRCODE = '22023'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, v_r, 'REPORT_EXPORTED', 'report', p_report, jsonb_build_object('year', p_year), NULL);
END $$;

GRANT CREATE ON SCHEMA reports TO cc_auth;
ALTER FUNCTION reports.student_pool(int, uuid, text) OWNER TO cc_auth;
ALTER FUNCTION reports.placement_rows(int, uuid, text, uuid, uuid, date, date) OWNER TO cc_auth;
ALTER FUNCTION reports.funnel_rows(int, uuid, text, uuid, date, date) OWNER TO cc_auth;
ALTER FUNCTION reports.campus_rounds(date, date) OWNER TO cc_auth;
REVOKE CREATE ON SCHEMA reports FROM cc_auth;
REVOKE ALL ON FUNCTION reports.student_pool(int, uuid, text), reports.placement_rows(int, uuid, text, uuid, uuid, date, date), reports.funnel_rows(int, uuid, text, uuid, date, date), reports.campus_rounds(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reports.student_pool(int, uuid, text), reports.placement_rows(int, uuid, text, uuid, uuid, date, date), reports.funnel_rows(int, uuid, text, uuid, date, date), reports.campus_rounds(date, date) TO cc_app;
