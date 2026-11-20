-- 0025_profile_completion: a derived "how complete is this student's profile" score. Nothing is stored: the view recomputes it from the
-- records themselves, under the CALLER's row-level security (a coordinator only ever gets students of their departments). It is guidance
-- for students and a worklist for coordinators and is never read by eligibility.
-- The checklist and weights are fixed and mirrored in src/lib/completion.ts (a test keeps the two in step):
--   contact details (phone and personal email) 15 · verified academic record 40 · semester results on that record 10
--   · a mark sheet or certificate uploaded (not rejected) 10 · a career interest chosen 10 · a verified achievement 15   = 100

GRANT CREATE ON SCHEMA students TO cc_auth;      -- temporary; revoked at the end

SET LOCAL ROLE cc_auth;
-- Documents are private to the student and their coordinators, so a plain view could not tell the administrator whether one exists.
-- This returns only a yes/no, and only to someone who may see the student (the student, their coordinator, or the college's administrator).
CREATE FUNCTION students.has_supporting_document(p_student uuid) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_role text := app.current_role(); v_s students%ROWTYPE;
BEGIN
  IF v_u IS NULL OR v_c IS NULL OR v_role IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_s FROM students WHERE id = p_student AND college_id = v_c;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT (v_role = 'COLLEGE_ADMIN'
          OR (v_role = 'STUDENT' AND v_s.user_id = v_u)
          OR (v_role = 'COORDINATOR' AND EXISTS (SELECT 1 FROM coordinator_assignments ca WHERE ca.user_id = v_u AND ca.college_id = v_c AND ca.department_id = v_s.department_id AND ca.ended_at IS NULL))) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM documents d WHERE d.student_id = p_student AND d.college_id = v_c AND d.status = 'ACTIVE' AND d.kind IN ('MARKSHEET', 'CERTIFICATE') AND d.review_status <> 'REJECTED');
END $$;
RESET ROLE;
REVOKE ALL ON FUNCTION students.has_supporting_document(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION students.has_supporting_document(uuid) TO cc_app;

CREATE VIEW student_profile_completion WITH (security_invoker = true) AS
SELECT f.student_id, f.college_id, f.department_id, f.contact, f.academics, f.semesters, f.document, f.career, f.achievement,
       (CASE WHEN f.contact THEN 15 ELSE 0 END + CASE WHEN f.academics THEN 40 ELSE 0 END + CASE WHEN f.semesters THEN 10 ELSE 0 END
        + CASE WHEN f.document THEN 10 ELSE 0 END + CASE WHEN f.career THEN 10 ELSE 0 END + CASE WHEN f.achievement THEN 15 ELSE 0 END) AS score
  FROM (
    SELECT s.id AS student_id, s.college_id, s.department_id,
           (btrim(coalesce(s.phone::text, '')) <> '' AND btrim(coalesce(s.personal_email::text, '')) <> '') AS contact,
           EXISTS (SELECT 1 FROM academic_submissions a WHERE a.student_id = s.id AND a.status = 'VERIFIED') AS academics,
           EXISTS (SELECT 1 FROM academic_submissions a JOIN semester_results r ON r.submission_id = a.id WHERE a.student_id = s.id AND a.status = 'VERIFIED') AS semesters,
           students.has_supporting_document(s.id) AS document,
           s.career_preference <> 'UNDECIDED' AS career,
           EXISTS (SELECT 1 FROM student_achievements x WHERE x.student_id = s.id AND x.status = 'VERIFIED') AS achievement
      FROM students s
  ) f;
GRANT SELECT ON student_profile_completion TO cc_app;

REVOKE CREATE ON SCHEMA students FROM cc_auth;
