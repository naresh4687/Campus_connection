-- 0045: only a bad degree is reported as "Choose a valid degree"; every other check violation (name, code, description) keeps its own error code.
CREATE OR REPLACE FUNCTION college.create_department(p_name text, p_code text, p_description text, p_degree text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_id uuid; v_con text;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  INSERT INTO departments (college_id, name, code, description, degree, created_by)
  VALUES (v_c, btrim(p_name), upper(btrim(p_code)), nullif(btrim(coalesce(p_description, '')), ''), nullif(btrim(coalesce(p_degree, '')), ''), v_u) RETURNING id INTO v_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'DEPARTMENT_CREATED', 'department', v_id::text, jsonb_build_object('code', upper(btrim(p_code)), 'degree', p_degree), NULL);
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'A department with this name or code already exists.' USING ERRCODE = '23505';
WHEN check_violation THEN
  GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
  IF v_con = 'departments_degree_check' THEN RAISE EXCEPTION 'Choose a valid degree.' USING ERRCODE = '22023'; END IF;
  RAISE;
END $$;

CREATE OR REPLACE FUNCTION college.update_department(p_id uuid, p_name text, p_code text, p_description text, p_degree text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_con text;
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
  GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
  IF v_con = 'departments_degree_check' THEN RAISE EXCEPTION 'Choose a valid degree.' USING ERRCODE = '22023'; END IF;
  RAISE;
END $$;
