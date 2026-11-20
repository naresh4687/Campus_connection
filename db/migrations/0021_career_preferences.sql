-- 0021_career_preferences: what each student is currently aiming for (placement, higher studies, entrepreneurship, ...).
-- This is NOT a placement status and never feeds eligibility: a student interested in higher studies can still register for a
-- drive, and nobody is "placed" because they prefer placement. Only coordinators change it, only for students of departments
-- they are currently assigned to, always with a reason, always leaving a history row. Colleges may rename or hide a category
-- (the six codes are fixed so circulars and reports can rely on them); students keep a hidden category until a coordinator moves them.

GRANT CREATE ON SCHEMA students, college TO cc_auth;      -- temporary; revoked at the end

ALTER TABLE students ADD COLUMN career_preference text NOT NULL DEFAULT 'UNDECIDED'
  CHECK (career_preference IN ('PLACEMENT', 'HIGHER_STUDIES', 'ENTREPRENEURSHIP', 'OTHER', 'UNDECIDED', 'NOT_SEEKING_PLACEMENT'));
CREATE INDEX students_career_idx ON students (college_id, career_preference);

-- Per-college label / visibility overrides. A missing row means the built-in label, visible.
CREATE TABLE career_category_settings (
  college_id uuid NOT NULL REFERENCES colleges (id),
  code       text NOT NULL CHECK (code IN ('PLACEMENT', 'HIGHER_STUDIES', 'ENTREPRENEURSHIP', 'OTHER', 'UNDECIDED', 'NOT_SEEKING_PLACEMENT')),
  label      text NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 60),
  active     boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (college_id, code)
);

CREATE TABLE career_preference_history (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  college_id     uuid NOT NULL,
  student_id     uuid NOT NULL,
  previous       text NOT NULL,
  new_preference text NOT NULL,
  reason         text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 300),
  changed_by     uuid NOT NULL REFERENCES users (id),
  changed_by_role text NOT NULL,
  changed_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (previous <> new_preference),
  FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id)
);
CREATE INDEX career_history_student_idx ON career_preference_history (college_id, student_id, changed_at DESC);
CREATE TRIGGER career_history_no_change BEFORE UPDATE OR DELETE ON career_preference_history FOR EACH ROW EXECUTE FUNCTION eligibility.append_only();

GRANT SELECT, INSERT ON career_preference_history TO cc_auth;
GRANT SELECT, INSERT, UPDATE ON career_category_settings TO cc_auth;
GRANT SELECT ON career_preference_history, career_category_settings TO cc_app;

ALTER TABLE career_preference_history ENABLE ROW LEVEL SECURITY; ALTER TABLE career_preference_history FORCE ROW LEVEL SECURITY;
ALTER TABLE career_category_settings  ENABLE ROW LEVEL SECURITY; ALTER TABLE career_category_settings  FORCE ROW LEVEL SECURITY;

-- History is visible to whoever can see the student: admin (their college), coordinator (assigned departments), the student themself.
CREATE POLICY career_history_select ON career_preference_history FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND EXISTS (SELECT 1 FROM students s WHERE s.id = student_id AND s.college_id = career_preference_history.college_id));
CREATE POLICY career_settings_select ON career_category_settings FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()));

SET LOCAL ROLE cc_auth;

-- The six categories as this college shows them (label overrides applied), in display order.
CREATE FUNCTION students.career_categories() RETURNS TABLE (code text, label text, active boolean, sort int)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT d.code, coalesce(s.label, d.label), coalesce(s.active, true), d.sort
    FROM (VALUES ('PLACEMENT', 'Placement interested', 1), ('HIGHER_STUDIES', 'Higher studies interested', 2),
                 ('ENTREPRENEURSHIP', 'Entrepreneurship interested', 3), ('OTHER', 'Other career path', 4),
                 ('UNDECIDED', 'Undecided', 5), ('NOT_SEEKING_PLACEMENT', 'Not currently seeking placement', 6)) AS d (code, label, sort)
    LEFT JOIN career_category_settings s ON s.code = d.code AND s.college_id = app.current_college_id()
   WHERE app.current_user_id() IS NOT NULL AND app.current_college_id() IS NOT NULL
   ORDER BY d.sort
$$;

-- College administrator renames or hides a category (never deletes: students may still hold it).
CREATE FUNCTION college.set_career_category(p_code text, p_label text, p_active boolean) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  IF p_code NOT IN ('PLACEMENT', 'HIGHER_STUDIES', 'ENTREPRENEURSHIP', 'OTHER', 'UNDECIDED', 'NOT_SEEKING_PLACEMENT') THEN RAISE EXCEPTION 'unknown category' USING ERRCODE = '22023'; END IF;
  IF length(btrim(coalesce(p_label, ''))) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'The label must be 2 to 60 characters.' USING ERRCODE = '22023'; END IF;
  IF p_code = 'UNDECIDED' AND NOT p_active THEN RAISE EXCEPTION 'The "Undecided" category cannot be hidden: it is where new students start.' USING ERRCODE = '22023'; END IF;
  INSERT INTO career_category_settings (college_id, code, label, active, updated_by) VALUES (v_c, p_code, btrim(p_label), p_active, v_u)
    ON CONFLICT (college_id, code) DO UPDATE SET label = EXCLUDED.label, active = EXCLUDED.active, updated_by = v_u, updated_at = now();
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'CAREER_CATEGORY_UPDATED', 'career_category', p_code,
                           jsonb_build_object('active', p_active), NULL);
END $$;

-- Coordinator moves one or more students to a category. All-or-nothing: if any student is outside the coordinator's current
-- departments, nothing changes. Students already in the category are skipped. Returns how many changed.
CREATE FUNCTION students.set_career_preference(p_students uuid[], p_preference text, p_reason text) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_n int := 0; v_ids uuid[] := '{}'; r record;
BEGIN
  IF v_u IS NULL OR app.current_role() IS DISTINCT FROM 'COORDINATOR' THEN RAISE EXCEPTION 'only a department coordinator can change career preferences' USING ERRCODE = '42501'; END IF;
  IF p_students IS NULL OR cardinality(p_students) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Choose between 1 and 200 students.' USING ERRCODE = '22023'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'Give a reason (3 to 300 characters).' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM students.career_categories() c WHERE c.code = p_preference AND c.active) THEN
    RAISE EXCEPTION 'That category is not available.' USING ERRCODE = '22023';
  END IF;
  FOR r IN
    SELECT s.id, s.career_preference, s.department_id FROM students s WHERE s.id = ANY (p_students) AND s.college_id = v_c ORDER BY s.id FOR UPDATE
  LOOP
    IF NOT EXISTS (SELECT 1 FROM coordinator_assignments a WHERE a.user_id = v_u AND a.college_id = v_c AND a.department_id = r.department_id AND a.ended_at IS NULL) THEN
      RAISE EXCEPTION 'not authorized for every selected student''s department' USING ERRCODE = '42501';
    END IF;
    v_ids := v_ids || r.id;
    IF r.career_preference <> p_preference THEN
      INSERT INTO career_preference_history (college_id, student_id, previous, new_preference, reason, changed_by, changed_by_role)
        VALUES (v_c, r.id, r.career_preference, p_preference, btrim(p_reason), v_u, 'COORDINATOR');
      UPDATE students SET career_preference = p_preference, updated_at = now() WHERE id = r.id;
      v_n := v_n + 1;
    END IF;
  END LOOP;
  IF cardinality(v_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_students) x) THEN RAISE EXCEPTION 'student not found' USING ERRCODE = '22023'; END IF;
  IF v_n > 0 THEN
    PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COORDINATOR', 'CAREER_PREFERENCE_CHANGED', 'student', NULL,
                             jsonb_build_object('preference', p_preference, 'students', v_n), NULL);
  END IF;
  RETURN v_n;
END $$;

RESET ROLE;
REVOKE ALL ON FUNCTION students.career_categories(), college.set_career_category(text, text, boolean), students.set_career_preference(uuid[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION students.career_categories(), college.set_career_category(text, text, boolean), students.set_career_preference(uuid[], text, text) TO cc_app;
REVOKE CREATE ON SCHEMA students, college FROM cc_auth;
