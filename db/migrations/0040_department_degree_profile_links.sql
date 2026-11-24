-- 0040: a department belongs to one degree (B.E., B.Tech, ...), and students can add their GitHub / LeetCode / LinkedIn profiles.

ALTER TABLE departments
  ADD COLUMN degree text CHECK (degree IS NULL OR degree IN ('B.E.', 'B.Tech', 'M.E.', 'M.Tech', 'MCA', 'MBA', 'B.Sc', 'M.Sc', 'Diploma', 'Other'));
-- Existing departments take the degree most of their students already have (none if they have no students yet).
UPDATE departments d SET degree = x.degree
  FROM (SELECT DISTINCT ON (department_id) department_id, degree FROM (SELECT department_id, degree, count(*) AS n FROM students GROUP BY 1, 2) s ORDER BY department_id, n DESC) x
 WHERE x.department_id = d.id;

ALTER TABLE students
  ADD COLUMN github_url   text CHECK (github_url   IS NULL OR (length(github_url)   <= 200 AND github_url   ~ '^https://(www\.)?github\.com/[A-Za-z0-9._-]+/?$')),
  ADD COLUMN leetcode_url text CHECK (leetcode_url IS NULL OR (length(leetcode_url) <= 200 AND leetcode_url ~ '^https://(www\.)?leetcode\.com/(u/)?[A-Za-z0-9._-]+/?$')),
  ADD COLUMN linkedin_url text CHECK (linkedin_url IS NULL OR (length(linkedin_url) <= 200 AND linkedin_url ~ '^https://([a-z]{2,3}\.)?linkedin\.com/in/[A-Za-z0-9._%-]+/?$'));

DROP FUNCTION college.create_department(text, text, text);
DROP FUNCTION college.update_department(uuid, text, text, text);

CREATE FUNCTION college.create_department(p_name text, p_code text, p_description text, p_degree text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_id uuid;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  INSERT INTO departments (college_id, name, code, description, degree, created_by)
  VALUES (v_c, btrim(p_name), upper(btrim(p_code)), nullif(btrim(coalesce(p_description, '')), ''), nullif(btrim(coalesce(p_degree, '')), ''), v_u) RETURNING id INTO v_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'DEPARTMENT_CREATED', 'department', v_id::text, jsonb_build_object('code', upper(btrim(p_code)), 'degree', p_degree), NULL);
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'A department with this name or code already exists.' USING ERRCODE = '23505';
WHEN check_violation THEN
  RAISE EXCEPTION 'Choose a valid degree.' USING ERRCODE = '22023';
END $$;

CREATE FUNCTION college.update_department(p_id uuid, p_name text, p_code text, p_description text, p_degree text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  UPDATE departments SET name = btrim(p_name), code = upper(btrim(p_code)), description = nullif(btrim(coalesce(p_description, '')), ''),
         degree = nullif(btrim(coalesce(p_degree, '')), ''), updated_at = now()
   WHERE id = p_id AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'department not found' USING ERRCODE = '22023'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'DEPARTMENT_UPDATED', 'department', p_id::text, '{}'::jsonb, NULL);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'A department with this name or code already exists.' USING ERRCODE = '23505';
WHEN check_violation THEN
  RAISE EXCEPTION 'Choose a valid degree.' USING ERRCODE = '22023';
END $$;

-- A student edits ONLY their own public profile links. Empty clears a link.
CREATE FUNCTION students.update_own_links(p_github text, p_leetcode text, p_linkedin text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_sid uuid;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  UPDATE students SET github_url = nullif(btrim(coalesce(p_github, '')), ''), leetcode_url = nullif(btrim(coalesce(p_leetcode, '')), ''),
         linkedin_url = nullif(btrim(coalesce(p_linkedin, '')), ''), updated_at = now()
   WHERE user_id = v_user AND college_id = v_c RETURNING id INTO v_sid;
  IF NOT FOUND THEN RAISE EXCEPTION 'student record not found' USING ERRCODE = '22023'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'STUDENT', 'STUDENT_LINKS_UPDATED', 'student', v_sid::text, '{}'::jsonb, NULL);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Enter the full profile address, for example https://github.com/yourname.' USING ERRCODE = '22023';
END $$;

GRANT CREATE ON SCHEMA college, students TO cc_auth;
ALTER FUNCTION college.create_department(text, text, text, text) OWNER TO cc_auth;
ALTER FUNCTION college.update_department(uuid, text, text, text, text) OWNER TO cc_auth;
ALTER FUNCTION students.update_own_links(text, text, text) OWNER TO cc_auth;
REVOKE CREATE ON SCHEMA college, students FROM cc_auth;
REVOKE ALL ON FUNCTION college.create_department(text, text, text, text), college.update_department(uuid, text, text, text, text), students.update_own_links(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION college.create_department(text, text, text, text), college.update_department(uuid, text, text, text, text), students.update_own_links(text, text, text) TO cc_app;
