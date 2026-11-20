-- 0023_semester_results: optional semester-wise results (SGPA and backlogs per semester) that travel WITH an academic submission.
-- They are part of the submission's immutable values: written in the same call as the submission, verified or rejected together with it,
-- never edited. Changing a semester means a new submission (the verified one stays in force until then). They are optional, are never
-- read by eligibility, and the stated CGPA is never computed from them (the app only warns when the two disagree noticeably).

GRANT CREATE ON SCHEMA academics TO cc_auth;      -- temporary; revoked at the end

CREATE TABLE semester_results (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id    uuid NOT NULL,
  student_id    uuid NOT NULL,
  submission_id uuid NOT NULL,
  semester      int  NOT NULL CHECK (semester BETWEEN 1 AND 12),
  sgpa          numeric(4,2) NOT NULL CHECK (sgpa BETWEEN 0 AND 10),
  backlogs      int  NOT NULL CHECK (backlogs BETWEEN 0 AND 20),
  UNIQUE (submission_id, semester),
  FOREIGN KEY (college_id, submission_id) REFERENCES academic_submissions (college_id, id),
  FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id)
);
CREATE INDEX semester_results_student_idx ON semester_results (student_id);
CREATE TRIGGER semester_results_no_change BEFORE UPDATE OR DELETE ON semester_results FOR EACH ROW EXECUTE FUNCTION eligibility.append_only();

GRANT SELECT, INSERT ON semester_results TO cc_auth;
GRANT SELECT ON semester_results TO cc_app;
ALTER TABLE semester_results ENABLE ROW LEVEL SECURITY; ALTER TABLE semester_results FORCE ROW LEVEL SECURITY;
-- Same visibility as the submission's student: admin (college), coordinator (assigned departments), the student themself.
CREATE POLICY semester_results_select ON semester_results FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('COLLEGE_ADMIN', 'COORDINATOR', 'STUDENT')
         AND student_id IN (SELECT st.id FROM students st));

SET LOCAL ROLE cc_auth;

-- Validate and normalise the semesters array: [{"semester":1,"sgpa":8.5,"backlogs":0}, ...] -> rows. Internal.
CREATE FUNCTION academics.parse_semesters(p_semesters jsonb) RETURNS TABLE (semester int, sgpa numeric, backlogs int)
  LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_semesters IS NULL OR p_semesters = 'null'::jsonb OR p_semesters = '[]'::jsonb THEN RETURN; END IF;
  IF jsonb_typeof(p_semesters) <> 'array' OR jsonb_array_length(p_semesters) > 12 THEN RAISE EXCEPTION 'Semester results must be a list of at most 12 semesters.' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
    SELECT (e->>'semester')::int, (e->>'sgpa')::numeric, (e->>'backlogs')::int FROM jsonb_array_elements(p_semesters) e ORDER BY 1;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Semester results contain a value that is not a number.' USING ERRCODE = '22023';
END $$;

DROP FUNCTION academics.submit(numeric, numeric, numeric, numeric, int, int, text, uuid[]);
CREATE FUNCTION academics.submit(p_cgpa numeric, p_tenth numeric, p_twelfth numeric, p_diploma numeric, p_backlogs int, p_arrears int, p_note text,
                                 p_document_ids uuid[] DEFAULT '{}', p_semesters jsonb DEFAULT NULL) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_s students%ROWTYPE; v_ver int; v_id uuid; v_cur academic_submissions%ROWTYPE;
        v_docs uuid[] := coalesce(p_document_ids, '{}'); v_new_sem jsonb; v_cur_sem jsonb;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  PERFORM academics.check_values(p_cgpa, p_tenth, p_twelfth, p_diploma, p_backlogs, p_arrears, p_note);
  IF coalesce(array_length(v_docs, 1), 0) > 10 THEN RAISE EXCEPTION 'Attach at most 10 documents.' USING ERRCODE = '22023'; END IF;
  -- semesters: each 1-12 once, SGPA 0-10 with at most two decimals, backlogs 0-20
  IF EXISTS (SELECT 1 FROM academics.parse_semesters(p_semesters) x WHERE x.semester IS NULL OR x.sgpa IS NULL OR x.backlogs IS NULL OR x.semester NOT BETWEEN 1 AND 12
                OR x.sgpa NOT BETWEEN 0 AND 10 OR x.sgpa <> round(x.sgpa, 2) OR x.backlogs NOT BETWEEN 0 AND 20)
     OR (SELECT count(DISTINCT x.semester) FROM academics.parse_semesters(p_semesters) x) <> (SELECT count(*) FROM academics.parse_semesters(p_semesters)) THEN
    RAISE EXCEPTION 'Each semester needs a number 1-12 (once), an SGPA of 0-10 with at most two decimals, and backlogs of 0-20.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_s FROM students WHERE user_id = v_user AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student record not found' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM academic_submissions WHERE student_id = v_s.id AND status = 'SUBMITTED') THEN
    RAISE EXCEPTION 'You already have a submission awaiting review. Withdraw it to submit a different one.' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_cur FROM academic_submissions WHERE student_id = v_s.id AND status = 'VERIFIED';
  IF FOUND THEN
    SELECT coalesce(jsonb_agg(jsonb_build_array(x.semester, x.sgpa, x.backlogs) ORDER BY x.semester), '[]'::jsonb) INTO v_new_sem FROM academics.parse_semesters(p_semesters) x;
    SELECT coalesce(jsonb_agg(jsonb_build_array(r.semester, r.sgpa, r.backlogs) ORDER BY r.semester), '[]'::jsonb) INTO v_cur_sem FROM semester_results r WHERE r.submission_id = v_cur.id;
    IF (v_cur.cgpa, v_cur.tenth_percentage, v_cur.twelfth_percentage, v_cur.diploma_percentage, v_cur.active_backlogs, v_cur.historical_arrears)
         IS NOT DISTINCT FROM (p_cgpa, p_tenth, p_twelfth, p_diploma, p_backlogs, p_arrears) AND v_new_sem = v_cur_sem THEN
      RAISE EXCEPTION 'These values are identical to your verified record; there is nothing to update.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(v_docs) AS x) <> coalesce(array_length(v_docs, 1), 0)
     OR (SELECT count(*) FROM documents d WHERE d.id = ANY (v_docs) AND d.student_id = v_s.id AND d.college_id = v_c AND d.status = 'ACTIVE' AND d.kind IN ('MARKSHEET', 'CERTIFICATE')) <> coalesce(array_length(v_docs, 1), 0) THEN
    RAISE EXCEPTION 'Evidence must be your own uploaded mark sheets or certificates that have not been deleted.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_ver FROM academic_submissions WHERE student_id = v_s.id;
  INSERT INTO academic_submissions (college_id, student_id, version, cgpa, tenth_percentage, twelfth_percentage, diploma_percentage, active_backlogs, historical_arrears, student_note,
                                    degree, department_id, passing_year, submitted_by)
  VALUES (v_c, v_s.id, v_ver, p_cgpa, p_tenth, p_twelfth, p_diploma, p_backlogs, p_arrears, nullif(btrim(coalesce(p_note, '')), ''), v_s.degree, v_s.department_id, v_s.passing_year, v_user)
  RETURNING id INTO v_id;
  INSERT INTO academic_submission_documents (college_id, student_id, submission_id, document_id) SELECT v_c, v_s.id, v_id, x FROM unnest(v_docs) AS x;
  INSERT INTO semester_results (college_id, student_id, submission_id, semester, sgpa, backlogs) SELECT v_c, v_s.id, v_id, x.semester, x.sgpa, x.backlogs FROM academics.parse_semesters(p_semesters) x;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'STUDENT', 'ACADEMICS_SUBMITTED', 'academic_submission', v_id::text,
                           jsonb_build_object('version', v_ver, 'evidence', coalesce(array_length(v_docs, 1), 0), 'semesters', (SELECT count(*) FROM academics.parse_semesters(p_semesters))), NULL);
  RETURN v_id;
END $$;

RESET ROLE;
REVOKE ALL ON FUNCTION academics.submit(numeric, numeric, numeric, numeric, int, int, text, uuid[], jsonb), academics.parse_semesters(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION academics.submit(numeric, numeric, numeric, numeric, int, int, text, uuid[], jsonb) TO cc_app;     -- parse_semesters is internal
REVOKE CREATE ON SCHEMA academics FROM cc_auth;
