-- 0006_academics: academic submissions (append-only, versioned), the verification workflow, and a derived per-student status view.
-- A submission's values are IMMUTABLE. Changing verified data means a NEW submission that must be reviewed; the previously
-- verified submission stays in force until the new one is verified (then it becomes SUPERSEDED).

CREATE SCHEMA academics;
REVOKE ALL ON SCHEMA academics FROM PUBLIC;
GRANT USAGE ON SCHEMA academics TO cc_app;
GRANT USAGE, CREATE ON SCHEMA academics TO cc_auth;   -- CREATE revoked at the end

CREATE TABLE academic_submissions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id         uuid NOT NULL,
  student_id         uuid NOT NULL,
  version            int  NOT NULL CHECK (version >= 1),
  -- the submitted values (NULL means "not provided", never zero)
  cgpa               numeric(4,2) NOT NULL CHECK (cgpa BETWEEN 0 AND 10),
  tenth_percentage   numeric(5,2) NOT NULL CHECK (tenth_percentage BETWEEN 0 AND 100),
  twelfth_percentage numeric(5,2) CHECK (twelfth_percentage IS NULL OR twelfth_percentage BETWEEN 0 AND 100),
  diploma_percentage numeric(5,2) CHECK (diploma_percentage IS NULL OR diploma_percentage BETWEEN 0 AND 100),
  active_backlogs    int  NOT NULL CHECK (active_backlogs BETWEEN 0 AND 50),
  historical_arrears int  NOT NULL CHECK (historical_arrears BETWEEN 0 AND 200),
  student_note       text CHECK (student_note IS NULL OR length(student_note) <= 500),
  -- snapshot of the college-controlled identity at submission time (what the record was verified against)
  degree             text NOT NULL,
  department_id      uuid NOT NULL,
  passing_year       int  NOT NULL,
  status             text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'VERIFIED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN')),
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  submitted_by       uuid NOT NULL REFERENCES users (id),
  reviewed_by        uuid REFERENCES users (id),
  reviewed_by_name   text,
  reviewed_at        timestamptz,
  review_note        text CHECK (review_note IS NULL OR length(review_note) <= 500),
  rejection_reason   text CHECK (rejection_reason IS NULL OR length(rejection_reason) <= 500),
  closed_at          timestamptz,
  UNIQUE (college_id, id),
  UNIQUE (student_id, version),
  FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id),
  FOREIGN KEY (college_id, department_id) REFERENCES departments (college_id, id),
  CONSTRAINT academics_one_route CHECK (twelfth_percentage IS NOT NULL OR diploma_percentage IS NOT NULL),
  CONSTRAINT academics_rejection_reason CHECK (status <> 'REJECTED' OR length(btrim(coalesce(rejection_reason, ''))) >= 5),
  CONSTRAINT academics_reviewed CHECK ((status IN ('VERIFIED', 'REJECTED', 'SUPERSEDED')) = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT academics_closed CHECK ((status IN ('REJECTED', 'SUPERSEDED', 'WITHDRAWN')) = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX academics_one_open     ON academic_submissions (student_id) WHERE status = 'SUBMITTED';
CREATE UNIQUE INDEX academics_one_verified ON academic_submissions (student_id) WHERE status = 'VERIFIED';
CREATE INDEX academics_college_status_idx ON academic_submissions (college_id, status, submitted_at);
CREATE INDEX academics_student_idx ON academic_submissions (student_id, version DESC);

-- Values and snapshot never change; only the review outcome does, along allowed transitions; rows are never deleted.
CREATE FUNCTION academics.submission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'academic submissions are retained' USING ERRCODE = '42501'; END IF;
  IF (NEW.college_id, NEW.student_id, NEW.version, NEW.cgpa, NEW.tenth_percentage, NEW.twelfth_percentage, NEW.diploma_percentage, NEW.active_backlogs,
      NEW.historical_arrears, NEW.student_note, NEW.degree, NEW.department_id, NEW.passing_year, NEW.submitted_at, NEW.submitted_by)
     IS DISTINCT FROM
     (OLD.college_id, OLD.student_id, OLD.version, OLD.cgpa, OLD.tenth_percentage, OLD.twelfth_percentage, OLD.diploma_percentage, OLD.active_backlogs,
      OLD.historical_arrears, OLD.student_note, OLD.degree, OLD.department_id, OLD.passing_year, OLD.submitted_at, OLD.submitted_by) THEN
    RAISE EXCEPTION 'submitted academic values are immutable' USING ERRCODE = '42501';
  END IF;
  IF NOT ((OLD.status = 'SUBMITTED' AND NEW.status IN ('SUBMITTED', 'VERIFIED', 'REJECTED', 'WITHDRAWN'))
       OR (OLD.status = 'VERIFIED' AND NEW.status IN ('VERIFIED', 'SUPERSEDED'))
       OR (OLD.status = NEW.status AND OLD.status IN ('REJECTED', 'SUPERSEDED', 'WITHDRAWN'))) THEN
    RAISE EXCEPTION 'illegal academic status transition % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('REJECTED', 'SUPERSEDED', 'WITHDRAWN') AND
     (NEW.reviewed_by, NEW.reviewed_at, NEW.review_note, NEW.rejection_reason, NEW.closed_at) IS DISTINCT FROM (OLD.reviewed_by, OLD.reviewed_at, OLD.review_note, OLD.rejection_reason, OLD.closed_at) THEN
    RAISE EXCEPTION 'a closed submission cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER academic_submissions_guard BEFORE UPDATE OR DELETE ON academic_submissions FOR EACH ROW EXECUTE FUNCTION academics.submission_guard();

GRANT SELECT, INSERT, UPDATE ON academic_submissions TO cc_auth;
GRANT SELECT ON academic_submissions TO cc_app;                    -- read only; every write is an audited function
ALTER TABLE academic_submissions ENABLE ROW LEVEL SECURITY; ALTER TABLE academic_submissions FORCE ROW LEVEL SECURITY;

-- Visibility reuses the students policies: whoever can see a student (admin: all; coordinator: assigned departments; student: self)
-- can see that student's submissions. Placement officers and the platform see none.
CREATE POLICY academics_select ON academic_submissions FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('COLLEGE_ADMIN', 'COORDINATOR', 'STUDENT')
         AND student_id IN (SELECT st.id FROM students st));

-- Derived per-student status. security_invoker => the CALLER's row-level security applies to the underlying tables.
CREATE VIEW student_academic_status WITH (security_invoker = true) AS
SELECT s.id AS student_id, s.college_id, s.department_id,
       CASE WHEN EXISTS (SELECT 1 FROM academic_submissions a WHERE a.student_id = s.id AND a.status = 'VERIFIED') THEN 'VERIFIED'
            WHEN EXISTS (SELECT 1 FROM academic_submissions a WHERE a.student_id = s.id AND a.status = 'SUBMITTED') THEN 'PENDING'
            WHEN EXISTS (SELECT 1 FROM academic_submissions a WHERE a.student_id = s.id AND a.status = 'REJECTED') THEN 'REJECTED'
            ELSE 'NOT_SUBMITTED' END AS status,
       EXISTS (SELECT 1 FROM academic_submissions a WHERE a.student_id = s.id AND a.status = 'VERIFIED')
         AND EXISTS (SELECT 1 FROM academic_submissions a WHERE a.student_id = s.id AND a.status = 'SUBMITTED') AS update_pending
  FROM students s;
GRANT SELECT ON student_academic_status TO cc_app;

-- ───────────── functions ─────────────
CREATE FUNCTION academics.check_values(p_cgpa numeric, p_tenth numeric, p_twelfth numeric, p_diploma numeric, p_backlogs int, p_arrears int, p_note text) RETURNS void
  LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_cgpa IS NULL OR p_tenth IS NULL OR p_backlogs IS NULL OR p_arrears IS NULL THEN RAISE EXCEPTION 'CGPA, 10th percentage, active backlogs and historical arrears are required' USING ERRCODE = '22023'; END IF;
  IF p_twelfth IS NULL AND p_diploma IS NULL THEN RAISE EXCEPTION 'Provide either the 12th percentage or the diploma percentage' USING ERRCODE = '22023'; END IF;
  IF p_cgpa <> round(p_cgpa, 2) OR p_tenth <> round(p_tenth, 2) OR p_twelfth <> round(p_twelfth, 2) OR p_diploma <> round(p_diploma, 2) THEN
    RAISE EXCEPTION 'use at most two decimal places' USING ERRCODE = '22023';
  END IF;
  IF p_cgpa NOT BETWEEN 0 AND 10 OR p_tenth NOT BETWEEN 0 AND 100 OR p_twelfth NOT BETWEEN 0 AND 100 OR p_diploma NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'CGPA must be 0-10 and percentages 0-100' USING ERRCODE = '22023';
  END IF;
  IF p_backlogs NOT BETWEEN 0 AND 50 OR p_arrears NOT BETWEEN 0 AND 200 THEN RAISE EXCEPTION 'backlogs must be 0-50 and arrears 0-200' USING ERRCODE = '22023'; END IF;
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN RAISE EXCEPTION 'the note is too long' USING ERRCODE = '22023'; END IF;
END $$;

CREATE FUNCTION academics.submit(p_cgpa numeric, p_tenth numeric, p_twelfth numeric, p_diploma numeric, p_backlogs int, p_arrears int, p_note text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_s students%ROWTYPE; v_ver int; v_id uuid; v_cur academic_submissions%ROWTYPE;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  PERFORM academics.check_values(p_cgpa, p_tenth, p_twelfth, p_diploma, p_backlogs, p_arrears, p_note);
  SELECT * INTO v_s FROM students WHERE user_id = v_user AND college_id = v_c FOR UPDATE;      -- serialises this student's submissions
  IF NOT FOUND THEN RAISE EXCEPTION 'student record not found' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM academic_submissions WHERE student_id = v_s.id AND status = 'SUBMITTED') THEN
    RAISE EXCEPTION 'You already have a submission awaiting review. Withdraw it to submit a different one.' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_cur FROM academic_submissions WHERE student_id = v_s.id AND status = 'VERIFIED';
  IF FOUND AND (v_cur.cgpa, v_cur.tenth_percentage, v_cur.twelfth_percentage, v_cur.diploma_percentage, v_cur.active_backlogs, v_cur.historical_arrears)
               IS NOT DISTINCT FROM (p_cgpa, p_tenth, p_twelfth, p_diploma, p_backlogs, p_arrears) THEN
    RAISE EXCEPTION 'These values are identical to your verified record; there is nothing to update.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_ver FROM academic_submissions WHERE student_id = v_s.id;
  INSERT INTO academic_submissions (college_id, student_id, version, cgpa, tenth_percentage, twelfth_percentage, diploma_percentage, active_backlogs, historical_arrears, student_note,
                                    degree, department_id, passing_year, submitted_by)
  VALUES (v_c, v_s.id, v_ver, p_cgpa, p_tenth, p_twelfth, p_diploma, p_backlogs, p_arrears, nullif(btrim(coalesce(p_note, '')), ''), v_s.degree, v_s.department_id, v_s.passing_year, v_user)
  RETURNING id INTO v_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'STUDENT', 'ACADEMICS_SUBMITTED', 'academic_submission', v_id::text, jsonb_build_object('version', v_ver), NULL);
  RETURN v_id;
END $$;

CREATE FUNCTION academics.withdraw(p_submission uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id();
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  UPDATE academic_submissions a SET status = 'WITHDRAWN', closed_at = now()
   WHERE a.id = p_submission AND a.college_id = v_c AND a.status = 'SUBMITTED'
     AND a.student_id = (SELECT st.id FROM students st WHERE st.user_id = v_user AND st.college_id = v_c);
  IF NOT FOUND THEN RAISE EXCEPTION 'No pending submission of yours was found.' USING ERRCODE = '22023'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'STUDENT', 'ACADEMICS_WITHDRAWN', 'academic_submission', p_submission::text, '{}'::jsonb, NULL);
END $$;

-- Internal: authorise the caller as a coordinator CURRENTLY assigned to the submission's student's department, and lock the row.
CREATE FUNCTION academics.lock_for_review(p_submission uuid) RETURNS academic_submissions
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_a academic_submissions%ROWTYPE;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'COORDINATOR' THEN RAISE EXCEPTION 'only a department coordinator can review academic records' USING ERRCODE = '42501'; END IF;
  SELECT a.* INTO v_a FROM academic_submissions a WHERE a.id = p_submission AND a.college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'submission not found' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM students st JOIN coordinator_assignments ca ON ca.department_id = st.department_id AND ca.college_id = st.college_id
                  WHERE st.id = v_a.student_id AND ca.user_id = v_user AND ca.ended_at IS NULL) THEN
    RAISE EXCEPTION 'not authorized for this student''s department' USING ERRCODE = '42501';
  END IF;
  IF v_a.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'This submission has already been decided or withdrawn.' USING ERRCODE = '22023'; END IF;
  RETURN v_a;
END $$;

CREATE FUNCTION academics.verify(p_submission uuid, p_note text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_a academic_submissions%ROWTYPE; v_name text;
BEGIN
  v_a := academics.lock_for_review(p_submission);
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN RAISE EXCEPTION 'the note is too long' USING ERRCODE = '22023'; END IF;
  SELECT full_name INTO v_name FROM users WHERE id = v_user;
  UPDATE academic_submissions SET status = 'SUPERSEDED', reviewed_by = reviewed_by, closed_at = now() WHERE student_id = v_a.student_id AND status = 'VERIFIED';
  UPDATE academic_submissions SET status = 'VERIFIED', reviewed_by = v_user, reviewed_by_name = v_name, reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), '') WHERE id = p_submission;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'COORDINATOR', 'ACADEMICS_VERIFIED', 'academic_submission', p_submission::text, jsonb_build_object('version', v_a.version), NULL);
END $$;

CREATE FUNCTION academics.reject(p_submission uuid, p_reason text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_a academic_submissions%ROWTYPE; v_name text;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 OR length(p_reason) > 500 THEN RAISE EXCEPTION 'A rejection reason of 5-500 characters is required.' USING ERRCODE = '22023'; END IF;
  v_a := academics.lock_for_review(p_submission);
  SELECT full_name INTO v_name FROM users WHERE id = v_user;
  UPDATE academic_submissions SET status = 'REJECTED', reviewed_by = v_user, reviewed_by_name = v_name, reviewed_at = now(), rejection_reason = btrim(p_reason), closed_at = now() WHERE id = p_submission;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'COORDINATOR', 'ACADEMICS_REJECTED', 'academic_submission', p_submission::text, jsonb_build_object('version', v_a.version), NULL);
END $$;

-- ───────────── ownership + execute privileges ─────────────
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'academics' AND p.proname <> 'submission_guard' LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION academics.submit(numeric, numeric, numeric, numeric, int, int, text), academics.withdraw(uuid),
                          academics.verify(uuid, text), academics.reject(uuid, text) TO cc_app;
-- academics.check_values and academics.lock_for_review are internal.
REVOKE CREATE ON SCHEMA academics FROM cc_auth;
