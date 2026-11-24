-- 0044: what the report filters may offer: the college's departments and the companies it has actually dealt with (a published drive, a placement or an on-campus drive).
CREATE FUNCTION reports.filter_options() RETURNS TABLE (kind text, id uuid, label text, extra text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid;
BEGIN
  SELECT o_college INTO v_c FROM reports.scope();
  RETURN QUERY
  SELECT 'department'::text, dp.id, dp.code::text, dp.degree FROM departments dp WHERE dp.college_id = v_c
  UNION ALL
  SELECT 'company'::text, c.id, c.name::text, NULL::text FROM companies c WHERE c.college_id = v_c
     AND (EXISTS (SELECT 1 FROM drives d WHERE d.company_id = c.id AND d.published_at IS NOT NULL) OR EXISTS (SELECT 1 FROM manual_placements m WHERE m.company_id = c.id AND m.status = 'VERIFIED'))
  ORDER BY 1, 3;
END $$;
GRANT CREATE ON SCHEMA reports TO cc_auth;
ALTER FUNCTION reports.filter_options() OWNER TO cc_auth;
REVOKE CREATE ON SCHEMA reports FROM cc_auth;
REVOKE ALL ON FUNCTION reports.filter_options() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reports.filter_options() TO cc_app;
