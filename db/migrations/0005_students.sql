-- 0005_students: student records (separate from login accounts), CSV import staging, student invitations tied to a record,
-- department-scoped student access, and the `students` function layer. Student rows are written ONLY by audited functions.

GRANT CREATE ON SCHEMA auth TO cc_auth;            -- temporary (function replacement + ownership); revoked at the end
CREATE SCHEMA students;
REVOKE ALL ON SCHEMA students FROM PUBLIC;
GRANT USAGE ON SCHEMA students TO cc_app;
GRANT USAGE, CREATE ON SCHEMA students TO cc_auth; -- CREATE revoked at the end

-- ───────────── students ─────────────
CREATE TABLE students (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id      uuid NOT NULL,
  department_id   uuid NOT NULL,
  user_id         uuid UNIQUE,                    -- NULL until the student accepts their invitation
  user_role       text NOT NULL DEFAULT 'STUDENT' CHECK (user_role = 'STUDENT'),
  register_number citext NOT NULL CHECK (register_number::text ~ '^[A-Za-z0-9][A-Za-z0-9/._-]{2,29}$'),
  full_name       text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 120),
  college_email   citext NOT NULL CHECK (length(college_email::text) BETWEEN 3 AND 254 AND college_email::text ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  personal_email  citext CHECK (personal_email IS NULL OR (length(personal_email::text) BETWEEN 3 AND 254 AND personal_email::text ~ '^[^@[:space:]]+@[^@[:space:]]+$')),
  phone           text CHECK (phone IS NULL OR phone ~ '^[0-9+() -]{7,20}$'),
  degree          text NOT NULL CHECK (degree IN ('B.E.', 'B.Tech', 'M.E.', 'M.Tech', 'MCA', 'MBA', 'B.Sc', 'M.Sc', 'Diploma', 'Other')),
  specialization  text CHECK (specialization IS NULL OR length(btrim(specialization)) BETWEEN 1 AND 100),
  admission_year  int NOT NULL CHECK (admission_year BETWEEN 1990 AND 2100),
  passing_year    int NOT NULL CHECK (passing_year BETWEEN 1990 AND 2110),
  import_id       uuid,
  created_by      uuid REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT students_year_order CHECK (passing_year > admission_year AND passing_year <= admission_year + 8),
  CONSTRAINT students_register_per_college UNIQUE (college_id, register_number),
  CONSTRAINT students_email_per_college UNIQUE (college_id, college_email),
  UNIQUE (college_id, id),
  FOREIGN KEY (college_id, department_id) REFERENCES departments (college_id, id),
  FOREIGN KEY (college_id, user_id, user_role) REFERENCES users (college_id, id, role)
);
CREATE INDEX students_department_idx ON students (college_id, department_id);
CREATE INDEX students_passing_year_idx ON students (college_id, passing_year);

-- A STUDENT invitation must reference the student record it is for, in the same college.
ALTER TABLE invitations ADD COLUMN student_id uuid;
ALTER TABLE invitations ADD CONSTRAINT invitations_student_link CHECK ((role = 'STUDENT') = (student_id IS NOT NULL));
ALTER TABLE invitations ADD FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id);
CREATE INDEX invitations_student_idx ON invitations (student_id) WHERE student_id IS NOT NULL;

-- ───────────── CSV import staging ─────────────
CREATE TABLE student_imports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id    uuid NOT NULL REFERENCES colleges (id),
  created_by    uuid NOT NULL REFERENCES users (id),
  filename      text NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
  status        text NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED', 'VALIDATED', 'COMMITTED', 'CANCELLED')),
  headers       jsonb NOT NULL,
  mapping       jsonb,
  total_rows    int NOT NULL CHECK (total_rows BETWEEN 1 AND 5000),
  valid_rows    int NOT NULL DEFAULT 0,
  error_rows    int NOT NULL DEFAULT 0,
  duplicate_rows int NOT NULL DEFAULT 0,
  imported_rows int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  validated_at  timestamptz,
  committed_at  timestamptz,
  UNIQUE (college_id, id)
);
CREATE TABLE student_import_rows (
  import_id   uuid NOT NULL,
  college_id  uuid NOT NULL,
  row_number  int NOT NULL CHECK (row_number >= 1),
  raw         jsonb,                              -- the uploaded cells; cleared once a row has been imported
  status      text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VALID', 'ERROR', 'DUPLICATE', 'IMPORTED')),
  normalized  jsonb,
  errors      jsonb NOT NULL DEFAULT '[]'::jsonb,
  student_id  uuid,
  PRIMARY KEY (import_id, row_number),
  FOREIGN KEY (college_id, import_id) REFERENCES student_imports (college_id, id) ON DELETE CASCADE,
  FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id)
);
ALTER TABLE students ADD FOREIGN KEY (college_id, import_id) REFERENCES student_imports (college_id, id);

-- ───────────── privileges + RLS ─────────────
GRANT SELECT, INSERT, UPDATE ON students, student_imports TO cc_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON student_import_rows TO cc_auth;
GRANT DELETE ON student_imports TO cc_auth;
GRANT SELECT ON students, student_imports, student_import_rows TO cc_app;      -- runtime role: read only
GRANT SELECT (student_id) ON invitations TO cc_app;

ALTER TABLE students            ENABLE ROW LEVEL SECURITY; ALTER TABLE students            FORCE ROW LEVEL SECURITY;
ALTER TABLE student_imports     ENABLE ROW LEVEL SECURITY; ALTER TABLE student_imports     FORCE ROW LEVEL SECURITY;
ALTER TABLE student_import_rows ENABLE ROW LEVEL SECURITY; ALTER TABLE student_import_rows FORCE ROW LEVEL SECURITY;

-- Admins: every student of their college. Coordinators: ONLY students of departments currently assigned to them.
-- Students: only their own record. Placement officers and the platform: none (officer access is added with the drive modules).
CREATE POLICY students_select_admin ON students FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) = 'COLLEGE_ADMIN');
CREATE POLICY students_select_coordinator ON students FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) = 'COORDINATOR'
         AND department_id IN (SELECT a.department_id FROM coordinator_assignments a WHERE a.user_id = app.current_user_id() AND a.ended_at IS NULL));
CREATE POLICY students_select_self ON students FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) = 'STUDENT' AND user_id = app.current_user_id());
-- A student can read exactly one department: the one their own record belongs to (needed to show their profile).
CREATE POLICY departments_select_student ON departments FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) = 'STUDENT'
         AND id IN (SELECT s.department_id FROM students s WHERE s.user_id = app.current_user_id()));
CREATE POLICY imports_select_admin ON student_imports FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) = 'COLLEGE_ADMIN');
CREATE POLICY import_rows_select_admin ON student_import_rows FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) = 'COLLEGE_ADMIN');

-- ───────────── student functions ─────────────
CREATE FUNCTION students.create_student(p_dept uuid, p_register text, p_name text, p_email citext, p_personal citext, p_phone text,
                                        p_degree text, p_spec text, p_adm int, p_pass int) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_id uuid; v_dstatus text; v_con text;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  SELECT status INTO v_dstatus FROM departments WHERE id = p_dept AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'department not found' USING ERRCODE = '22023'; END IF;
  IF v_dstatus <> 'ACTIVE' THEN RAISE EXCEPTION 'cannot add a student to an inactive department' USING ERRCODE = '22023'; END IF;
  INSERT INTO students (college_id, department_id, register_number, full_name, college_email, personal_email, phone, degree, specialization, admission_year, passing_year, created_by)
  VALUES (v_c, p_dept, btrim(p_register), btrim(p_name), lower(btrim(p_email::text)), nullif(lower(btrim(coalesce(p_personal::text, ''))), ''),
          nullif(btrim(coalesce(p_phone, '')), ''), p_degree, nullif(btrim(coalesce(p_spec, '')), ''), p_adm, p_pass, v_u)
  RETURNING id INTO v_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'STUDENT_CREATED', 'student', v_id::text, '{}'::jsonb, NULL);
  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con = 'students_register_per_college' THEN RAISE EXCEPTION 'A student with this register number already exists.' USING ERRCODE = '23505'; END IF;
    RAISE EXCEPTION 'A student with this college email already exists.' USING ERRCODE = '23505';
  WHEN check_violation THEN
    RAISE EXCEPTION 'Some student details are invalid (check the register number, email, phone, degree and years).' USING ERRCODE = '22023';
END $$;

CREATE FUNCTION students.update_student(p_id uuid, p_dept uuid, p_register text, p_name text, p_email citext, p_personal citext, p_phone text,
                                        p_degree text, p_spec text, p_adm int, p_pass int) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_old students%ROWTYPE; v_dstatus text; v_con text; v_email citext := lower(btrim(p_email::text));
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  SELECT * INTO v_old FROM students WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found' USING ERRCODE = '22023'; END IF;
  IF p_dept IS DISTINCT FROM v_old.department_id THEN
    SELECT status INTO v_dstatus FROM departments WHERE id = p_dept AND college_id = v_c;
    IF NOT FOUND THEN RAISE EXCEPTION 'department not found' USING ERRCODE = '22023'; END IF;
    IF v_dstatus <> 'ACTIVE' THEN RAISE EXCEPTION 'cannot move a student to an inactive department' USING ERRCODE = '22023'; END IF;
  END IF;
  IF v_old.user_id IS NOT NULL AND v_email IS DISTINCT FROM v_old.college_email THEN
    RAISE EXCEPTION 'The college email cannot be changed once the student has an account.' USING ERRCODE = '22023';
  END IF;
  UPDATE students SET department_id = p_dept, register_number = btrim(p_register), full_name = btrim(p_name), college_email = v_email,
         personal_email = nullif(lower(btrim(coalesce(p_personal::text, ''))), ''), phone = nullif(btrim(coalesce(p_phone, '')), ''), degree = p_degree,
         specialization = nullif(btrim(coalesce(p_spec, '')), ''), admission_year = p_adm, passing_year = p_pass, updated_at = now()
   WHERE id = p_id;
  IF v_email IS DISTINCT FROM v_old.college_email THEN   -- an invitation sent to the old address must not stay usable
    UPDATE invitations SET revoked_at = now() WHERE student_id = p_id AND accepted_at IS NULL AND revoked_at IS NULL;
  END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'STUDENT_UPDATED', 'student', p_id::text, '{}'::jsonb, NULL);
EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con = 'students_register_per_college' THEN RAISE EXCEPTION 'A student with this register number already exists.' USING ERRCODE = '23505'; END IF;
    RAISE EXCEPTION 'A student with this college email already exists.' USING ERRCODE = '23505';
  WHEN check_violation THEN
    RAISE EXCEPTION 'Some student details are invalid (check the register number, email, phone, degree and years).' USING ERRCODE = '22023';
END $$;

-- Internal: invite one student. Returns OK | NOT_FOUND | HAS_ACCOUNT | EMAIL_IN_USE.
CREATE FUNCTION students.invite_one(p_actor uuid, p_college uuid, p_student uuid, p_hash bytea, p_ttl int) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_s students%ROWTYPE;
BEGIN
  SELECT * INTO v_s FROM students WHERE id = p_student AND college_id = p_college FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF v_s.user_id IS NOT NULL THEN RETURN 'HAS_ACCOUNT'; END IF;
  IF EXISTS (SELECT 1 FROM users WHERE email = v_s.college_email) THEN RETURN 'EMAIL_IN_USE'; END IF;
  UPDATE invitations SET revoked_at = now() WHERE (student_id = p_student OR email = v_s.college_email) AND accepted_at IS NULL AND revoked_at IS NULL;
  INSERT INTO invitations (email, role, college_id, invited_by, token_hash, expires_at, student_id)
  VALUES (v_s.college_email, 'STUDENT', p_college, p_actor, p_hash, now() + make_interval(secs => p_ttl), p_student);
  RETURN 'OK';
END $$;

CREATE FUNCTION students.invite_student(p_student uuid, p_hash bytea, p_ttl int) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_r text;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  IF p_ttl NOT BETWEEN 600 AND 1209600 THEN RAISE EXCEPTION 'invitation lifetime must be 10 minutes to 14 days' USING ERRCODE = '22023'; END IF;
  v_r := students.invite_one(v_u, v_c, p_student, p_hash, p_ttl);
  IF v_r = 'NOT_FOUND' THEN RAISE EXCEPTION 'student not found' USING ERRCODE = '22023'; END IF;
  IF v_r = 'HAS_ACCOUNT' THEN RAISE EXCEPTION 'This student already has an account.' USING ERRCODE = '22023'; END IF;
  IF v_r = 'EMAIL_IN_USE' THEN RAISE EXCEPTION 'An account with this email address already exists.' USING ERRCODE = '23505'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'STUDENT_INVITED', 'student', p_student::text, '{}'::jsonb, NULL);
END $$;

CREATE FUNCTION students.invite_students(p_ids uuid[], p_hashes bytea[], p_ttl int) RETURNS TABLE (student_id uuid, outcome text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; i int; v_r text; v_ok int := 0;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  IF p_ttl NOT BETWEEN 600 AND 1209600 THEN RAISE EXCEPTION 'invitation lifetime must be 10 minutes to 14 days' USING ERRCODE = '22023'; END IF;
  IF coalesce(array_length(p_ids, 1), 0) NOT BETWEEN 1 AND 500 OR array_length(p_ids, 1) IS DISTINCT FROM array_length(p_hashes, 1) THEN
    RAISE EXCEPTION 'between 1 and 500 students per bulk invitation' USING ERRCODE = '22023';
  END IF;
  FOR i IN 1 .. array_length(p_ids, 1) LOOP
    v_r := students.invite_one(v_u, v_c, p_ids[i], p_hashes[i], p_ttl);
    IF v_r = 'OK' THEN v_ok := v_ok + 1; END IF;
    student_id := p_ids[i]; outcome := v_r; RETURN NEXT;
  END LOOP;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'STUDENTS_INVITED_BULK', 'student', NULL, jsonb_build_object('invited', v_ok, 'requested', array_length(p_ids, 1)), NULL);
END $$;

-- A student may change ONLY their own phone and personal email. Everything else is college-controlled.
CREATE FUNCTION students.update_own_contact(p_phone text, p_personal citext) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_sid uuid;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  UPDATE students SET phone = nullif(btrim(coalesce(p_phone, '')), ''), personal_email = nullif(lower(btrim(coalesce(p_personal::text, ''))), ''), updated_at = now()
   WHERE user_id = v_user AND college_id = v_c RETURNING id INTO v_sid;
  IF NOT FOUND THEN RAISE EXCEPTION 'student record not found' USING ERRCODE = '22023'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'STUDENT', 'STUDENT_CONTACT_UPDATED', 'student', v_sid::text, '{}'::jsonb, NULL);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Enter a valid phone number and email address.' USING ERRCODE = '22023';
END $$;

-- ───────────── import functions ─────────────
CREATE FUNCTION students.create_import(p_filename text, p_headers jsonb, p_rows jsonb) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_id uuid; v_n int;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  IF jsonb_typeof(p_headers) <> 'array' OR jsonb_array_length(p_headers) NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'the file must have 1-30 columns' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'invalid rows' USING ERRCODE = '22023'; END IF;
  v_n := jsonb_array_length(p_rows);
  IF v_n NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'the file must have 1-5000 data rows' USING ERRCODE = '22023'; END IF;
  INSERT INTO student_imports (college_id, created_by, filename, headers, total_rows) VALUES (v_c, v_u, left(btrim(p_filename), 200), p_headers, v_n) RETURNING id INTO v_id;
  INSERT INTO student_import_rows (import_id, college_id, row_number, raw)
  SELECT v_id, v_c, (t.ord)::int, t.val FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(val, ord);
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'STUDENT_IMPORT_UPLOADED', 'student_import', v_id::text, jsonb_build_object('rows', v_n), NULL);
  RETURN v_id;
END $$;

CREATE FUNCTION students.save_validation(p_import uuid, p_mapping jsonb, p_results jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_status text; v_total int;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  SELECT status, total_rows INTO v_status, v_total FROM student_imports WHERE id = p_import AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import not found' USING ERRCODE = '22023'; END IF;
  IF v_status NOT IN ('UPLOADED', 'VALIDATED') THEN RAISE EXCEPTION 'this import can no longer be changed' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_results) <> 'array' OR jsonb_array_length(p_results) <> v_total THEN RAISE EXCEPTION 'validation results do not match the file' USING ERRCODE = '22023'; END IF;
  UPDATE student_import_rows r SET status = x.status, normalized = x.normalized, errors = coalesce(x.errors, '[]'::jsonb)
    FROM jsonb_to_recordset(p_results) AS x(n int, status text, normalized jsonb, errors jsonb)
   WHERE r.import_id = p_import AND r.row_number = x.n AND x.status IN ('VALID', 'ERROR', 'DUPLICATE');
  IF EXISTS (SELECT 1 FROM student_import_rows WHERE import_id = p_import AND status = 'PENDING') THEN RAISE EXCEPTION 'validation results are incomplete' USING ERRCODE = '22023'; END IF;
  UPDATE student_imports SET status = 'VALIDATED', mapping = p_mapping, validated_at = now(),
         valid_rows = (SELECT count(*) FROM student_import_rows WHERE import_id = p_import AND status = 'VALID'),
         error_rows = (SELECT count(*) FROM student_import_rows WHERE import_id = p_import AND status = 'ERROR'),
         duplicate_rows = (SELECT count(*) FROM student_import_rows WHERE import_id = p_import AND status = 'DUPLICATE')
   WHERE id = p_import;
END $$;

-- Creates students only for rows that are still valid. Existing students are NEVER modified: a row that now collides
-- with an existing student (e.g. created after validation) is reported as a duplicate and skipped.
CREATE FUNCTION students.commit_import(p_import uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_status text; r record; v_n jsonb; v_sid uuid; v_dstatus text; v_imp int := 0; v_dup int := 0; v_err int := 0;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  SELECT status INTO v_status FROM student_imports WHERE id = p_import AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import not found' USING ERRCODE = '22023'; END IF;
  IF v_status <> 'VALIDATED' THEN RAISE EXCEPTION 'only a validated, uncommitted import can be committed' USING ERRCODE = '22023'; END IF;
  FOR r IN SELECT row_number, normalized FROM student_import_rows WHERE import_id = p_import AND status = 'VALID' ORDER BY row_number LOOP
    v_n := r.normalized;
    BEGIN
      SELECT status INTO v_dstatus FROM departments WHERE id = (v_n->>'department_id')::uuid AND college_id = v_c;
      IF v_dstatus IS DISTINCT FROM 'ACTIVE' THEN
        UPDATE student_import_rows SET status = 'ERROR', errors = jsonb_build_array('The department is missing or inactive.') WHERE import_id = p_import AND row_number = r.row_number;
        v_err := v_err + 1; CONTINUE;
      END IF;
      INSERT INTO students (college_id, department_id, register_number, full_name, college_email, personal_email, phone, degree, specialization, admission_year, passing_year, import_id, created_by)
      VALUES (v_c, (v_n->>'department_id')::uuid, btrim(v_n->>'register_number'), btrim(v_n->>'full_name'), lower(btrim(v_n->>'college_email')),
              nullif(lower(btrim(coalesce(v_n->>'personal_email', ''))), ''), nullif(btrim(coalesce(v_n->>'phone', '')), ''), v_n->>'degree',
              nullif(btrim(coalesce(v_n->>'specialization', '')), ''), (v_n->>'admission_year')::int, (v_n->>'passing_year')::int, p_import, v_u)
      RETURNING id INTO v_sid;
      UPDATE student_import_rows SET status = 'IMPORTED', student_id = v_sid, raw = NULL WHERE import_id = p_import AND row_number = r.row_number;
      v_imp := v_imp + 1;
    EXCEPTION
      WHEN unique_violation THEN
        UPDATE student_import_rows SET status = 'DUPLICATE', errors = jsonb_build_array('A student with this register number or college email already exists.') WHERE import_id = p_import AND row_number = r.row_number;
        v_dup := v_dup + 1;
      WHEN OTHERS THEN
        UPDATE student_import_rows SET status = 'ERROR', errors = jsonb_build_array('The row was rejected by the database checks.') WHERE import_id = p_import AND row_number = r.row_number;
        v_err := v_err + 1;
    END;
  END LOOP;
  UPDATE student_imports SET status = 'COMMITTED', committed_at = now(),
         imported_rows = (SELECT count(*) FROM student_import_rows WHERE import_id = p_import AND status = 'IMPORTED'),
         valid_rows = 0,
         error_rows = (SELECT count(*) FROM student_import_rows WHERE import_id = p_import AND status = 'ERROR'),
         duplicate_rows = (SELECT count(*) FROM student_import_rows WHERE import_id = p_import AND status = 'DUPLICATE')
   WHERE id = p_import;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'STUDENTS_IMPORTED', 'student_import', p_import::text,
                           jsonb_build_object('imported', (SELECT imported_rows FROM student_imports WHERE id = p_import), 'duplicates', (SELECT duplicate_rows FROM student_imports WHERE id = p_import),
                                              'errors', (SELECT error_rows FROM student_imports WHERE id = p_import)), NULL);
  RETURN (SELECT jsonb_build_object('imported', imported_rows, 'duplicates', duplicate_rows, 'errors', error_rows) FROM student_imports WHERE id = p_import);
END $$;

-- Cancelling deletes the staged rows (they contain personal data).
CREATE FUNCTION students.cancel_import(p_import uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_status text;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  SELECT status INTO v_status FROM student_imports WHERE id = p_import AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import not found' USING ERRCODE = '22023'; END IF;
  IF v_status NOT IN ('UPLOADED', 'VALIDATED') THEN RAISE EXCEPTION 'only an uncommitted import can be cancelled' USING ERRCODE = '22023'; END IF;
  DELETE FROM student_import_rows WHERE import_id = p_import;
  UPDATE student_imports SET status = 'CANCELLED' WHERE id = p_import;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'STUDENT_IMPORT_CANCELLED', 'student_import', p_import::text, '{}'::jsonb, NULL);
END $$;

-- ───────────── ownership + execute privileges ─────────────
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'students' LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION
  students.create_student(uuid, text, text, citext, citext, text, text, text, int, int),
  students.update_student(uuid, uuid, text, text, citext, citext, text, text, text, int, int),
  students.invite_student(uuid, bytea, int), students.invite_students(uuid[], bytea[], int), students.update_own_contact(text, citext),
  students.create_import(text, jsonb, jsonb), students.save_validation(uuid, jsonb, jsonb), students.commit_import(uuid), students.cancel_import(uuid)
  TO cc_app;
-- students.invite_one is internal.

-- ───────────── replace two Phase 1 functions (run as their owner, cc_auth) ─────────────
SET LOCAL ROLE cc_auth;

-- Student accounts can only be invited from a student record (students.invite_student), never by free-form email.
CREATE OR REPLACE FUNCTION auth.create_invitation(p_email citext, p_role text, p_college_id uuid, p_token_hash bytea, p_ttl_seconds int)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := app.current_user_id(); v_role text := app.current_role(); v_college uuid := app.current_college_id();
        v_target_college uuid; v_id uuid;
BEGIN
  IF v_actor IS NULL OR v_role IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_role = 'STUDENT' THEN RAISE EXCEPTION 'student invitations are created from the student record' USING ERRCODE = '42501'; END IF;
  IF p_ttl_seconds NOT BETWEEN 600 AND 1209600 THEN RAISE EXCEPTION 'invitation lifetime must be 10 minutes to 14 days' USING ERRCODE = '22023'; END IF;
  IF p_email IS NULL OR length(p_email::text) NOT BETWEEN 3 AND 254 OR position('@' IN p_email::text) < 2 THEN
    RAISE EXCEPTION 'invalid email' USING ERRCODE = '22023';
  END IF;

  IF v_role = 'PLATFORM_SUPER_ADMIN' THEN
    IF p_role <> 'COLLEGE_ADMIN' THEN RAISE EXCEPTION 'platform admins may only invite college admins' USING ERRCODE = '42501'; END IF;
    v_target_college := p_college_id;
  ELSIF v_role = 'COLLEGE_ADMIN' THEN
    IF p_role NOT IN ('PLACEMENT_OFFICER', 'COORDINATOR') THEN
      RAISE EXCEPTION 'college admins may only invite placement officers and coordinators here' USING ERRCODE = '42501';
    END IF;
    IF p_college_id IS NOT NULL AND p_college_id <> v_college THEN RAISE EXCEPTION 'cross-college invitation refused' USING ERRCODE = '42501'; END IF;
    v_target_college := v_college;
  ELSE
    RAISE EXCEPTION 'role % may not invite' , v_role USING ERRCODE = '42501';
  END IF;

  IF v_target_college IS NULL OR NOT EXISTS (SELECT 1 FROM colleges WHERE id = v_target_college AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'college not found or not active' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE email = p_email) THEN RAISE EXCEPTION 'an account with this email already exists' USING ERRCODE = '23505'; END IF;

  UPDATE invitations SET revoked_at = now() WHERE email = p_email AND accepted_at IS NULL AND revoked_at IS NULL;
  INSERT INTO invitations (email, role, college_id, invited_by, token_hash, expires_at)
  VALUES (p_email, p_role, v_target_college, v_actor, p_token_hash, now() + make_interval(secs => p_ttl_seconds))
  RETURNING id INTO v_id;
  PERFORM auth.write_audit('COLLEGE', v_target_college, v_actor, v_role, 'INVITATION_CREATED', 'invitation', v_id::text,
                           jsonb_build_object('role', p_role), NULL);
  RETURN v_id;
END $$;

-- Accepting a STUDENT invitation also links the new account to its student record, in the same transaction.
CREATE OR REPLACE FUNCTION auth.accept_invitation(p_token_hash bytea, p_full_name text, p_password_hash text)
  RETURNS TABLE (user_id uuid, role text, college_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_inv invitations%ROWTYPE; v_uid uuid;
BEGIN
  SELECT i.* INTO v_inv FROM invitations i JOIN colleges c ON c.id = i.college_id
   WHERE i.token_hash = p_token_hash AND i.accepted_at IS NULL AND i.revoked_at IS NULL
     AND i.expires_at > now() AND c.status = 'ACTIVE'
   FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_or_expired' USING ERRCODE = 'P0001'; END IF;
  IF p_password_hash IS NULL OR p_password_hash NOT LIKE '$argon2id$%' THEN RAISE EXCEPTION 'invalid password hash' USING ERRCODE = '22023'; END IF;
  INSERT INTO users (college_id, email, full_name, password_hash, role)
  VALUES (v_inv.college_id, v_inv.email, p_full_name, p_password_hash, v_inv.role)
  RETURNING id INTO v_uid;
  IF v_inv.role = 'STUDENT' THEN
    UPDATE students s SET user_id = v_uid, updated_at = now()
     WHERE s.id = v_inv.student_id AND s.college_id = v_inv.college_id AND s.user_id IS NULL AND s.college_email = v_inv.email;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_or_expired' USING ERRCODE = 'P0001'; END IF;
  END IF;
  UPDATE invitations SET accepted_at = now(), accepted_user_id = v_uid WHERE id = v_inv.id;
  PERFORM auth.write_audit('COLLEGE', v_inv.college_id, v_uid, v_inv.role, 'INVITATION_ACCEPTED', 'invitation', v_inv.id::text, '{}'::jsonb, NULL);
  RETURN QUERY SELECT v_uid, v_inv.role, v_inv.college_id;
END $$;

RESET ROLE;
REVOKE CREATE ON SCHEMA students FROM cc_auth;
REVOKE CREATE ON SCHEMA auth FROM cc_auth;
