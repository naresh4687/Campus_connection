-- 0026_achievement_revisions: editing a VERIFIED achievement. The student submits a REVISION (a new entry that points at the verified one).
-- The verified entry stays in force, unchanged, while the revision awaits review. Verifying the revision supersedes the original;
-- rejecting or withdrawing it leaves the original exactly as it was (same rule as academic records, TD-25). Entries themselves stay immutable.

GRANT CREATE ON SCHEMA achievements TO cc_auth;      -- temporary; revoked at the end

ALTER TABLE student_achievements ADD COLUMN replaces_id uuid;
ALTER TABLE student_achievements ADD CONSTRAINT achievements_replaces_fk FOREIGN KEY (college_id, replaces_id) REFERENCES student_achievements (college_id, id);
ALTER TABLE student_achievements ADD CONSTRAINT achievements_replaces_not_self CHECK (replaces_id IS NULL OR replaces_id <> id);
CREATE UNIQUE INDEX achievements_one_open_revision ON student_achievements (replaces_id) WHERE status = 'SUBMITTED' AND replaces_id IS NOT NULL;

ALTER TABLE student_achievements DROP CONSTRAINT student_achievements_status_check;
ALTER TABLE student_achievements ADD CONSTRAINT student_achievements_status_check CHECK (status IN ('SUBMITTED', 'VERIFIED', 'REJECTED', 'WITHDRAWN', 'SUPERSEDED'));
ALTER TABLE student_achievements DROP CONSTRAINT achievements_reviewed;
ALTER TABLE student_achievements ADD CONSTRAINT achievements_reviewed CHECK ((status IN ('VERIFIED', 'REJECTED', 'SUPERSEDED')) = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL));
ALTER TABLE student_achievements DROP CONSTRAINT achievements_closed;
ALTER TABLE student_achievements ADD CONSTRAINT achievements_closed CHECK ((status IN ('REJECTED', 'WITHDRAWN', 'SUPERSEDED')) = (closed_at IS NOT NULL));

CREATE OR REPLACE FUNCTION achievements.guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'achievements are retained' USING ERRCODE = '42501'; END IF;
  IF (NEW.college_id, NEW.student_id, NEW.kind, NEW.title, NEW.achieved_on, NEW.description, NEW.link, NEW.replaces_id, NEW.submitted_at, NEW.submitted_by)
     IS DISTINCT FROM (OLD.college_id, OLD.student_id, OLD.kind, OLD.title, OLD.achieved_on, OLD.description, OLD.link, OLD.replaces_id, OLD.submitted_at, OLD.submitted_by) THEN
    RAISE EXCEPTION 'submitted achievement details are immutable' USING ERRCODE = '42501';
  END IF;
  IF NOT ((OLD.status = 'SUBMITTED' AND NEW.status IN ('SUBMITTED', 'VERIFIED', 'REJECTED', 'WITHDRAWN'))
       OR (OLD.status = 'VERIFIED' AND NEW.status IN ('VERIFIED', 'SUPERSEDED'))
       OR (OLD.status = NEW.status AND OLD.status IN ('REJECTED', 'WITHDRAWN', 'SUPERSEDED'))) THEN
    RAISE EXCEPTION 'illegal achievement status transition % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;
  -- a decided entry's review facts never change; the one allowed edit is closing a verified entry that a newer one replaced
  IF OLD.status <> 'SUBMITTED' AND (NEW.reviewed_by, NEW.reviewed_at, NEW.review_note, NEW.rejection_reason) IS DISTINCT FROM (OLD.reviewed_by, OLD.reviewed_at, OLD.review_note, OLD.rejection_reason) THEN
    RAISE EXCEPTION 'a decided achievement cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'SUBMITTED' AND NEW.closed_at IS DISTINCT FROM OLD.closed_at AND NOT (OLD.status = 'VERIFIED' AND NEW.status = 'SUPERSEDED') THEN
    RAISE EXCEPTION 'a decided achievement cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

SET LOCAL ROLE cc_auth;

-- A student proposes a change to one of their own VERIFIED achievements. At least one detail must differ.
CREATE FUNCTION achievements.revise(p_id uuid, p_kind text, p_title text, p_date date, p_description text, p_link text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_s students%ROWTYPE; v_o student_achievements%ROWTYPE; v_id uuid;
        v_desc text := nullif(btrim(coalesce(p_description, '')), ''); v_link text := nullif(btrim(coalesce(p_link, '')), '');
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('CERTIFICATION', 'HACKATHON', 'INTERNSHIP', 'PROJECT', 'PUBLICATION', 'OTHER') THEN RAISE EXCEPTION 'Choose a type.' USING ERRCODE = '22023'; END IF;
  IF length(btrim(coalesce(p_title, ''))) NOT BETWEEN 3 AND 150 THEN RAISE EXCEPTION 'The title must be 3 to 150 characters.' USING ERRCODE = '22023'; END IF;
  IF p_date IS NULL OR p_date > current_date OR p_date < date '2000-01-01' THEN RAISE EXCEPTION 'Enter the date it happened (not in the future).' USING ERRCODE = '22023'; END IF;
  IF v_desc IS NOT NULL AND length(v_desc) > 600 THEN RAISE EXCEPTION 'Keep the description under 600 characters.' USING ERRCODE = '22023'; END IF;
  IF v_link IS NOT NULL AND v_link !~ '^https?://[^[:space:]]{3,255}$' THEN RAISE EXCEPTION 'Enter a full link starting with http:// or https://.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_s FROM students WHERE user_id = v_user AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student record not found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_o FROM student_achievements WHERE id = p_id AND college_id = v_c AND student_id = v_s.id FOR UPDATE;
  IF NOT FOUND OR v_o.status <> 'VERIFIED' THEN RAISE EXCEPTION 'Only one of your verified achievements can be revised.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM student_achievements WHERE replaces_id = p_id AND status = 'SUBMITTED') THEN
    RAISE EXCEPTION 'A revision of this entry is already awaiting review. Withdraw it to submit a different one.' USING ERRCODE = '23505';
  END IF;
  IF (v_o.kind, btrim(v_o.title), v_o.achieved_on, v_o.description, v_o.link) IS NOT DISTINCT FROM (p_kind, btrim(p_title), p_date, v_desc, v_link) THEN
    RAISE EXCEPTION 'Nothing has changed from the verified entry.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM student_achievements WHERE student_id = v_s.id AND status = 'SUBMITTED') >= 10 THEN
    RAISE EXCEPTION 'You already have 10 entries awaiting review. Wait for a decision or withdraw one.' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM student_achievements WHERE student_id = v_s.id AND status IN ('SUBMITTED', 'VERIFIED') AND id <> p_id AND kind = p_kind AND achieved_on = p_date AND lower(btrim(title)) = lower(btrim(p_title))) THEN
    RAISE EXCEPTION 'You have already added this achievement.' USING ERRCODE = '23505';
  END IF;
  INSERT INTO student_achievements (college_id, student_id, kind, title, achieved_on, description, link, replaces_id, submitted_by)
  VALUES (v_c, v_s.id, p_kind, btrim(p_title), p_date, v_desc, v_link, p_id, v_user) RETURNING id INTO v_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'STUDENT', 'ACHIEVEMENT_REVISED', 'achievement', v_id::text, jsonb_build_object('replaces', p_id), NULL);
  RETURN v_id;
END $$;

-- Verifying a revision closes the entry it replaces (in the same statement sequence, under the same lock).
CREATE OR REPLACE FUNCTION achievements.verify(p_id uuid, p_note text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_name text; v_a student_achievements%ROWTYPE;
BEGIN
  v_a := achievements.lock_for_review(p_id);
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN RAISE EXCEPTION 'the note is too long' USING ERRCODE = '22023'; END IF;
  SELECT full_name INTO v_name FROM users WHERE id = v_user;
  IF v_a.replaces_id IS NOT NULL THEN
    UPDATE student_achievements SET status = 'SUPERSEDED', closed_at = now() WHERE id = v_a.replaces_id AND college_id = v_c AND status = 'VERIFIED';
  END IF;
  UPDATE student_achievements SET status = 'VERIFIED', reviewed_by = v_user, reviewed_by_name = v_name, reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), '') WHERE id = p_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'COORDINATOR', 'ACHIEVEMENT_VERIFIED', 'achievement', p_id::text, CASE WHEN v_a.replaces_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('replaces', v_a.replaces_id) END, NULL);
END $$;
RESET ROLE;

REVOKE ALL ON FUNCTION achievements.revise(uuid, text, text, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION achievements.revise(uuid, text, text, date, text, text) TO cc_app;
REVOKE CREATE ON SCHEMA achievements FROM cc_auth;
