-- 0028_announcements: placement announcements (stage 1 of the placement message composer). An announcement is NOT a placement drive: it never
-- creates, changes or publishes a drive, never touches registrations, results or offers, and a candidate list in it grants nothing. It may be
-- linked to an existing drive for context. Written only through audited functions.
--   Roles: placement officers create/edit/publish/archive any announcement; coordinators the ones they created, for students of their
--   CURRENTLY assigned departments only (re-checked at publish). Students see only announcements they were notified of. The college administrator reads.
--   Audience: frozen into announcement_recipients at publish (a student who becomes eligible later is not added; a published audience cannot be changed).
--   The audience definition lives in its own staff-only table so a named-student list is never readable by students.
--   Lifecycle: DRAFT -> PUBLISHED -> ARCHIVED (DRAFT -> ARCHIVED too). "Updated" = version > 1; "expired" is derived from expires_at, not stored.
--   Email delivery is not built (TD-12): notifications are in-app only. Scheduled publishing is not built.

CREATE SCHEMA announcements;
REVOKE ALL ON SCHEMA announcements FROM PUBLIC;
GRANT USAGE ON SCHEMA announcements TO cc_app;
GRANT USAGE, CREATE ON SCHEMA announcements TO cc_auth;          -- CREATE revoked at the end
GRANT CREATE ON SCHEMA notifications TO cc_auth;                  -- temporary (to replace set_preference); revoked at the end

-- ── a new notification category ──
ALTER TABLE notifications DROP CONSTRAINT notifications_category_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_category_check CHECK (category IN ('DRIVES', 'ROUNDS', 'OFFERS', 'PLACEMENT', 'ACADEMICS', 'DOCUMENTS', 'TASKS', 'ANNOUNCEMENTS'));
ALTER TABLE notification_preferences DROP CONSTRAINT notification_preferences_category_check;
ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_category_check CHECK (category IN ('DRIVES', 'ROUNDS', 'OFFERS', 'PLACEMENT', 'ACADEMICS', 'DOCUMENTS', 'TASKS', 'ANNOUNCEMENTS'));

CREATE TABLE announcements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id       uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('ON_CAMPUS_DRIVE', 'INTERVIEW_SCHEDULE', 'RECRUITMENT_UPDATE', 'TRAINING_VENUE', 'SHORTLIST_UPDATE', 'ALTERNATE_ROLE_CONSENT', 'REGISTRATION_REMINDER', 'PLACEMENT_INSTRUCTIONS', 'GENERAL')),
  title            text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 150),
  company_name     text CHECK (company_name IS NULL OR length(company_name) <= 120),
  drive_id         uuid,
  original_message text CHECK (original_message IS NULL OR length(original_message) <= 20000),
  summary          text CHECK (summary IS NULL OR length(summary) <= 5000),
  event_date       date,
  event_time       text CHECK (event_time IS NULL OR length(event_time) <= 40),
  venue            text CHECK (venue IS NULL OR length(venue) <= 200),
  instructions     text CHECK (instructions IS NULL OR length(instructions) <= 3000),
  consent_deadline timestamptz,
  action_link      text CHECK (action_link IS NULL OR action_link ~ '^https?://[^[:space:]]{3,500}$'),
  priority         text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL', 'HIGH', 'URGENT')),
  display_mode     text NOT NULL DEFAULT 'SUMMARY' CHECK (display_mode IN ('SUMMARY', 'ORIGINAL', 'BOTH')),
  stages           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(stages) = 'array' AND jsonb_array_length(stages) <= 15),
  batches          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(batches) = 'array' AND jsonb_array_length(batches) <= 20),   -- [{name, venue, note}] one entry per batch
  expires_at       timestamptz,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  version          int NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by       uuid NOT NULL REFERENCES users (id),
  created_by_role  text NOT NULL CHECK (created_by_role IN ('PLACEMENT_OFFICER', 'COORDINATOR')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz,
  archived_at      timestamptz,
  UNIQUE (college_id, id),
  FOREIGN KEY (college_id, drive_id) REFERENCES drives (college_id, id),
  CONSTRAINT announcements_published CHECK ((status = 'DRAFT') = (published_at IS NULL) OR status = 'ARCHIVED'),
  CONSTRAINT announcements_archived CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL))
);
CREATE INDEX announcements_college_idx ON announcements (college_id, status, updated_at DESC);
CREATE INDEX announcements_drive_idx ON announcements (drive_id) WHERE drive_id IS NOT NULL;

-- Who is addressed. Staff-only: it can hold a named list of students.
CREATE TABLE announcement_audiences (
  announcement_id uuid PRIMARY KEY,
  college_id      uuid NOT NULL,
  audience        jsonb NOT NULL CHECK (jsonb_typeof(audience) = 'object'),
  FOREIGN KEY (college_id, announcement_id) REFERENCES announcements (college_id, id)
);

CREATE TABLE announcement_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id       uuid NOT NULL,
  announcement_id  uuid NOT NULL,
  version          int NOT NULL,
  snapshot         jsonb NOT NULL,
  reason           text CHECK (reason IS NULL OR length(reason) BETWEEN 5 AND 500),
  edited_by        uuid NOT NULL REFERENCES users (id),
  edited_by_name   text NOT NULL,
  edited_at        timestamptz NOT NULL DEFAULT now(),
  recipients_count int NOT NULL,
  renotified       boolean NOT NULL DEFAULT false,
  UNIQUE (announcement_id, version),
  FOREIGN KEY (college_id, announcement_id) REFERENCES announcements (college_id, id)
);

CREATE TABLE announcement_recipients (
  announcement_id uuid NOT NULL,
  college_id      uuid NOT NULL,
  student_id      uuid NOT NULL,
  user_id         uuid NOT NULL REFERENCES users (id),
  notified_at     timestamptz NOT NULL DEFAULT now(),
  seen_at         timestamptz,
  PRIMARY KEY (announcement_id, student_id),
  FOREIGN KEY (college_id, announcement_id) REFERENCES announcements (college_id, id),
  FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id)
);
CREATE INDEX announcement_recipients_user_idx ON announcement_recipients (user_id, notified_at DESC);

CREATE FUNCTION announcements.guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'announcements are retained' USING ERRCODE = '42501'; END IF;
  IF (NEW.id, NEW.college_id, NEW.created_by, NEW.created_by_role, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.college_id, OLD.created_by, OLD.created_by_role, OLD.created_at) THEN
    RAISE EXCEPTION 'announcement identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'ARCHIVED' THEN RAISE EXCEPTION 'an archived announcement cannot change' USING ERRCODE = '42501'; END IF;
  IF OLD.status = 'PUBLISHED' AND NEW.status = 'DRAFT' THEN RAISE EXCEPTION 'a published announcement cannot go back to draft' USING ERRCODE = '42501'; END IF;
  IF OLD.status = 'PUBLISHED' AND NEW.kind <> OLD.kind THEN RAISE EXCEPTION 'the type of a published announcement cannot change' USING ERRCODE = '42501'; END IF;
  IF NEW.version < OLD.version THEN RAISE EXCEPTION 'version cannot go back' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER announcements_guard BEFORE UPDATE OR DELETE ON announcements FOR EACH ROW EXECUTE FUNCTION announcements.guard();

CREATE FUNCTION announcements.guard_audience() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'announcement audiences are retained' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM announcements a WHERE a.id = OLD.announcement_id AND a.status <> 'DRAFT') AND NEW.audience IS DISTINCT FROM OLD.audience THEN
    RAISE EXCEPTION 'the audience of a published announcement cannot change' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER announcement_audiences_guard BEFORE UPDATE OR DELETE ON announcement_audiences FOR EACH ROW EXECUTE FUNCTION announcements.guard_audience();

CREATE FUNCTION announcements.guard_versions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'announcement versions are append-only' USING ERRCODE = '42501';
END $$;
CREATE FUNCTION announcements.guard_recipients() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.seen_at IS NULL AND NEW.seen_at IS NOT NULL
     AND (NEW.announcement_id, NEW.college_id, NEW.student_id, NEW.user_id, NEW.notified_at) IS NOT DISTINCT FROM (OLD.announcement_id, OLD.college_id, OLD.student_id, OLD.user_id, OLD.notified_at) THEN
    RETURN NEW;                                                        -- the only change: marking it seen, once
  END IF;
  RAISE EXCEPTION 'announcement recipients are append-only' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER announcement_versions_guard BEFORE UPDATE OR DELETE ON announcement_versions FOR EACH ROW EXECUTE FUNCTION announcements.guard_versions();
CREATE TRIGGER announcement_recipients_guard BEFORE UPDATE OR DELETE ON announcement_recipients FOR EACH ROW EXECUTE FUNCTION announcements.guard_recipients();

GRANT SELECT, INSERT, UPDATE ON announcements, announcement_audiences, announcement_versions, announcement_recipients TO cc_auth;
GRANT SELECT ON announcements, announcement_audiences, announcement_versions, announcement_recipients TO cc_app;      -- read only; every write is an audited function
ALTER TABLE announcements          ENABLE ROW LEVEL SECURITY; ALTER TABLE announcements          FORCE ROW LEVEL SECURITY;
ALTER TABLE announcement_audiences ENABLE ROW LEVEL SECURITY; ALTER TABLE announcement_audiences FORCE ROW LEVEL SECURITY;
ALTER TABLE announcement_versions  ENABLE ROW LEVEL SECURITY; ALTER TABLE announcement_versions  FORCE ROW LEVEL SECURITY;
ALTER TABLE announcement_recipients ENABLE ROW LEVEL SECURITY; ALTER TABLE announcement_recipients FORCE ROW LEVEL SECURITY;

CREATE POLICY recipients_select ON announcement_recipients FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) = 'STUDENT' AND student_id IN (SELECT st.id FROM students st));
CREATE POLICY announcements_select ON announcements FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (
    (SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN')
    OR ((SELECT app.current_role()) = 'COORDINATOR' AND created_by = (SELECT app.current_user_id()))
    OR ((SELECT app.current_role()) = 'STUDENT' AND status = 'PUBLISHED' AND id IN (SELECT r.announcement_id FROM announcement_recipients r))));
CREATE POLICY audiences_select ON announcement_audiences FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN', 'COORDINATOR') AND announcement_id IN (SELECT a.id FROM announcements a));
CREATE POLICY versions_select ON announcement_versions FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN', 'COORDINATOR') AND announcement_id IN (SELECT a.id FROM announcements a));

SET LOCAL ROLE cc_auth;

-- The new category cannot be missing from the preference check.
CREATE OR REPLACE FUNCTION notifications.set_preference(p_category text, p_enabled boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid := app.current_user_id(); v_c uuid := app.current_college_id();
BEGIN
  IF v_u IS NULL OR v_c IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF p_category IS NULL OR p_category NOT IN ('DRIVES', 'ROUNDS', 'OFFERS', 'PLACEMENT', 'ACADEMICS', 'DOCUMENTS', 'TASKS', 'ANNOUNCEMENTS') OR p_enabled IS NULL THEN RAISE EXCEPTION 'invalid preference' USING ERRCODE = '22023'; END IF;
  IF NOT p_enabled AND notifications.is_essential(p_category) THEN RAISE EXCEPTION 'Offer and placement notifications cannot be turned off.' USING ERRCODE = '22023'; END IF;
  INSERT INTO notification_preferences (college_id, user_id, category, enabled) VALUES (v_c, v_u, p_category, p_enabled)
  ON CONFLICT (user_id, category) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
END $$;

-- ── internal helpers (not granted to the runtime role) ──
-- Departments a coordinator is currently assigned to (empty for anyone else).
CREATE FUNCTION announcements.my_departments() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(array_agg(DISTINCT ca.department_id), '{}') FROM coordinator_assignments ca
   WHERE app.current_role() = 'COORDINATOR' AND ca.user_id = app.current_user_id() AND ca.college_id = app.current_college_id() AND ca.ended_at IS NULL
$$;

-- May the caller link to / address people of this drive? Officers: any drive that is not a draft. Coordinators: a published or closed drive open to one of their departments.
CREATE FUNCTION announcements.can_link_drive(p_drive uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM drives d WHERE d.id = p_drive AND d.college_id = app.current_college_id() AND d.status <> 'DRAFT'
                   AND (app.current_role() = 'PLACEMENT_OFFICER'
                        OR (app.current_role() = 'COORDINATOR' AND d.status IN ('PUBLISHED', 'CLOSED')
                            AND EXISTS (SELECT 1 FROM drive_departments dd WHERE dd.drive_id = d.id AND dd.department_id = ANY (announcements.my_departments())))))
$$;

-- Validate and normalise an audience definition for the caller. Raises a plain message for anything out of scope.
--   {source: ALL | CAREER | DRIVE_REGISTERED | DRIVE_SHORTLISTED | DRIVE_SELECTED | NAMED, departments: [uuid], years: [int], career, drive, students: [uuid], named_confirmed}
CREATE FUNCTION announcements.clean_audience(p_aud jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_role text := app.current_role(); v_src text; v_depts uuid[]; v_years int[]; v_students uuid[]; v_mine uuid[] := announcements.my_departments(); v_out jsonb; v_drive uuid; v_career text;
BEGIN
  IF p_aud IS NULL OR jsonb_typeof(p_aud) <> 'object' THEN RAISE EXCEPTION 'Choose who should receive this.' USING ERRCODE = '22023'; END IF;
  v_src := p_aud->>'source';
  IF v_src IS NULL OR v_src NOT IN ('ALL', 'CAREER', 'DRIVE_REGISTERED', 'DRIVE_SHORTLISTED', 'DRIVE_SELECTED', 'NAMED') THEN RAISE EXCEPTION 'Choose who should receive this.' USING ERRCODE = '22023'; END IF;
  BEGIN
    v_depts := coalesce(ARRAY(SELECT DISTINCT (e)::uuid FROM jsonb_array_elements_text(coalesce(p_aud->'departments', '[]'::jsonb)) e), '{}');
    v_years := coalesce(ARRAY(SELECT DISTINCT (e)::int FROM jsonb_array_elements_text(coalesce(p_aud->'years', '[]'::jsonb)) e), '{}');
    v_students := coalesce(ARRAY(SELECT DISTINCT (e)::uuid FROM jsonb_array_elements_text(coalesce(p_aud->'students', '[]'::jsonb)) e), '{}');
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'The audience is not valid.' USING ERRCODE = '22023';
  END;
  IF cardinality(v_depts) > 50 OR cardinality(v_years) > 10 OR cardinality(v_students) > 500 THEN RAISE EXCEPTION 'The audience is too large to define this way.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_years) y WHERE y NOT BETWEEN 2000 AND 2100) THEN RAISE EXCEPTION 'Enter valid passing years.' USING ERRCODE = '22023'; END IF;
  IF cardinality(v_depts) > 0 AND (SELECT count(*) FROM departments d WHERE d.college_id = v_c AND d.id = ANY (v_depts)) <> cardinality(v_depts) THEN RAISE EXCEPTION 'A selected department does not exist.' USING ERRCODE = '22023'; END IF;
  IF v_role = 'COORDINATOR' THEN
    IF cardinality(v_depts) = 0 THEN RAISE EXCEPTION 'Choose the department(s) this is for.' USING ERRCODE = '22023'; END IF;
    IF NOT (v_depts <@ v_mine) THEN RAISE EXCEPTION 'You can only address students of the departments you are assigned to.' USING ERRCODE = '42501'; END IF;
  ELSIF v_role IS DISTINCT FROM 'PLACEMENT_OFFICER' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  v_out := jsonb_build_object('source', v_src, 'departments', to_jsonb(v_depts), 'years', to_jsonb(v_years));
  IF v_src = 'CAREER' THEN
    v_career := p_aud->>'career';
    IF v_career IS NULL OR v_career NOT IN ('PLACEMENT', 'HIGHER_STUDIES', 'ENTREPRENEURSHIP', 'OTHER', 'UNDECIDED', 'NOT_SEEKING_PLACEMENT') THEN RAISE EXCEPTION 'Choose a career interest.' USING ERRCODE = '22023'; END IF;
    v_out := v_out || jsonb_build_object('career', v_career);
  ELSIF v_src IN ('DRIVE_REGISTERED', 'DRIVE_SHORTLISTED', 'DRIVE_SELECTED') THEN
    BEGIN v_drive := (p_aud->>'drive')::uuid; EXCEPTION WHEN others THEN v_drive := NULL; END;
    IF v_drive IS NULL OR NOT announcements.can_link_drive(v_drive) THEN RAISE EXCEPTION 'Choose a drive you are allowed to use.' USING ERRCODE = '42501'; END IF;
    v_out := v_out || jsonb_build_object('drive', v_drive);
  ELSIF v_src = 'NAMED' THEN
    IF cardinality(v_students) = 0 THEN RAISE EXCEPTION 'Add at least one student.' USING ERRCODE = '22023'; END IF;
    IF (SELECT count(*) FROM students st WHERE st.college_id = v_c AND st.id = ANY (v_students)
          AND (v_role <> 'COORDINATOR' OR st.department_id = ANY (v_mine))) <> cardinality(v_students) THEN
      RAISE EXCEPTION 'A listed student does not exist or is outside your departments.' USING ERRCODE = '42501';
    END IF;
    v_out := v_out || jsonb_build_object('students', to_jsonb(v_students), 'named_confirmed', coalesce((p_aud->>'named_confirmed') = 'true', false));
  END IF;
  RETURN v_out;
END $$;

-- The students an (already cleaned) audience addresses. A shortlisted student has been marked SELECTED in at least one round of the drive.
CREATE FUNCTION announcements.resolve(p_aud jsonb) RETURNS TABLE (student_id uuid, user_id uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_src text := p_aud->>'source'; v_depts uuid[]; v_years int[]; v_students uuid[]; v_drive uuid;
BEGIN
  v_depts := ARRAY(SELECT (e)::uuid FROM jsonb_array_elements_text(coalesce(p_aud->'departments', '[]'::jsonb)) e);
  v_years := ARRAY(SELECT (e)::int FROM jsonb_array_elements_text(coalesce(p_aud->'years', '[]'::jsonb)) e);
  v_students := ARRAY(SELECT (e)::uuid FROM jsonb_array_elements_text(coalesce(p_aud->'students', '[]'::jsonb)) e);
  v_drive := (p_aud->>'drive')::uuid;
  RETURN QUERY
    SELECT st.id, st.user_id FROM students st
     WHERE st.college_id = v_c
       AND (cardinality(v_depts) = 0 OR st.department_id = ANY (v_depts))
       AND (cardinality(v_years) = 0 OR st.passing_year = ANY (v_years))
       AND CASE v_src
             WHEN 'ALL' THEN true
             WHEN 'CAREER' THEN st.career_preference = p_aud->>'career'
             WHEN 'NAMED' THEN st.id = ANY (v_students)
             WHEN 'DRIVE_REGISTERED' THEN EXISTS (SELECT 1 FROM registrations r WHERE r.drive_id = v_drive AND r.student_id = st.id AND r.status = 'REGISTERED')
             WHEN 'DRIVE_SHORTLISTED' THEN EXISTS (SELECT 1 FROM round_results rr JOIN registrations r ON r.id = rr.registration_id WHERE r.drive_id = v_drive AND r.student_id = st.id AND rr.result = 'SELECTED')
             WHEN 'DRIVE_SELECTED' THEN EXISTS (SELECT 1 FROM selections s WHERE s.drive_id = v_drive AND s.student_id = st.id)
             ELSE false END;
END $$;

CREATE FUNCTION announcements.snapshot(a announcements) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object('kind', a.kind, 'title', a.title, 'company_name', a.company_name, 'drive_id', a.drive_id, 'original_message', a.original_message, 'summary', a.summary,
    'event_date', a.event_date, 'event_time', a.event_time, 'venue', a.venue, 'instructions', a.instructions, 'consent_deadline', a.consent_deadline, 'action_link', a.action_link,
    'priority', a.priority, 'display_mode', a.display_mode, 'stages', a.stages, 'batches', a.batches, 'expires_at', a.expires_at)
$$;

-- Tell the students already addressed (used for an important change to a published announcement).
CREATE FUNCTION announcements.notify_recipients(a announcements, p_prefix text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_users uuid[];
BEGIN
  SELECT coalesce(array_agg(r.user_id), '{}') INTO v_users FROM announcement_recipients r WHERE r.announcement_id = a.id;
  PERFORM notifications.push_many(a.college_id, v_users, 'ANNOUNCEMENTS', p_prefix || a.title,
    nullif(concat_ws(' · ', a.company_name, to_char(a.event_date, 'DD Mon YYYY'), a.event_time, a.venue), ''), '/student/announcements/' || a.id);
  RETURN cardinality(v_users);
END $$;

-- ── create or edit (draft: free; published: needs a reason, makes a new version, may re-notify) ──
-- p_fields holds only the keys to set; a key left out is unchanged. p_audience null leaves the audience unchanged.
CREATE FUNCTION announcements.save(p_id uuid, p_fields jsonb, p_audience jsonb, p_reason text, p_notify boolean) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_role text := app.current_role();
  a announcements%ROWTYPE; v_new boolean := (p_id IS NULL); v_aud jsonb; v_stored jsonb; v_name text; v_n int := 0; v_item jsonb; v_text text; v_pub boolean := false; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF v_user IS NULL OR v_c IS NULL OR v_role NOT IN ('PLACEMENT_OFFICER', 'COORDINATOR') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN RAISE EXCEPTION 'nothing to save' USING ERRCODE = '22023'; END IF;
  IF v_new THEN
    a.id := gen_random_uuid(); a.college_id := v_c; a.status := 'DRAFT'; a.version := 1; a.created_by := v_user; a.created_by_role := v_role; a.priority := 'NORMAL'; a.display_mode := 'SUMMARY';
    a.stages := '[]'::jsonb; a.batches := '[]'::jsonb; a.created_at := now();
  ELSE
    SELECT * INTO a FROM announcements WHERE id = p_id AND college_id = v_c FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Announcement not found.' USING ERRCODE = '22023'; END IF;
    IF v_role = 'COORDINATOR' AND a.created_by <> v_user THEN RAISE EXCEPTION 'You can edit only announcements you created.' USING ERRCODE = '42501'; END IF;
    IF a.status = 'ARCHIVED' THEN RAISE EXCEPTION 'An archived announcement cannot be edited.' USING ERRCODE = '22023'; END IF;
    v_pub := (a.status = 'PUBLISHED');
    IF v_pub AND (v_reason IS NULL OR length(v_reason) < 5) THEN RAISE EXCEPTION 'Say why you are changing a published announcement (at least 5 characters).' USING ERRCODE = '22023'; END IF;
  END IF;

  IF p_fields ? 'kind' THEN
    IF v_pub AND p_fields->>'kind' IS DISTINCT FROM a.kind THEN RAISE EXCEPTION 'The type of a published announcement cannot change.' USING ERRCODE = '22023'; END IF;
    a.kind := p_fields->>'kind';
  END IF;
  IF a.kind IS NULL OR a.kind NOT IN ('ON_CAMPUS_DRIVE', 'INTERVIEW_SCHEDULE', 'RECRUITMENT_UPDATE', 'TRAINING_VENUE', 'SHORTLIST_UPDATE', 'ALTERNATE_ROLE_CONSENT', 'REGISTRATION_REMINDER', 'PLACEMENT_INSTRUCTIONS', 'GENERAL') THEN
    RAISE EXCEPTION 'Choose the type of announcement.' USING ERRCODE = '22023';
  END IF;
  IF p_fields ? 'title' THEN a.title := btrim(coalesce(p_fields->>'title', '')); END IF;
  IF a.title IS NULL OR length(a.title) NOT BETWEEN 3 AND 150 THEN RAISE EXCEPTION 'The title must be 3 to 150 characters.' USING ERRCODE = '22023'; END IF;
  IF p_fields ? 'company_name' THEN a.company_name := nullif(btrim(coalesce(p_fields->>'company_name', '')), ''); END IF;
  IF p_fields ? 'original_message' THEN a.original_message := nullif(btrim(coalesce(p_fields->>'original_message', '')), ''); END IF;
  IF p_fields ? 'summary' THEN a.summary := nullif(btrim(coalesce(p_fields->>'summary', '')), ''); END IF;
  IF p_fields ? 'event_time' THEN a.event_time := nullif(btrim(coalesce(p_fields->>'event_time', '')), ''); END IF;
  IF p_fields ? 'venue' THEN a.venue := nullif(btrim(coalesce(p_fields->>'venue', '')), ''); END IF;
  IF p_fields ? 'instructions' THEN a.instructions := nullif(btrim(coalesce(p_fields->>'instructions', '')), ''); END IF;
  IF p_fields ? 'action_link' THEN a.action_link := nullif(btrim(coalesce(p_fields->>'action_link', '')), ''); END IF;
  IF a.company_name IS NOT NULL AND length(a.company_name) > 120 THEN RAISE EXCEPTION 'The company name is too long.' USING ERRCODE = '22023'; END IF;
  IF a.original_message IS NOT NULL AND length(a.original_message) > 20000 THEN RAISE EXCEPTION 'The original message is too long (20000 characters at most).' USING ERRCODE = '22023'; END IF;
  IF a.summary IS NOT NULL AND length(a.summary) > 5000 THEN RAISE EXCEPTION 'The summary is too long (5000 characters at most).' USING ERRCODE = '22023'; END IF;
  IF a.event_time IS NOT NULL AND length(a.event_time) > 40 THEN RAISE EXCEPTION 'The time is too long.' USING ERRCODE = '22023'; END IF;
  IF a.venue IS NOT NULL AND length(a.venue) > 200 THEN RAISE EXCEPTION 'The venue is too long.' USING ERRCODE = '22023'; END IF;
  IF a.instructions IS NOT NULL AND length(a.instructions) > 3000 THEN RAISE EXCEPTION 'The instructions are too long.' USING ERRCODE = '22023'; END IF;
  IF a.action_link IS NOT NULL AND a.action_link !~ '^https?://[^[:space:]]{3,500}$' THEN RAISE EXCEPTION 'Enter a full link starting with http:// or https://.' USING ERRCODE = '22023'; END IF;
  IF p_fields ? 'priority' THEN a.priority := p_fields->>'priority'; END IF;
  IF a.priority IS NULL OR a.priority NOT IN ('NORMAL', 'HIGH', 'URGENT') THEN RAISE EXCEPTION 'Choose a priority.' USING ERRCODE = '22023'; END IF;
  IF p_fields ? 'display_mode' THEN a.display_mode := p_fields->>'display_mode'; END IF;
  IF a.display_mode IS NULL OR a.display_mode NOT IN ('SUMMARY', 'ORIGINAL', 'BOTH') THEN RAISE EXCEPTION 'Choose what students will see.' USING ERRCODE = '22023'; END IF;
  BEGIN
    IF p_fields ? 'event_date' THEN a.event_date := nullif(btrim(coalesce(p_fields->>'event_date', '')), '')::date; END IF;
    IF p_fields ? 'consent_deadline' THEN a.consent_deadline := nullif(btrim(coalesce(p_fields->>'consent_deadline', '')), '')::timestamptz; END IF;
    IF p_fields ? 'expires_at' THEN a.expires_at := nullif(btrim(coalesce(p_fields->>'expires_at', '')), '')::timestamptz; END IF;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'Enter valid dates.' USING ERRCODE = '22023';
  END;
  IF a.event_date IS NOT NULL AND a.event_date NOT BETWEEN date '2000-01-01' AND date '2100-12-31' THEN RAISE EXCEPTION 'Enter a valid event date.' USING ERRCODE = '22023'; END IF;
  IF p_fields ? 'stages' THEN
    IF jsonb_typeof(p_fields->'stages') <> 'array' OR jsonb_array_length(p_fields->'stages') > 15 THEN RAISE EXCEPTION 'Up to 15 recruitment stages.' USING ERRCODE = '22023'; END IF;
    a.stages := '[]'::jsonb;
    FOR v_text IN SELECT jsonb_array_elements_text(p_fields->'stages') LOOP
      IF length(btrim(v_text)) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Each recruitment stage must be 1 to 120 characters.' USING ERRCODE = '22023'; END IF;
      a.stages := a.stages || to_jsonb(btrim(v_text));
    END LOOP;
  END IF;
  IF p_fields ? 'batches' THEN
    IF jsonb_typeof(p_fields->'batches') <> 'array' OR jsonb_array_length(p_fields->'batches') > 20 THEN RAISE EXCEPTION 'Up to 20 batches.' USING ERRCODE = '22023'; END IF;
    a.batches := '[]'::jsonb;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_fields->'batches') LOOP
      IF jsonb_typeof(v_item) <> 'object' OR length(btrim(coalesce(v_item->>'name', ''))) NOT BETWEEN 1 AND 80 OR length(btrim(coalesce(v_item->>'venue', ''))) NOT BETWEEN 1 AND 200 OR length(coalesce(v_item->>'note', '')) > 300 THEN
        RAISE EXCEPTION 'Each batch needs a name (80 characters at most) and its own venue (200 at most).' USING ERRCODE = '22023';
      END IF;
      a.batches := a.batches || jsonb_build_object('name', btrim(v_item->>'name'), 'venue', btrim(v_item->>'venue'), 'note', nullif(btrim(coalesce(v_item->>'note', '')), ''));
    END LOOP;
    IF (SELECT count(DISTINCT lower(e->>'name')) FROM jsonb_array_elements(a.batches) e) <> jsonb_array_length(a.batches) THEN RAISE EXCEPTION 'Two batches have the same name.' USING ERRCODE = '22023'; END IF;
  END IF;
  IF p_fields ? 'drive_id' THEN
    BEGIN a.drive_id := nullif(btrim(coalesce(p_fields->>'drive_id', '')), '')::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Choose a valid drive.' USING ERRCODE = '22023'; END;
    IF a.drive_id IS NOT NULL AND (v_new OR a.drive_id IS DISTINCT FROM (SELECT drive_id FROM announcements WHERE id = a.id)) AND NOT announcements.can_link_drive(a.drive_id) THEN
      RAISE EXCEPTION 'You cannot link to that drive.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_audience IS NOT NULL THEN
    v_aud := announcements.clean_audience(p_audience);
    IF v_pub THEN
      SELECT audience INTO v_stored FROM announcement_audiences WHERE announcement_id = a.id;
      IF v_aud IS DISTINCT FROM v_stored THEN RAISE EXCEPTION 'The audience of a published announcement cannot be changed. Publish a new announcement for other students.' USING ERRCODE = '22023'; END IF;
      v_aud := NULL;
    END IF;
  END IF;

  a.updated_at := now();
  IF v_new THEN
    INSERT INTO announcements SELECT a.*;
    PERFORM auth.write_audit('COLLEGE', v_c, v_user, v_role, 'ANNOUNCEMENT_CREATED', 'announcement', a.id::text, jsonb_build_object('kind', a.kind), NULL);
  ELSE
    IF v_pub THEN a.version := a.version + 1; END IF;
    UPDATE announcements SET kind = a.kind, title = a.title, company_name = a.company_name, drive_id = a.drive_id, original_message = a.original_message, summary = a.summary, event_date = a.event_date,
      event_time = a.event_time, venue = a.venue, instructions = a.instructions, consent_deadline = a.consent_deadline, action_link = a.action_link, priority = a.priority, display_mode = a.display_mode,
      stages = a.stages, batches = a.batches, expires_at = a.expires_at, version = a.version, updated_at = a.updated_at WHERE id = a.id;
    PERFORM auth.write_audit('COLLEGE', v_c, v_user, v_role, 'ANNOUNCEMENT_UPDATED', 'announcement', a.id::text, jsonb_build_object('version', a.version, 'published', v_pub), NULL);
  END IF;
  IF v_aud IS NOT NULL THEN
    INSERT INTO announcement_audiences (announcement_id, college_id, audience) VALUES (a.id, v_c, v_aud) ON CONFLICT (announcement_id) DO UPDATE SET audience = EXCLUDED.audience;
  END IF;
  IF v_pub THEN
    SELECT full_name INTO v_name FROM users WHERE id = v_user;
    IF p_notify IS TRUE THEN v_n := announcements.notify_recipients(a, 'Updated: '); END IF;
    INSERT INTO announcement_versions (college_id, announcement_id, version, snapshot, reason, edited_by, edited_by_name, recipients_count, renotified)
    VALUES (v_c, a.id, a.version, announcements.snapshot(a), v_reason, v_user, coalesce(v_name, 'Unknown'), (SELECT count(*) FROM announcement_recipients WHERE announcement_id = a.id), p_notify IS TRUE);
  END IF;
  RETURN a.id;
END $$;

-- ── publish: DRAFT -> PUBLISHED. Freezes the audience into recipients and notifies them (once). ──
CREATE FUNCTION announcements.publish(p_id uuid) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_role text := app.current_role();
  a announcements%ROWTYPE; v_aud jsonb; v_n int; v_name text;
BEGIN
  IF v_user IS NULL OR v_c IS NULL OR v_role NOT IN ('PLACEMENT_OFFICER', 'COORDINATOR') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM announcements WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Announcement not found.' USING ERRCODE = '22023'; END IF;
  IF v_role = 'COORDINATOR' AND a.created_by <> v_user THEN RAISE EXCEPTION 'You can publish only announcements you created.' USING ERRCODE = '42501'; END IF;
  IF a.status <> 'DRAFT' THEN RAISE EXCEPTION 'Only a draft can be published.' USING ERRCODE = '22023'; END IF;
  SELECT audience INTO v_aud FROM announcement_audiences WHERE announcement_id = a.id;
  IF v_aud IS NULL THEN RAISE EXCEPTION 'Choose who should receive this before publishing.' USING ERRCODE = '22023'; END IF;
  v_aud := announcements.clean_audience(v_aud);                      -- scope is checked again now (a coordinator's assignment may have ended)
  IF a.drive_id IS NOT NULL AND NOT announcements.can_link_drive(a.drive_id) THEN RAISE EXCEPTION 'You can no longer link to that drive.' USING ERRCODE = '42501'; END IF;
  IF v_aud->>'source' = 'NAMED' AND coalesce((v_aud->>'named_confirmed') = 'true', false) IS NOT TRUE THEN RAISE EXCEPTION 'Confirm the list of named students before publishing.' USING ERRCODE = '22023'; END IF;

  IF a.display_mode = 'SUMMARY' AND a.summary IS NULL THEN RAISE EXCEPTION 'Write the summary students will see, or choose to show the original message.' USING ERRCODE = '22023'; END IF;
  IF a.display_mode = 'ORIGINAL' AND a.original_message IS NULL THEN RAISE EXCEPTION 'Paste the original message, or choose to show the summary.' USING ERRCODE = '22023'; END IF;
  IF a.display_mode = 'BOTH' AND a.summary IS NULL AND a.original_message IS NULL THEN RAISE EXCEPTION 'The announcement has no content.' USING ERRCODE = '22023'; END IF;
  IF a.kind IN ('ON_CAMPUS_DRIVE', 'INTERVIEW_SCHEDULE') AND a.event_date IS NULL THEN RAISE EXCEPTION 'Enter the date of the event.' USING ERRCODE = '22023'; END IF;
  IF a.kind = 'TRAINING_VENUE' AND a.venue IS NULL AND jsonb_array_length(a.batches) = 0 THEN RAISE EXCEPTION 'Enter the venue, or the venue of each batch.' USING ERRCODE = '22023'; END IF;
  IF a.kind = 'ALTERNATE_ROLE_CONSENT' THEN
    IF a.consent_deadline IS NULL THEN RAISE EXCEPTION 'Enter the consent deadline.' USING ERRCODE = '22023'; END IF;
    IF v_aud->>'source' NOT IN ('NAMED', 'DRIVE_SHORTLISTED') THEN RAISE EXCEPTION 'An alternate-role message goes only to named students or the shortlisted students of a drive.' USING ERRCODE = '22023'; END IF;
  END IF;
  IF a.consent_deadline IS NOT NULL AND a.consent_deadline <= now() THEN RAISE EXCEPTION 'The consent deadline has already passed.' USING ERRCODE = '22023'; END IF;
  IF a.expires_at IS NOT NULL AND a.expires_at <= now() THEN RAISE EXCEPTION 'The expiry time has already passed.' USING ERRCODE = '22023'; END IF;

  INSERT INTO announcement_recipients (announcement_id, college_id, student_id, user_id)
  SELECT a.id, v_c, r.student_id, r.user_id FROM announcements.resolve(v_aud) r WHERE r.user_id IS NOT NULL
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'No students with an account match this audience.' USING ERRCODE = '22023'; END IF;

  UPDATE announcements SET status = 'PUBLISHED', published_at = now(), updated_at = now() WHERE id = a.id RETURNING * INTO a;
  SELECT full_name INTO v_name FROM users WHERE id = v_user;
  INSERT INTO announcement_versions (college_id, announcement_id, version, snapshot, reason, edited_by, edited_by_name, recipients_count, renotified)
  VALUES (v_c, a.id, a.version, announcements.snapshot(a), NULL, v_user, coalesce(v_name, 'Unknown'), v_n, true);
  PERFORM announcements.notify_recipients(a, CASE a.priority WHEN 'URGENT' THEN 'Urgent: ' WHEN 'HIGH' THEN 'Important: ' ELSE '' END);
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, v_role, 'ANNOUNCEMENT_PUBLISHED', 'announcement', a.id::text, jsonb_build_object('kind', a.kind, 'recipients', v_n, 'source', v_aud->>'source'), NULL);
  RETURN v_n;
END $$;

CREATE FUNCTION announcements.archive(p_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_role text := app.current_role(); a announcements%ROWTYPE;
BEGIN
  IF v_user IS NULL OR v_c IS NULL OR v_role NOT IN ('PLACEMENT_OFFICER', 'COORDINATOR') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM announcements WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Announcement not found.' USING ERRCODE = '22023'; END IF;
  IF v_role = 'COORDINATOR' AND a.created_by <> v_user THEN RAISE EXCEPTION 'You can archive only announcements you created.' USING ERRCODE = '42501'; END IF;
  IF a.status = 'ARCHIVED' THEN RAISE EXCEPTION 'Already archived.' USING ERRCODE = '22023'; END IF;
  UPDATE announcements SET status = 'ARCHIVED', archived_at = now(), updated_at = now() WHERE id = a.id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, v_role, 'ANNOUNCEMENT_ARCHIVED', 'announcement', a.id::text, jsonb_build_object('was', a.status), NULL);
END $$;

-- A student opening an announcement addressed to them marks it seen (once).
CREATE FUNCTION announcements.mark_seen(p_id uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_n int;
BEGIN
  IF v_user IS NULL OR v_c IS NULL OR app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  UPDATE announcement_recipients SET seen_at = now() WHERE announcement_id = p_id AND college_id = v_c AND user_id = v_user AND seen_at IS NULL
     AND EXISTS (SELECT 1 FROM announcements a WHERE a.id = p_id AND a.status = 'PUBLISHED');
  GET DIAGNOSTICS v_n = ROW_COUNT; RETURN v_n > 0;
END $$;

-- How many students an audience would reach (for the editor, before saving). Counts only; never names.
CREATE FUNCTION announcements.audience_count(p_audience jsonb) RETURNS TABLE (total int, with_account int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_aud jsonb;
BEGIN
  IF app.current_user_id() IS NULL OR app.current_role() NOT IN ('PLACEMENT_OFFICER', 'COORDINATOR') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  v_aud := announcements.clean_audience(p_audience);
  RETURN QUERY SELECT count(*)::int, (count(*) FILTER (WHERE r.user_id IS NOT NULL))::int FROM announcements.resolve(v_aud) r;
END $$;

-- Drives the caller may link an announcement to or address by drive.
CREATE FUNCTION announcements.linkable_drives() RETURNS TABLE (id uuid, company_name text, job_title text, status text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT d.id, d.company_name::text, d.job_title::text, d.status::text FROM drives d
   WHERE d.college_id = app.current_college_id() AND app.current_role() IN ('PLACEMENT_OFFICER', 'COORDINATOR') AND announcements.can_link_drive(d.id)
   ORDER BY d.created_at DESC LIMIT 200
$$;

-- Audience size and read counts of one announcement, for its author, any placement officer and the administrator.
CREATE FUNCTION announcements.engagement(p_id uuid) RETURNS TABLE (recipients int, seen int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_role text := app.current_role(); a announcements%ROWTYPE;
BEGIN
  SELECT * INTO a FROM announcements WHERE id = p_id AND college_id = v_c;
  IF NOT FOUND OR v_role NOT IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN', 'COORDINATOR') OR (v_role = 'COORDINATOR' AND a.created_by <> app.current_user_id()) THEN RETURN; END IF;
  RETURN QUERY SELECT count(*)::int, (count(*) FILTER (WHERE r.seen_at IS NOT NULL))::int FROM announcement_recipients r WHERE r.announcement_id = p_id;
END $$;

-- Match register numbers typed by staff against the college's students (for a named audience). Returns only matches; a coordinator only
-- ever matches students of their assigned departments. Officers cannot otherwise read students, so this is deliberately narrow: at most 500 numbers per call.
CREATE FUNCTION announcements.match_students(p_numbers text[]) RETURNS TABLE (register_number text, student_id uuid, full_name text, department_code text, has_account boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_role text := app.current_role(); v_mine uuid[] := announcements.my_departments();
BEGIN
  IF app.current_user_id() IS NULL OR v_c IS NULL OR v_role NOT IN ('PLACEMENT_OFFICER', 'COORDINATOR') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF p_numbers IS NULL OR cardinality(p_numbers) > 500 THEN RAISE EXCEPTION 'Match at most 500 register numbers at a time.' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
    SELECT st.register_number::text, st.id, st.full_name::text, d.code::text, (st.user_id IS NOT NULL)
      FROM students st JOIN departments d ON d.id = st.department_id
     WHERE st.college_id = v_c AND upper(st.register_number::text) IN (SELECT upper(btrim(n)) FROM unnest(p_numbers) n)
       AND (v_role = 'PLACEMENT_OFFICER' OR st.department_id = ANY (v_mine))
     ORDER BY st.register_number;
END $$;

-- The named students of one announcement (for its editor): register number, name, department. Same visibility as the announcement itself.
CREATE FUNCTION announcements.named_students(p_id uuid) RETURNS TABLE (register_number text, student_id uuid, full_name text, department_code text, has_account boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_role text := app.current_role(); a announcements%ROWTYPE; v_ids uuid[];
BEGIN
  SELECT * INTO a FROM announcements WHERE id = p_id AND college_id = v_c;
  IF NOT FOUND OR v_role NOT IN ('PLACEMENT_OFFICER', 'COORDINATOR') OR (v_role = 'COORDINATOR' AND a.created_by <> app.current_user_id()) THEN RETURN; END IF;
  SELECT ARRAY(SELECT (e)::uuid FROM announcement_audiences au, jsonb_array_elements_text(coalesce(au.audience->'students', '[]'::jsonb)) e WHERE au.announcement_id = p_id) INTO v_ids;
  RETURN QUERY
    SELECT st.register_number::text, st.id, st.full_name::text, d.code::text, (st.user_id IS NOT NULL)
      FROM students st JOIN departments d ON d.id = st.department_id WHERE st.college_id = v_c AND st.id = ANY (v_ids) ORDER BY st.register_number;
END $$;

RESET ROLE;
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'announcements' AND p.proname NOT LIKE 'guard%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION announcements.guard(), announcements.guard_audience(), announcements.guard_versions(), announcements.guard_recipients() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION announcements.save(uuid, jsonb, jsonb, text, boolean), announcements.publish(uuid), announcements.archive(uuid), announcements.mark_seen(uuid),
  announcements.audience_count(jsonb), announcements.linkable_drives(), announcements.engagement(uuid), announcements.match_students(text[]), announcements.named_students(uuid) TO cc_app;
-- my_departments, can_link_drive, clean_audience, resolve, snapshot and notify_recipients are internal.
REVOKE CREATE ON SCHEMA announcements FROM cc_auth;
REVOKE CREATE ON SCHEMA notifications FROM cc_auth;
