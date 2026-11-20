-- 0038: the students a placement officer (all) or coordinator (their departments) may pick when recording an offer, with how many live offers each has and where they accepted.
CREATE FUNCTION placement.recordable_students() RETURNS TABLE (id uuid, full_name text, register_number text, department_code text, passing_year int, offers int, accepted_company text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_role text := app.current_role();
BEGIN
  IF v_c IS NULL OR v_role NOT IN ('PLACEMENT_OFFICER', 'COORDINATOR') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT st.id, st.full_name::text, st.register_number::text, dp.code::text, st.passing_year,
         (SELECT count(*)::int FROM manual_placements m WHERE m.student_id = st.id AND m.status <> 'REJECTED'),
         (SELECT c.name::text FROM manual_placements m JOIN companies c ON c.id = m.company_id WHERE m.student_id = st.id AND m.offer_status = 'ACCEPTED' AND m.status <> 'REJECTED' LIMIT 1)
    FROM students st JOIN departments dp ON dp.id = st.department_id
   WHERE st.college_id = v_c AND (v_role = 'PLACEMENT_OFFICER' OR st.department_id = ANY (announcements.my_departments()))
   ORDER BY dp.code, st.full_name LIMIT 2000;
END $$;
GRANT CREATE ON SCHEMA placement TO cc_auth;
ALTER FUNCTION placement.recordable_students() OWNER TO cc_auth;
REVOKE CREATE ON SCHEMA placement FROM cc_auth;
REVOKE ALL ON FUNCTION placement.recordable_students() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION placement.recordable_students() TO cc_app;
