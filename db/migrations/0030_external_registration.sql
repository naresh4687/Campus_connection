-- 0030_external_registration: drives that are registered through the COMPANY'S website, with screenshot evidence kept privately and reviewed by staff.
--   A drive has a registration method: INTERNAL (one click in CampusConnect, unchanged) or EXTERNAL (company form + a screenshot of its confirmation page).
--   Opening the external link is not a registration. begin_external() records an intent (PENDING_EXTERNAL) after the same eligibility check as register();
--   submit_evidence() stores a screenshot version and only then makes the CampusConnect registration REGISTERED, with the evidence still
--   SUBMITTED_PENDING_REVIEW. Nothing here claims the external submission is verified: only a reviewing officer (or the department's coordinator) can say VERIFIED.
--   Evidence versions are never overwritten or deleted by a replacement; the file lives in private object storage and is reachable only through evidence_key().

-- ── repair of 0028 (applied history is never edited, so the fix lives here): Postgres allows at most 255 repetitions in a regex, so its "{3,500}" link pattern raised an error whenever a link was saved ──
ALTER TABLE announcements DROP CONSTRAINT announcements_action_link_check;
ALTER TABLE announcements ADD CONSTRAINT announcements_action_link_check CHECK (action_link IS NULL OR (length(action_link) BETWEEN 10 AND 500 AND action_link ~ '^https?://[^[:space:]]+$'));
GRANT CREATE ON SCHEMA announcements TO cc_auth;
SET LOCAL ROLE cc_auth;
DO $$
DECLARE v text := pg_get_functiondef('announcements.save(uuid, jsonb, jsonb, text, boolean)'::regprocedure); v_fixed text;
BEGIN
  v_fixed := replace(v, 'a.action_link !~ ''^https?://[^[:space:]]{3,500}$'' THEN', '(length(a.action_link) NOT BETWEEN 10 AND 500 OR a.action_link !~ ''^https?://[^[:space:]]+$'') THEN');
  IF v_fixed <> v THEN EXECUTE v_fixed; END IF;
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA announcements FROM cc_auth;

-- ── the drive's registration method ──
ALTER TABLE drives
  ADD COLUMN registration_method text NOT NULL DEFAULT 'INTERNAL' CHECK (registration_method IN ('INTERNAL', 'EXTERNAL')),
  ADD COLUMN external_url text CHECK (external_url IS NULL OR (length(external_url) BETWEEN 10 AND 500 AND external_url ~ '^https?://[^[:space:]]+$')),
  ADD COLUMN external_instructions text CHECK (external_instructions IS NULL OR length(external_instructions) <= 2000),
  ADD COLUMN external_url_confirmed boolean NOT NULL DEFAULT false,         -- an officer confirmed this link is the actual registration form (not a company site or a job-description page)
  ADD COLUMN evidence_review_required boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT drives_external_complete CHECK (registration_method = 'INTERNAL' OR external_url IS NOT NULL);

CREATE FUNCTION placement.external_publish_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'PUBLISHED' AND OLD.status IS DISTINCT FROM 'PUBLISHED' AND NEW.registration_method = 'EXTERNAL' AND NEW.external_url_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'Confirm that the external link is the real registration form before publishing.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER drives_external_guard BEFORE UPDATE OF status ON drives FOR EACH ROW EXECUTE FUNCTION placement.external_publish_guard();

-- ── registrations: a pending external state, and the evidence status ──
ALTER TABLE registrations DROP CONSTRAINT registrations_status_check;
ALTER TABLE registrations
  ADD CONSTRAINT registrations_status_check CHECK (status IN ('PENDING_EXTERNAL', 'REGISTERED', 'WITHDRAWN')),
  ADD COLUMN method text NOT NULL DEFAULT 'INTERNAL' CHECK (method IN ('INTERNAL', 'EXTERNAL')),
  ADD COLUMN external_url text,                         -- the link as it was when the student started (the drive's link may change later)
  ADD COLUMN initiated_at timestamptz,
  ADD COLUMN evidence_status text CHECK (evidence_status IS NULL OR evidence_status IN ('NOT_SUBMITTED', 'SUBMITTED_PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED')),
  ADD COLUMN evidence_updated_at timestamptz,
  ADD COLUMN late_ok_until timestamptz,                 -- set by staff: a sanctioned exception allowing a screenshot after the deadline
  ADD CONSTRAINT registrations_external_shape CHECK ((method = 'EXTERNAL') = (evidence_status IS NOT NULL) AND (status <> 'PENDING_EXTERNAL' OR (method = 'EXTERNAL' AND evidence_status = 'NOT_SUBMITTED')));
ALTER TABLE registration_events DROP CONSTRAINT registration_events_event_check;
ALTER TABLE registration_events ADD CONSTRAINT registration_events_event_check CHECK (event IN ('REGISTERED', 'WITHDRAWN', 'RE_REGISTERED', 'EXTERNAL_STARTED', 'EVIDENCE_SUBMITTED', 'EVIDENCE_VERIFIED', 'EVIDENCE_REJECTED', 'EVIDENCE_RESUBMISSION_REQUESTED', 'LATE_ALLOWED'));

-- ── the evidence itself: one row per submitted screenshot version ──
CREATE TABLE registration_evidence (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id      uuid NOT NULL,
  registration_id uuid NOT NULL,
  student_id      uuid NOT NULL,
  drive_id        uuid NOT NULL,
  version         int NOT NULL CHECK (version >= 1),
  storage_key     text NOT NULL UNIQUE,
  original_name   text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 160),
  content_type    text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes      int NOT NULL CHECK (size_bytes BETWEEN 1 AND 8388608),
  sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status          text NOT NULL DEFAULT 'SUBMITTED_PENDING_REVIEW' CHECK (status IN ('SUBMITTED_PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED', 'SUPERSEDED')),
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  submitted_by    uuid NOT NULL REFERENCES users (id),
  reviewed_by     uuid REFERENCES users (id),
  reviewed_by_name text,
  reviewed_at     timestamptz,
  review_note     text CHECK (review_note IS NULL OR length(review_note) <= 500),
  purged_at       timestamptz,
  UNIQUE (registration_id, version),
  FOREIGN KEY (college_id, registration_id) REFERENCES registrations (college_id, id),
  FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id),
  FOREIGN KEY (college_id, drive_id) REFERENCES drives (college_id, id)
);
CREATE INDEX registration_evidence_drive_idx ON registration_evidence (drive_id, status);
CREATE FUNCTION registrations.evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'evidence is retained' USING ERRCODE = '42501'; END IF;
  IF (NEW.id, NEW.college_id, NEW.registration_id, NEW.student_id, NEW.drive_id, NEW.version, NEW.storage_key, NEW.sha256, NEW.submitted_at, NEW.submitted_by, NEW.content_type, NEW.size_bytes, NEW.original_name)
     IS DISTINCT FROM (OLD.id, OLD.college_id, OLD.registration_id, OLD.student_id, OLD.drive_id, OLD.version, OLD.storage_key, OLD.sha256, OLD.submitted_at, OLD.submitted_by, OLD.content_type, OLD.size_bytes, OLD.original_name) THEN
    RAISE EXCEPTION 'submitted evidence cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER registration_evidence_guard BEFORE UPDATE OR DELETE ON registration_evidence FOR EACH ROW EXECUTE FUNCTION registrations.evidence_guard();
GRANT SELECT, INSERT, UPDATE ON registration_evidence TO cc_auth;
GRANT SELECT (id, college_id, registration_id, student_id, drive_id, version, original_name, content_type, size_bytes, status, submitted_at, reviewed_by_name, reviewed_at, review_note) ON registration_evidence TO cc_app;   -- NOT storage_key: only evidence_key() hands it out
ALTER TABLE registration_evidence ENABLE ROW LEVEL SECURITY; ALTER TABLE registration_evidence FORCE ROW LEVEL SECURITY;
-- The student sees their own; a coordinator the students of their current departments (the students policy already scopes both); officers and the administrator the college's.
CREATE POLICY registration_evidence_select ON registration_evidence FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND ((SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN') OR student_id IN (SELECT st.id FROM students st)));

-- ── an officer sets how a drive is registered ──
CREATE FUNCTION placement.set_drive_registration(p_id uuid, p_method text, p_url text, p_instructions text, p_confirmed boolean, p_review_required boolean) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); d drives%ROWTYPE; v_url text := nullif(btrim(coalesce(p_url, '')), ''); v_started boolean;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'PLACEMENT_OFFICER' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF p_method IS NULL OR p_method NOT IN ('INTERNAL', 'EXTERNAL') THEN RAISE EXCEPTION 'Choose how students register.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO d FROM drives WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Drive not found.' USING ERRCODE = '22023'; END IF;
  IF d.status = 'ARCHIVED' THEN RAISE EXCEPTION 'An archived drive cannot be changed.' USING ERRCODE = '22023'; END IF;
  SELECT EXISTS (SELECT 1 FROM registrations WHERE drive_id = p_id) INTO v_started;
  IF v_started AND (p_method <> d.registration_method OR (p_method = 'EXTERNAL' AND v_url IS DISTINCT FROM d.external_url)) THEN
    RAISE EXCEPTION 'Students have already started registering, so the registration method and link can no longer change.' USING ERRCODE = '22023';
  END IF;
  IF p_method = 'EXTERNAL' THEN
    IF v_url IS NULL OR length(v_url) NOT BETWEEN 10 AND 500 OR v_url !~ '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION 'Enter the full external registration link (https://…).' USING ERRCODE = '22023'; END IF;
    IF p_instructions IS NOT NULL AND length(p_instructions) > 2000 THEN RAISE EXCEPTION 'Keep the instructions under 2000 characters.' USING ERRCODE = '22023'; END IF;
    UPDATE drives SET registration_method = 'EXTERNAL', external_url = v_url, external_instructions = nullif(btrim(coalesce(p_instructions, '')), ''),
      external_url_confirmed = coalesce(p_confirmed, false) AND (v_url IS NOT DISTINCT FROM v_url), evidence_review_required = coalesce(p_review_required, true), updated_by = v_user, updated_at = now() WHERE id = p_id;
  ELSE
    UPDATE drives SET registration_method = 'INTERNAL', external_url = NULL, external_instructions = NULL, external_url_confirmed = false, evidence_review_required = true, updated_by = v_user, updated_at = now() WHERE id = p_id;
  END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'PLACEMENT_OFFICER', 'DRIVE_REGISTRATION_METHOD_SET', 'drive', p_id::text, jsonb_build_object('method', p_method, 'confirmed', coalesce(p_confirmed, false)), NULL);
END $$;

GRANT USAGE, CREATE ON SCHEMA registrations TO cc_auth;      -- CREATE is revoked again at the end; replacing a function needs it

-- Registration is done through the company's site for an external drive: the one-click path must not bypass the screenshot step.
SET LOCAL ROLE cc_auth;
CREATE OR REPLACE FUNCTION registrations.register(p_drive uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_sid uuid; d drives%ROWTYPE; r jsonb; v_eval uuid; v_reg registrations%ROWTYPE; v_id uuid; v_why text;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_sid FROM students WHERE user_id = v_user AND college_id = v_c FOR UPDATE;       -- serialises this student's registrations
  IF NOT FOUND THEN RAISE EXCEPTION 'student record not found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO d FROM drives WHERE id = p_drive AND college_id = v_c FOR SHARE;
  IF NOT FOUND OR d.status NOT IN ('PUBLISHED', 'CLOSED') THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  IF d.registration_method = 'EXTERNAL' THEN RAISE EXCEPTION 'This drive is registered through the company’s website. Use “Register through company website”.' USING ERRCODE = '22023'; END IF;
  IF d.status <> 'PUBLISHED' THEN RAISE EXCEPTION 'Registration for this drive is closed.' USING ERRCODE = '22023'; END IF;
  IF d.application_deadline <= now() THEN RAISE EXCEPTION 'The application deadline has passed.' USING ERRCODE = '22023'; END IF;
  r := eligibility.evaluate(v_sid, p_drive);               -- re-checked HERE, never trusted from the client
  INSERT INTO eligibility_evaluations (college_id, drive_id, student_id, submission_id, result, checks, engine_version, context)
  VALUES (v_c, p_drive, v_sid, (r->>'submission_id')::uuid, r->>'result', r->'checks', r->>'engine_version', 'REGISTRATION') RETURNING id INTO v_eval;
  IF r->>'result' <> 'ELIGIBLE' THEN
    SELECT string_agg(x->>'message', ' ') INTO v_why FROM jsonb_array_elements(r->'checks') x WHERE x->>'status' <> 'PASS' AND x->>'message' IS NOT NULL;
    RAISE EXCEPTION 'You are not eligible to register: %', coalesce(v_why, r->>'result') USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_reg FROM registrations WHERE drive_id = p_drive AND student_id = v_sid FOR UPDATE;
  IF FOUND THEN
    IF v_reg.status = 'REGISTERED' THEN RAISE EXCEPTION 'You are already registered for this drive.' USING ERRCODE = '23505'; END IF;
    UPDATE registrations SET status = 'REGISTERED', withdrawn_at = NULL, evaluation_id = v_eval, registered_at = now() WHERE id = v_reg.id;
    INSERT INTO registration_events (college_id, registration_id, event) VALUES (v_c, v_reg.id, 'RE_REGISTERED');
    v_id := v_reg.id;
  ELSE
    INSERT INTO registrations (college_id, drive_id, student_id, evaluation_id) VALUES (v_c, p_drive, v_sid, v_eval) RETURNING id INTO v_id;
    INSERT INTO registration_events (college_id, registration_id, event) VALUES (v_c, v_id, 'REGISTERED');
  END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'STUDENT', 'DRIVE_REGISTERED', 'drive', p_drive::text, '{}'::jsonb, NULL);
  RETURN v_id;
END $$;
RESET ROLE;

-- ── step 1-3: eligibility is checked again, then an intent is recorded (the same call twice returns the same registration) ──
CREATE FUNCTION registrations.begin_external(p_drive uuid) RETURNS TABLE (registration_id uuid, external_url text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_sid uuid; d drives%ROWTYPE; r jsonb; v_eval uuid; v_reg registrations%ROWTYPE; v_id uuid; v_why text; v_had boolean;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_sid FROM students WHERE user_id = v_user AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student record not found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO d FROM drives WHERE id = p_drive AND college_id = v_c FOR SHARE;
  IF NOT FOUND OR d.status NOT IN ('PUBLISHED', 'CLOSED') OR d.registration_method <> 'EXTERNAL' THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_reg FROM registrations WHERE drive_id = p_drive AND student_id = v_sid FOR UPDATE;
  v_had := FOUND;                                                                            -- FOUND is overwritten by every later statement
  IF v_had AND v_reg.status = 'PENDING_EXTERNAL' THEN                                     -- coming back, or a double click: the same intent
    registration_id := v_reg.id; external_url := coalesce(v_reg.external_url, d.external_url); RETURN NEXT; RETURN;
  END IF;
  IF v_had AND v_reg.status = 'REGISTERED' THEN RAISE EXCEPTION 'You are already registered for this drive.' USING ERRCODE = '23505'; END IF;
  IF d.status <> 'PUBLISHED' THEN RAISE EXCEPTION 'Registration for this drive is closed.' USING ERRCODE = '22023'; END IF;
  IF d.application_deadline <= now() THEN RAISE EXCEPTION 'The application deadline has passed.' USING ERRCODE = '22023'; END IF;
  r := eligibility.evaluate(v_sid, p_drive);
  INSERT INTO eligibility_evaluations (college_id, drive_id, student_id, submission_id, result, checks, engine_version, context)
  VALUES (v_c, p_drive, v_sid, (r->>'submission_id')::uuid, r->>'result', r->'checks', r->>'engine_version', 'REGISTRATION') RETURNING id INTO v_eval;
  IF r->>'result' <> 'ELIGIBLE' THEN
    SELECT string_agg(x->>'message', ' ') INTO v_why FROM jsonb_array_elements(r->'checks') x WHERE x->>'status' <> 'PASS' AND x->>'message' IS NOT NULL;
    RAISE EXCEPTION 'You are not eligible to register: %', coalesce(v_why, r->>'result') USING ERRCODE = '22023';
  END IF;
  IF v_had THEN                                                                              -- an earlier withdrawal: start again, history kept
    UPDATE registrations SET status = 'PENDING_EXTERNAL', withdrawn_at = NULL, evaluation_id = v_eval, method = 'EXTERNAL', external_url = d.external_url, initiated_at = now(), registered_at = now(),
      evidence_status = 'NOT_SUBMITTED', evidence_updated_at = now() WHERE id = v_reg.id;
    v_id := v_reg.id;
  ELSE
    INSERT INTO registrations (college_id, drive_id, student_id, evaluation_id, status, method, external_url, initiated_at, evidence_status, evidence_updated_at)
    VALUES (v_c, p_drive, v_sid, v_eval, 'PENDING_EXTERNAL', 'EXTERNAL', d.external_url, now(), 'NOT_SUBMITTED', now()) RETURNING id INTO v_id;
  END IF;
  INSERT INTO registration_events (college_id, registration_id, event) VALUES (v_c, v_id, 'EXTERNAL_STARTED');
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'STUDENT', 'EXTERNAL_REGISTRATION_STARTED', 'drive', p_drive::text, '{}'::jsonb, NULL);
  registration_id := v_id; external_url := d.external_url; RETURN NEXT;
END $$;

-- ── step 5-6: a screenshot arrives (the file is already in private storage under a key the server made) ──
CREATE FUNCTION registrations.submit_evidence(p_drive uuid, p_key text, p_name text, p_type text, p_size int, p_sha256 text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_sid uuid; d drives%ROWTYPE; g registrations%ROWTYPE; v_ver int; v_id uuid; v_first boolean;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v_sid FROM students WHERE user_id = v_user AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student record not found' USING ERRCODE = '22023'; END IF;
  IF p_key !~ ('^c/' || v_c::text || '/s/' || v_sid::text || '/[0-9a-f-]{36}$') THEN RAISE EXCEPTION 'invalid storage key' USING ERRCODE = '22023'; END IF;
  SELECT * INTO d FROM drives WHERE id = p_drive AND college_id = v_c;
  IF NOT FOUND OR d.registration_method <> 'EXTERNAL' THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO g FROM registrations WHERE drive_id = p_drive AND student_id = v_sid AND method = 'EXTERNAL' FOR UPDATE;
  IF NOT FOUND OR g.status = 'WITHDRAWN' THEN RAISE EXCEPTION 'Start the registration first: open the company’s form from the drive page.' USING ERRCODE = '22023'; END IF;
  IF g.evidence_status IN ('SUBMITTED_PENDING_REVIEW', 'VERIFIED') THEN RAISE EXCEPTION 'Your screenshot is already %. A replacement is possible only if staff ask for one.', CASE g.evidence_status WHEN 'VERIFIED' THEN 'verified' ELSE 'submitted and awaiting review' END USING ERRCODE = '22023'; END IF;
  -- Open drive, or a late screenshot that staff allowed (a rejection or a resubmission request is such permission, as is an explicit exception).
  IF NOT (d.status = 'PUBLISHED' AND d.application_deadline > now()) AND NOT (g.evidence_status IN ('REJECTED', 'RESUBMISSION_REQUIRED') OR (g.late_ok_until IS NOT NULL AND g.late_ok_until > now())) THEN
    RAISE EXCEPTION 'The deadline for this drive has passed. Ask the placement office whether a late screenshot can be accepted.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_ver FROM registration_evidence WHERE registration_id = g.id;
  UPDATE registration_evidence SET status = 'SUPERSEDED' WHERE registration_id = g.id AND status IN ('REJECTED', 'RESUBMISSION_REQUIRED') AND version < v_ver;
  INSERT INTO registration_evidence (college_id, registration_id, student_id, drive_id, version, storage_key, original_name, content_type, size_bytes, sha256, submitted_by)
  VALUES (v_c, g.id, v_sid, p_drive, v_ver, p_key, p_name, p_type, p_size, p_sha256, v_user) RETURNING id INTO v_id;
  v_first := (g.status = 'PENDING_EXTERNAL');
  UPDATE registrations SET status = 'REGISTERED', registered_at = CASE WHEN v_first THEN now() ELSE registered_at END, evidence_status = 'SUBMITTED_PENDING_REVIEW', evidence_updated_at = now(), late_ok_until = NULL WHERE id = g.id;
  INSERT INTO registration_events (college_id, registration_id, event) VALUES (v_c, g.id, 'EVIDENCE_SUBMITTED');
  PERFORM notifications.push_many(v_c, ARRAY[v_user], 'DRIVES', 'Screenshot submitted', 'Your external registration screenshot for ' || d.company_name || ' was submitted and is awaiting verification.', '/student/drives/' || p_drive::text);
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'STUDENT', CASE WHEN v_ver > 1 THEN 'EXTERNAL_EVIDENCE_REPLACED' ELSE 'EXTERNAL_EVIDENCE_SUBMITTED' END, 'drive', p_drive::text, jsonb_build_object('version', v_ver), NULL);
  RETURN v_id;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'The file details were not accepted (type, size or name).' USING ERRCODE = '22023';
END $$;

-- ── who may review: officers (the whole college) and a coordinator for the students of their CURRENT departments ──
CREATE FUNCTION registrations.can_review(p_student uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE app.current_role()
    WHEN 'PLACEMENT_OFFICER' THEN EXISTS (SELECT 1 FROM students st WHERE st.id = p_student AND st.college_id = app.current_college_id())
    WHEN 'COORDINATOR' THEN EXISTS (SELECT 1 FROM students st WHERE st.id = p_student AND st.college_id = app.current_college_id() AND st.department_id = ANY (announcements.my_departments()))
    ELSE false END
$$;

CREATE FUNCTION registrations.review_evidence(p_evidence uuid, p_decision text, p_note text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_role text := app.current_role(); e registration_evidence%ROWTYPE; g registrations%ROWTYPE; d drives%ROWTYPE;
  v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_name text; v_suser uuid; v_title text; v_body text; v_event text;
BEGIN
  IF v_role NOT IN ('PLACEMENT_OFFICER', 'COORDINATOR') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED') THEN RAISE EXCEPTION 'Choose verify, reject or ask for a new screenshot.' USING ERRCODE = '22023'; END IF;
  IF p_decision <> 'VERIFIED' AND (v_note IS NULL OR length(v_note) < 5) THEN RAISE EXCEPTION 'Give the student a reason (at least 5 characters).' USING ERRCODE = '22023'; END IF;
  SELECT * INTO e FROM registration_evidence WHERE id = p_evidence AND college_id = v_c FOR UPDATE;
  IF NOT FOUND OR NOT registrations.can_review(e.student_id) THEN RAISE EXCEPTION 'evidence not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO g FROM registrations WHERE id = e.registration_id FOR UPDATE;
  IF e.status <> 'SUBMITTED_PENDING_REVIEW' OR e.version <> (SELECT max(version) FROM registration_evidence WHERE registration_id = e.registration_id) THEN
    RAISE EXCEPTION 'Only the latest screenshot waiting for review can be reviewed.' USING ERRCODE = '22023';
  END IF;
  SELECT full_name INTO v_name FROM users WHERE id = v_user;
  UPDATE registration_evidence SET status = p_decision, reviewed_by = v_user, reviewed_by_name = coalesce(v_name, 'Staff'), reviewed_at = now(), review_note = v_note WHERE id = e.id;
  UPDATE registrations SET evidence_status = p_decision, evidence_updated_at = now() WHERE id = g.id;
  v_event := CASE p_decision WHEN 'VERIFIED' THEN 'EVIDENCE_VERIFIED' WHEN 'REJECTED' THEN 'EVIDENCE_REJECTED' ELSE 'EVIDENCE_RESUBMISSION_REQUESTED' END;
  INSERT INTO registration_events (college_id, registration_id, event) VALUES (v_c, g.id, v_event);
  SELECT * INTO d FROM drives WHERE id = g.drive_id; SELECT user_id INTO v_suser FROM students WHERE id = g.student_id;
  v_title := CASE p_decision WHEN 'VERIFIED' THEN 'External registration verified' WHEN 'REJECTED' THEN 'Screenshot not accepted' ELSE 'Please upload a new screenshot' END;
  v_body := d.company_name || CASE p_decision WHEN 'VERIFIED' THEN ': your external registration was verified.' ELSE ': ' || v_note END;
  IF v_suser IS NOT NULL THEN PERFORM notifications.push_many(v_c, ARRAY[v_suser], 'DRIVES', v_title, v_body, '/student/drives/' || g.drive_id::text); END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, v_role, 'EXTERNAL_EVIDENCE_' || p_decision, 'registration', g.id::text, jsonb_build_object('version', e.version), NULL);
END $$;

-- An explicit exception: the student may submit a screenshot after the deadline (until the given time).
CREATE FUNCTION registrations.allow_late_evidence(p_registration uuid, p_hours int, p_note text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_role text := app.current_role(); g registrations%ROWTYPE; v_suser uuid;
BEGIN
  IF v_role <> 'PLACEMENT_OFFICER' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF p_hours IS NULL OR p_hours NOT BETWEEN 1 AND 168 THEN RAISE EXCEPTION 'Choose 1 to 168 hours.' USING ERRCODE = '22023'; END IF;
  IF p_note IS NULL OR length(btrim(p_note)) < 5 THEN RAISE EXCEPTION 'Say why this exception is made (at least 5 characters).' USING ERRCODE = '22023'; END IF;
  SELECT * INTO g FROM registrations WHERE id = p_registration AND college_id = v_c AND method = 'EXTERNAL' FOR UPDATE;
  IF NOT FOUND OR g.status <> 'PENDING_EXTERNAL' THEN RAISE EXCEPTION 'Only a registration still waiting for its screenshot can get an exception.' USING ERRCODE = '22023'; END IF;
  UPDATE registrations SET late_ok_until = now() + make_interval(hours => p_hours) WHERE id = g.id;
  INSERT INTO registration_events (college_id, registration_id, event) VALUES (v_c, g.id, 'LATE_ALLOWED');
  SELECT user_id INTO v_suser FROM students WHERE id = g.student_id;
  IF v_suser IS NOT NULL THEN PERFORM notifications.push_many(v_c, ARRAY[v_suser], 'DRIVES', 'You may still upload your screenshot', 'The placement office allowed a late screenshot for your external registration.', '/student/drives/' || g.drive_id::text); END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, v_role, 'EXTERNAL_LATE_ALLOWED', 'registration', g.id::text, jsonb_build_object('hours', p_hours), NULL);
END $$;

-- ── the only way a screenshot's storage key leaves the database (every call is audited) ──
CREATE FUNCTION registrations.evidence_key(p_evidence uuid) RETURNS TABLE (storage_key text, content_type text, original_name text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_role text := app.current_role(); e registration_evidence%ROWTYPE; v_ok boolean;
BEGIN
  SELECT * INTO e FROM registration_evidence WHERE id = p_evidence AND college_id = v_c AND purged_at IS NULL;
  IF NOT FOUND OR v_role IS NULL THEN RAISE EXCEPTION 'evidence not found' USING ERRCODE = '22023'; END IF;
  v_ok := CASE v_role WHEN 'STUDENT' THEN EXISTS (SELECT 1 FROM students WHERE id = e.student_id AND user_id = v_user) ELSE registrations.can_review(e.student_id) END;
  IF NOT v_ok THEN RAISE EXCEPTION 'evidence not found' USING ERRCODE = '42501'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, v_role, 'EXTERNAL_EVIDENCE_VIEWED', 'registration', e.registration_id::text, jsonb_build_object('version', e.version), NULL);
  storage_key := e.storage_key; content_type := e.content_type; original_name := e.original_name; RETURN NEXT;
END $$;

-- ── staff list: the latest screenshot of each external registration the caller may review ──
CREATE FUNCTION registrations.evidence_queue(p_drive uuid) RETURNS TABLE (
  registration_id uuid, student_id uuid, full_name text, register_number text, department_code text, registration_status text, evidence_status text, evidence_id uuid, version int,
  submitted_at timestamptz, review_note text, reviewed_by_name text, reviewed_at timestamptz, versions int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id();
BEGIN
  IF app.current_role() NOT IN ('PLACEMENT_OFFICER', 'COORDINATOR') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT g.id, st.id, st.full_name, st.register_number::text, dp.code::text, g.status, g.evidence_status, ev.id, ev.version, ev.submitted_at, ev.review_note, ev.reviewed_by_name, ev.reviewed_at,
         (SELECT count(*)::int FROM registration_evidence x WHERE x.registration_id = g.id)
    FROM registrations g JOIN students st ON st.id = g.student_id JOIN departments dp ON dp.id = st.department_id
    LEFT JOIN LATERAL (SELECT * FROM registration_evidence x WHERE x.registration_id = g.id ORDER BY x.version DESC LIMIT 1) ev ON true
   WHERE g.drive_id = p_drive AND g.college_id = v_c AND g.method = 'EXTERNAL' AND g.status <> 'WITHDRAWN' AND registrations.can_review(st.id)
   ORDER BY (g.evidence_status = 'SUBMITTED_PENDING_REVIEW') DESC, st.full_name;
END $$;

-- ── every version of one registration's evidence (the student's own, or what the reviewer may see) ──
CREATE FUNCTION registrations.evidence_history(p_registration uuid) RETURNS TABLE (id uuid, version int, status text, original_name text, size_bytes int, submitted_at timestamptz, reviewed_by_name text, reviewed_at timestamptz, review_note text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_role text := app.current_role(); g registrations%ROWTYPE;
BEGIN
  SELECT * INTO g FROM registrations WHERE registrations.id = p_registration AND college_id = v_c;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_role = 'STUDENT' THEN IF NOT EXISTS (SELECT 1 FROM students WHERE students.id = g.student_id AND user_id = v_user) THEN RETURN; END IF;
  ELSIF NOT registrations.can_review(g.student_id) THEN RETURN; END IF;
  RETURN QUERY SELECT e.id, e.version, e.status, e.original_name, e.size_bytes, e.submitted_at, e.reviewed_by_name, e.reviewed_at, e.review_note FROM registration_evidence e WHERE e.registration_id = p_registration ORDER BY e.version DESC;
END $$;

-- ── counts for reports: distinct registrations, never uploads ──
CREATE FUNCTION registrations.external_counts(p_drive uuid) RETURNS TABLE (internal_registered int, external_started int, screenshots_submitted int, pending_review int, verified int, rejected int, action_required int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id();
BEGIN
  IF app.current_role() NOT IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT
    (count(*) FILTER (WHERE method = 'INTERNAL' AND status = 'REGISTERED'))::int,
    (count(*) FILTER (WHERE method = 'EXTERNAL' AND status <> 'WITHDRAWN'))::int,
    (count(*) FILTER (WHERE method = 'EXTERNAL' AND status <> 'WITHDRAWN' AND evidence_status <> 'NOT_SUBMITTED'))::int,
    (count(*) FILTER (WHERE method = 'EXTERNAL' AND status <> 'WITHDRAWN' AND evidence_status = 'SUBMITTED_PENDING_REVIEW'))::int,
    (count(*) FILTER (WHERE method = 'EXTERNAL' AND status <> 'WITHDRAWN' AND evidence_status = 'VERIFIED'))::int,
    (count(*) FILTER (WHERE method = 'EXTERNAL' AND status <> 'WITHDRAWN' AND evidence_status = 'REJECTED'))::int,
    (count(*) FILTER (WHERE method = 'EXTERNAL' AND status <> 'WITHDRAWN' AND evidence_status IN ('NOT_SUBMITTED', 'REJECTED', 'RESUBMISSION_REQUIRED')))::int
    FROM registrations WHERE drive_id = p_drive AND college_id = v_c;
END $$;

-- ── everything waiting for the caller's review, across drives (an officer: the college; a coordinator: their departments) ──
CREATE FUNCTION registrations.evidence_inbox(p_only_pending boolean) RETURNS TABLE (
  registration_id uuid, drive_id uuid, company_name text, job_title text, student_id uuid, full_name text, register_number text, department_code text,
  evidence_status text, evidence_id uuid, version int, submitted_at timestamptz, review_note text, reviewed_by_name text, reviewed_at timestamptz, versions int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id();
BEGIN
  IF app.current_role() NOT IN ('PLACEMENT_OFFICER', 'COORDINATOR') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT g.id, g.drive_id, d.company_name, d.job_title, st.id, st.full_name, st.register_number::text, dp.code::text, g.evidence_status, ev.id, ev.version, ev.submitted_at, ev.review_note, ev.reviewed_by_name, ev.reviewed_at,
         (SELECT count(*)::int FROM registration_evidence x WHERE x.registration_id = g.id)
    FROM registrations g JOIN drives d ON d.id = g.drive_id JOIN students st ON st.id = g.student_id JOIN departments dp ON dp.id = st.department_id
    JOIN LATERAL (SELECT * FROM registration_evidence x WHERE x.registration_id = g.id ORDER BY x.version DESC LIMIT 1) ev ON true
   WHERE g.college_id = v_c AND g.method = 'EXTERNAL' AND g.status = 'REGISTERED' AND registrations.can_review(st.id)
     AND (NOT p_only_pending OR g.evidence_status = 'SUBMITTED_PENDING_REVIEW')
   ORDER BY (g.evidence_status = 'SUBMITTED_PENDING_REVIEW') DESC, ev.submitted_at DESC LIMIT 300;
END $$;

-- ── retention: screenshots of drives closed for more than N months may be purged (file deleted, row and audit trail kept). Owner-run by scripts/purge-evidence.ts; not callable by the app. ──
CREATE FUNCTION registrations.expired_evidence(p_months int) RETURNS TABLE (id uuid, storage_key text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT e.id, e.storage_key FROM registration_evidence e JOIN drives d ON d.id = e.drive_id
   WHERE e.purged_at IS NULL AND d.status IN ('CLOSED', 'ARCHIVED') AND coalesce(d.archived_at, d.closed_at, d.application_deadline) < now() - make_interval(months => greatest(p_months, 1))
$$;
CREATE FUNCTION registrations.mark_evidence_purged(p_id uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE registration_evidence SET purged_at = now() WHERE id = p_id AND purged_at IS NULL
$$;

-- ── ownership and privileges (same pattern as every other vetted function) ──
GRANT CREATE ON SCHEMA placement TO cc_auth;
ALTER FUNCTION placement.set_drive_registration(uuid, text, text, text, boolean, boolean) OWNER TO cc_auth;
ALTER FUNCTION registrations.begin_external(uuid) OWNER TO cc_auth;
ALTER FUNCTION registrations.submit_evidence(uuid, text, text, text, int, text) OWNER TO cc_auth;
ALTER FUNCTION registrations.can_review(uuid) OWNER TO cc_auth;
ALTER FUNCTION registrations.review_evidence(uuid, text, text) OWNER TO cc_auth;
ALTER FUNCTION registrations.allow_late_evidence(uuid, int, text) OWNER TO cc_auth;
ALTER FUNCTION registrations.evidence_key(uuid) OWNER TO cc_auth;
ALTER FUNCTION registrations.evidence_queue(uuid) OWNER TO cc_auth;
ALTER FUNCTION registrations.evidence_history(uuid) OWNER TO cc_auth;
ALTER FUNCTION registrations.external_counts(uuid) OWNER TO cc_auth;
ALTER FUNCTION registrations.evidence_inbox(boolean) OWNER TO cc_auth;
ALTER FUNCTION registrations.expired_evidence(int) OWNER TO cc_auth;
ALTER FUNCTION registrations.mark_evidence_purged(uuid) OWNER TO cc_auth;
REVOKE CREATE ON SCHEMA placement, registrations FROM cc_auth;
REVOKE ALL ON FUNCTION placement.set_drive_registration(uuid, text, text, text, boolean, boolean), registrations.begin_external(uuid), registrations.submit_evidence(uuid, text, text, text, int, text),
  registrations.can_review(uuid), registrations.review_evidence(uuid, text, text), registrations.allow_late_evidence(uuid, int, text), registrations.evidence_key(uuid),
  registrations.evidence_queue(uuid), registrations.evidence_history(uuid), registrations.external_counts(uuid),
  registrations.evidence_inbox(boolean), registrations.expired_evidence(int), registrations.mark_evidence_purged(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrations.expired_evidence(int), registrations.mark_evidence_purged(uuid) TO CURRENT_USER;      -- owner-run retention script only
GRANT EXECUTE ON FUNCTION placement.set_drive_registration(uuid, text, text, text, boolean, boolean), registrations.begin_external(uuid), registrations.submit_evidence(uuid, text, text, text, int, text),
  registrations.review_evidence(uuid, text, text), registrations.allow_late_evidence(uuid, int, text), registrations.evidence_key(uuid), registrations.evidence_queue(uuid),
  registrations.evidence_history(uuid), registrations.external_counts(uuid), registrations.evidence_inbox(boolean) TO cc_app;      -- can_review, expired_evidence and mark_evidence_purged are internal
REVOKE ALL ON FUNCTION registrations.evidence_guard() FROM PUBLIC;
