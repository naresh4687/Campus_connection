-- 0041: the public sign-up page also learns each department's degree, so choosing a department can fill in the degree.
CREATE OR REPLACE FUNCTION students.peek_join(p_college uuid, p_version int) RETURNS TABLE (college_name text, departments jsonb)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT c.name::text,
         coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code::text, 'name', d.name::text, 'degree', d.degree) ORDER BY d.code) FROM departments d WHERE d.college_id = c.id AND d.status = 'ACTIVE'), '[]'::jsonb)
    FROM colleges c JOIN college_join_links l ON l.college_id = c.id
   WHERE c.id = p_college AND c.status = 'ACTIVE' AND l.enabled AND l.version = p_version
$$;
