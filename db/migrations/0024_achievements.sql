-- 0024_achievements: certifications, hackathons, internships, projects, publications a student wants on their record.
-- Each entry is immutable once added. A coordinator currently assigned to the student's department verifies or rejects it (rejection needs a
-- reason); the student may withdraw one that is still awaiting review. Nothing here is ever read by eligibility. Unverified entries are
-- shown as such wherever they appear. Every change is audited and notifies the other side.

CREATE SCHEMA achievements;
REVOKE ALL ON SCHEMA achievements FROM PUBLIC;
GRANT USAGE ON SCHEMA achievements TO cc_app;
GRANT USAGE, CREATE ON SCHEMA achievements TO cc_auth;   -- CREATE revoked at the end

CREATE TABLE student_achievements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id       uuid NOT NULL,
  student_id       uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('CERTIFICATION', 'HACKATHON', 'INTERNSHIP', 'PROJECT', 'PUBLICATION', 'OTHER')),
  title            text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 150),
  achieved_on      date NOT NULL,
  description      text CHECK (description IS NULL OR length(description) <= 600),
  link             text CHECK (link IS NULL OR link ~ '^https?://[^[:space:]]{3,255}$'),
  status           text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'VERIFIED', 'REJECTED', 'WITHDRAWN')),
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  submitted_by     uuid NOT NULL REFERENCES users (id),
  reviewed_by      uuid REFERENCES users (id),
  reviewed_by_name text,
  reviewed_at      timestamptz,
  review_note      text CHECK (review_note IS NULL OR length(review_note) <= 500),
  rejection_reason text CHECK (rejection_reason IS NULL OR length(rejection_reason) <= 500),
  closed_at        timestamptz,
  UNIQUE (college_id, id),
  FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id),
  CONSTRAINT achievements_rejection_reason CHECK (status <> 'REJECTED' OR length(btrim(coalesce(rejection_reason, ''))) >= 5),
  CONSTRAINT achievements_reviewed CHECK ((status IN ('VERIFIED', 'REJECTED')) = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT achievements_closed CHECK ((status IN ('REJECTED', 'WITHDRAWN')) = (closed_at IS NOT NULL))
);
CREATE INDEX achievements_student_idx ON student_achievements (student_id, achieved_on DESC);
CREATE INDEX achievements_queue_idx ON student_achievements (college_id, status, submitted_at);

CREATE FUNCTION achievements.guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'achievements are retained' USING ERRCODE = '42501'; END IF;
  IF (NEW.college_id, NEW.student_id, NEW.kind, NEW.title, NEW.achieved_on, NEW.description, NEW.link, NEW.submitted_at, NEW.submitted_by)
     IS DISTINCT FROM (OLD.college_id, OLD.student_id, OLD.kind, OLD.title, OLD.achieved_on, OLD.description, OLD.link, OLD.submitted_at, OLD.submitted_by) THEN
    RAISE EXCEPTION 'submitted achievement details are immutable' USING ERRCODE = '42501';
  END IF;
  IF NOT ((OLD.status = 'SUBMITTED' AND NEW.status IN ('SUBMITTED', 'VERIFIED', 'REJECTED', 'WITHDRAWN')) OR (OLD.status = NEW.status AND OLD.status IN ('VERIFIED', 'REJECTED', 'WITHDRAWN'))) THEN
    RAISE EXCEPTION 'illegal achievement status transition % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'SUBMITTED' AND (NEW.reviewed_by, NEW.reviewed_at, NEW.review_note, NEW.rejection_reason, NEW.closed_at) IS DISTINCT FROM (OLD.reviewed_by, OLD.reviewed_at, OLD.review_note, OLD.rejection_reason, OLD.closed_at) THEN
    RAISE EXCEPTION 'a decided achievement cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER student_achievements_guard BEFORE UPDATE OR DELETE ON student_achievements FOR EACH ROW EXECUTE FUNCTION achievements.guard();

GRANT SELECT, INSERT, UPDATE ON student_achievements TO cc_auth;
GRANT SELECT ON student_achievements TO cc_app;                    -- read only; every write is an audited function
ALTER TABLE student_achievements ENABLE ROW LEVEL SECURITY; ALTER TABLE student_achievements FORCE ROW LEVEL SECURITY;
CREATE POLICY achievements_select ON student_achievements FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('COLLEGE_ADMIN', 'COORDINATOR', 'STUDENT')
         AND student_id IN (SELECT st.id FROM students st));

SET LOCAL ROLE cc_auth;

CREATE FUNCTION achievements.add(p_kind text, p_title text, p_date date, p_description text, p_link text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_s students%ROWTYPE; v_id uuid;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('CERTIFICATION', 'HACKATHON', 'INTERNSHIP', 'PROJECT', 'PUBLICATION', 'OTHER') THEN RAISE EXCEPTION 'Choose a type.' USING ERRCODE = '22023'; END IF;
  IF length(btrim(coalesce(p_title, ''))) NOT BETWEEN 3 AND 150 THEN RAISE EXCEPTION 'The title must be 3 to 150 characters.' USING ERRCODE = '22023'; END IF;
  IF p_date IS NULL OR p_date > current_date OR p_date < date '2000-01-01' THEN RAISE EXCEPTION 'Enter the date it happened (not in the future).' USING ERRCODE = '22023'; END IF;
  IF p_description IS NOT NULL AND length(p_description) > 600 THEN RAISE EXCEPTION 'Keep the description under 600 characters.' USING ERRCODE = '22023'; END IF;
  IF p_link IS NOT NULL AND btrim(p_link) <> '' AND btrim(p_link) !~ '^https?://[^[:space:]]{3,255}$' THEN RAISE EXCEPTION 'Enter a full link starting with http:// or https://.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_s FROM students WHERE user_id = v_user AND college_id = v_c FOR UPDATE;      -- serialises this student's additions
  IF NOT FOUND THEN RAISE EXCEPTION 'student record not found' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM student_achievements WHERE student_id = v_s.id AND status = 'SUBMITTED') >= 10 THEN
    RAISE EXCEPTION 'You already have 10 entries awaiting review. Wait for a decision or withdraw one.' USING ERRCODE = '23505';
  END IF;
  IF (SELECT count(*) FROM student_achievements WHERE student_id = v_s.id AND status IN ('SUBMITTED', 'VERIFIED')) >= 100 THEN
    RAISE EXCEPTION 'You have reached the limit of 100 achievements.' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM student_achievements WHERE student_id = v_s.id AND status IN ('SUBMITTED', 'VERIFIED') AND kind = p_kind AND achieved_on = p_date AND lower(btrim(title)) = lower(btrim(p_title))) THEN
    RAISE EXCEPTION 'You have already added this achievement.' USING ERRCODE = '23505';
  END IF;
  INSERT INTO student_achievements (college_id, student_id, kind, title, achieved_on, description, link, submitted_by)
  VALUES (v_c, v_s.id, p_kind, btrim(p_title), p_date, nullif(btrim(coalesce(p_description, '')), ''), nullif(btrim(coalesce(p_link, '')), ''), v_user) RETURNING id INTO v_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'STUDENT', 'ACHIEVEMENT_ADDED', 'achievement', v_id::text, jsonb_build_object('kind', p_kind), NULL);
  RETURN v_id;
END $$;

CREATE FUNCTION achievements.withdraw(p_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id();
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  UPDATE student_achievements a SET status = 'WITHDRAWN', closed_at = now()
   WHERE a.id = p_id AND a.college_id = v_c AND a.status = 'SUBMITTED' AND a.student_id = (SELECT st.id FROM students st WHERE st.user_id = v_user AND st.college_id = v_c);
  IF NOT FOUND THEN RAISE EXCEPTION 'No pending entry of yours was found.' USING ERRCODE = '22023'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'STUDENT', 'ACHIEVEMENT_WITHDRAWN', 'achievement', p_id::text, '{}'::jsonb, NULL);
END $$;

-- Internal: authorise the caller as a coordinator CURRENTLY assigned to the student's department, and lock the row.
CREATE FUNCTION achievements.lock_for_review(p_id uuid) RETURNS student_achievements
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_a student_achievements%ROWTYPE;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'COORDINATOR' THEN RAISE EXCEPTION 'only a department coordinator can review achievements' USING ERRCODE = '42501'; END IF;
  SELECT a.* INTO v_a FROM student_achievements a WHERE a.id = p_id AND a.college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'achievement not found' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM students st JOIN coordinator_assignments ca ON ca.department_id = st.department_id AND ca.college_id = st.college_id
                  WHERE st.id = v_a.student_id AND ca.user_id = v_user AND ca.ended_at IS NULL) THEN
    RAISE EXCEPTION 'not authorized for this student''s department' USING ERRCODE = '42501';
  END IF;
  IF v_a.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'This entry has already been decided or withdrawn.' USING ERRCODE = '22023'; END IF;
  RETURN v_a;
END $$;

CREATE FUNCTION achievements.verify(p_id uuid, p_note text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_name text;
BEGIN
  PERFORM achievements.lock_for_review(p_id);
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN RAISE EXCEPTION 'the note is too long' USING ERRCODE = '22023'; END IF;
  SELECT full_name INTO v_name FROM users WHERE id = v_user;
  UPDATE student_achievements SET status = 'VERIFIED', reviewed_by = v_user, reviewed_by_name = v_name, reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), '') WHERE id = p_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'COORDINATOR', 'ACHIEVEMENT_VERIFIED', 'achievement', p_id::text, '{}'::jsonb, NULL);
END $$;

CREATE FUNCTION achievements.reject(p_id uuid, p_reason text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_name text;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 OR length(p_reason) > 500 THEN RAISE EXCEPTION 'A rejection reason of 5-500 characters is required.' USING ERRCODE = '22023'; END IF;
  PERFORM achievements.lock_for_review(p_id);
  SELECT full_name INTO v_name FROM users WHERE id = v_user;
  UPDATE student_achievements SET status = 'REJECTED', reviewed_by = v_user, reviewed_by_name = v_name, reviewed_at = now(), rejection_reason = btrim(p_reason), closed_at = now() WHERE id = p_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'COORDINATOR', 'ACHIEVEMENT_REJECTED', 'achievement', p_id::text, '{}'::jsonb, NULL);
END $$;

-- Notifications: coordinators of the department when something is added; the student when it is decided.
CREATE FUNCTION achievements.notify() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE st students%ROWTYPE;
BEGIN
  SELECT * INTO st FROM students WHERE id = NEW.student_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM notifications.push_many(NEW.college_id, notifications.coordinators_of(NEW.college_id, st.department_id), 'TASKS', 'Achievement awaiting review: ' || st.full_name, left(NEW.title, 150), '/coordinator/achievements');
  ELSIF OLD.status = 'SUBMITTED' AND NEW.status = 'VERIFIED' THEN
    PERFORM notifications.push_many(NEW.college_id, ARRAY[st.user_id], 'ACADEMICS', 'An achievement was verified', left(NEW.title, 150), '/student/achievements');
  ELSIF OLD.status = 'SUBMITTED' AND NEW.status = 'REJECTED' THEN
    PERFORM notifications.push_many(NEW.college_id, ARRAY[st.user_id], 'ACADEMICS', 'An achievement was returned', 'Open Achievements to read the reason.', '/student/achievements');
  END IF;
  RETURN NULL;
END $$;

RESET ROLE;
CREATE TRIGGER achievements_notify AFTER INSERT OR UPDATE OF status ON student_achievements FOR EACH ROW EXECUTE FUNCTION achievements.notify();
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'achievements' AND p.proname <> 'guard' LOOP
    REVOKE ALL ON FUNCTION achievements.guard() FROM PUBLIC;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION achievements.add(text, text, date, text, text), achievements.withdraw(uuid), achievements.verify(uuid, text), achievements.reject(uuid, text) TO cc_app;
-- achievements.lock_for_review and achievements.notify are internal.
REVOKE CREATE ON SCHEMA achievements FROM cc_auth;
