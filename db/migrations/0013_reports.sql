-- 0013_reports: read-only reporting functions for placement officers and college administrators.
-- Every number comes from the same tables the workflows write; nothing is stored or cached. A "placement" is a VERIFIED placement whose
-- offer is ACCEPTED (TD-11/TD-31) — accepted offers and recorded joinings are reported separately. Year filter = the student's passing year.

CREATE SCHEMA reports; REVOKE ALL ON SCHEMA reports FROM PUBLIC; GRANT USAGE ON SCHEMA reports TO cc_app; GRANT USAGE, CREATE ON SCHEMA reports TO cc_auth;

CREATE FUNCTION reports.scope(OUT o_user uuid, OUT o_college uuid, OUT o_role text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  o_role := app.current_role(); o_user := app.current_user_id(); o_college := app.current_college_id();
  IF o_college IS NULL OR o_role IS DISTINCT FROM 'PLACEMENT_OFFICER' AND o_role IS DISTINCT FROM 'COLLEGE_ADMIN' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
END $$;

-- A student counts as "placed" when a VERIFIED placement exists for an ACCEPTED offer.
CREATE FUNCTION reports.is_placed(p_student uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM placements p JOIN selections s ON s.id = p.selection_id WHERE p.student_id = p_student AND p.status = 'VERIFIED' AND s.offer_status = 'ACCEPTED')
$$;

CREATE FUNCTION reports.years() RETURNS TABLE (passing_year int) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid;
BEGIN
  SELECT o_college INTO v_c FROM reports.scope();
  RETURN QUERY SELECT DISTINCT st.passing_year FROM students st WHERE st.college_id = v_c ORDER BY 1 DESC;
END $$;

CREATE FUNCTION reports.department_summary(p_year int) RETURNS TABLE (code text, name text, students int, registered_students int, selected_students int, accepted_students int, placed_students int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid;
BEGIN
  SELECT o_college INTO v_c FROM reports.scope();
  RETURN QUERY
  SELECT dp.code::text, dp.name::text, count(st.id)::int,
         (count(st.id) FILTER (WHERE EXISTS (SELECT 1 FROM registrations r WHERE r.student_id = st.id AND r.status = 'REGISTERED')))::int,
         (count(st.id) FILTER (WHERE EXISTS (SELECT 1 FROM selections s WHERE s.student_id = st.id AND s.offer_status <> 'WITHDRAWN')))::int,
         (count(st.id) FILTER (WHERE EXISTS (SELECT 1 FROM selections s WHERE s.student_id = st.id AND s.offer_status = 'ACCEPTED')))::int,
         (count(st.id) FILTER (WHERE reports.is_placed(st.id)))::int
    FROM departments dp LEFT JOIN students st ON st.department_id = dp.id AND (p_year IS NULL OR st.passing_year = p_year)
   WHERE dp.college_id = v_c GROUP BY dp.id ORDER BY dp.code;
END $$;

CREATE FUNCTION reports.drive_summary(p_year int) RETURNS TABLE (drive_id uuid, job_title text, company_name text, status text, registered int, selected int, offers_issued int, accepted int, placed int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid;
BEGIN
  SELECT o_college INTO v_c FROM reports.scope();
  RETURN QUERY
  SELECT d.id, d.job_title, d.company_name, d.status,
         (SELECT count(*)::int FROM registrations r JOIN students st ON st.id = r.student_id WHERE r.drive_id = d.id AND r.status = 'REGISTERED' AND (p_year IS NULL OR st.passing_year = p_year)),
         (SELECT count(*)::int FROM selections s JOIN students st ON st.id = s.student_id WHERE s.drive_id = d.id AND s.offer_status <> 'WITHDRAWN' AND (p_year IS NULL OR st.passing_year = p_year)),
         (SELECT count(*)::int FROM selections s JOIN students st ON st.id = s.student_id WHERE s.drive_id = d.id AND s.issued_at IS NOT NULL AND (p_year IS NULL OR st.passing_year = p_year)),
         (SELECT count(*)::int FROM selections s JOIN students st ON st.id = s.student_id WHERE s.drive_id = d.id AND s.offer_status = 'ACCEPTED' AND (p_year IS NULL OR st.passing_year = p_year)),
         (SELECT count(*)::int FROM placements p JOIN selections s ON s.id = p.selection_id JOIN students st ON st.id = p.student_id WHERE p.drive_id = d.id AND p.status = 'VERIFIED' AND s.offer_status = 'ACCEPTED' AND (p_year IS NULL OR st.passing_year = p_year))
    FROM drives d WHERE d.college_id = v_c AND d.status IN ('PUBLISHED', 'CLOSED', 'ARCHIVED') AND d.published_at IS NOT NULL ORDER BY d.published_at DESC, d.id;
END $$;

CREATE FUNCTION reports.company_summary(p_year int) RETURNS TABLE (company_id uuid, company_name text, drives int, selected int, accepted int, placed int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid;
BEGIN
  SELECT o_college INTO v_c FROM reports.scope();
  RETURN QUERY
  SELECT d.company_id, max(d.company_name), count(DISTINCT d.id)::int,
         (SELECT count(*)::int FROM selections s JOIN drives d2 ON d2.id = s.drive_id JOIN students st ON st.id = s.student_id WHERE d2.company_id = d.company_id AND s.offer_status <> 'WITHDRAWN' AND (p_year IS NULL OR st.passing_year = p_year)),
         (SELECT count(*)::int FROM selections s JOIN drives d2 ON d2.id = s.drive_id JOIN students st ON st.id = s.student_id WHERE d2.company_id = d.company_id AND s.offer_status = 'ACCEPTED' AND (p_year IS NULL OR st.passing_year = p_year)),
         (SELECT count(*)::int FROM placements p JOIN selections s ON s.id = p.selection_id JOIN drives d2 ON d2.id = p.drive_id JOIN students st ON st.id = p.student_id WHERE d2.company_id = d.company_id AND p.status = 'VERIFIED' AND s.offer_status = 'ACCEPTED' AND (p_year IS NULL OR st.passing_year = p_year))
    FROM drives d WHERE d.college_id = v_c AND d.status IN ('PUBLISHED', 'CLOSED', 'ARCHIVED') AND d.published_at IS NOT NULL GROUP BY d.company_id ORDER BY max(d.company_name), d.company_id;
END $$;

-- CTC statistics over VERIFIED placements only (offers that stated a CTC); NULL when there is nothing to average.
CREATE FUNCTION reports.ctc_stats(p_year int) RETURNS TABLE (placed int, with_ctc int, highest numeric, average numeric, median numeric)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid;
BEGIN
  SELECT o_college INTO v_c FROM reports.scope();
  RETURN QUERY
  WITH pl AS (SELECT s.offered_ctc_lpa AS ctc FROM placements p JOIN selections s ON s.id = p.selection_id JOIN students st ON st.id = p.student_id
               WHERE p.college_id = v_c AND p.status = 'VERIFIED' AND s.offer_status = 'ACCEPTED' AND (p_year IS NULL OR st.passing_year = p_year))
  SELECT count(*)::int, count(ctc)::int, max(ctc), round(avg(ctc), 2), round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ctc))::numeric, 2) FROM pl;
END $$;

CREATE FUNCTION reports.placed_students(p_year int) RETURNS TABLE (full_name text, register_number text, department_code text, degree text, passing_year int, company_name text, job_title text, ctc_lpa numeric, joined_on date)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid;
BEGIN
  SELECT o_college INTO v_c FROM reports.scope();
  RETURN QUERY
  SELECT st.full_name, st.register_number::text, dp.code::text, st.degree, st.passing_year, d.company_name, d.job_title, s.offered_ctc_lpa, p.joined_on
    FROM placements p JOIN selections s ON s.id = p.selection_id JOIN drives d ON d.id = p.drive_id JOIN students st ON st.id = p.student_id JOIN departments dp ON dp.id = st.department_id
   WHERE p.college_id = v_c AND p.status = 'VERIFIED' AND s.offer_status = 'ACCEPTED' AND (p_year IS NULL OR st.passing_year = p_year) ORDER BY st.full_name, p.id;
END $$;

-- Exports contain personal data: each one is recorded in the audit log (type and year only).
CREATE FUNCTION reports.log_export(p_report text, p_year int) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_r text;
BEGIN
  SELECT * INTO v_u, v_c, v_r FROM reports.scope();
  IF p_report NOT IN ('departments', 'drives', 'companies', 'placed') THEN RAISE EXCEPTION 'unknown report' USING ERRCODE = '22023'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, v_r, 'REPORT_EXPORTED', 'report', p_report, jsonb_build_object('year', p_year), NULL);
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'reports' LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION reports.years(), reports.department_summary(int), reports.drive_summary(int), reports.company_summary(int), reports.ctc_stats(int), reports.placed_students(int), reports.log_export(text, int) TO cc_app;
REVOKE CREATE ON SCHEMA reports FROM cc_auth;     -- reports.scope and reports.is_placed are internal
