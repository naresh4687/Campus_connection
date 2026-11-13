-- 0014_notifications: in-app notifications (inbox, read state, per-category preferences, deep links).
-- Notifications are created ONLY by database triggers on the workflow history tables, so no code path can forget to send one and no client can
-- forge one. Each user sees only their own. Email delivery is not built (TD-12); nothing here sends anything outside the application.

CREATE SCHEMA notifications; REVOKE ALL ON SCHEMA notifications FROM PUBLIC; GRANT USAGE ON SCHEMA notifications TO cc_app; GRANT USAGE, CREATE ON SCHEMA notifications TO cc_auth;

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  user_id    uuid NOT NULL,
  category   text NOT NULL CHECK (category IN ('DRIVES', 'ROUNDS', 'OFFERS', 'PLACEMENT', 'ACADEMICS', 'DOCUMENTS', 'TASKS')),
  title      text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 150),
  body       text CHECK (body IS NULL OR char_length(body) <= 300),
  -- deep links are relative application paths only: never an external URL
  link       text CHECK (link IS NULL OR (link ~ '^/[A-Za-z0-9/_?=&.%-]*$' AND link !~ '^//' AND char_length(link) <= 200)),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz,
  FOREIGN KEY (college_id, user_id) REFERENCES users (college_id, id)
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC, id);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE notification_preferences (
  college_id uuid NOT NULL,
  user_id    uuid NOT NULL,
  category   text NOT NULL CHECK (category IN ('DRIVES', 'ROUNDS', 'OFFERS', 'PLACEMENT', 'ACADEMICS', 'DOCUMENTS', 'TASKS')),
  enabled    boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category),
  FOREIGN KEY (college_id, user_id) REFERENCES users (college_id, id)
);

-- Content never changes; the only allowed change is marking a notification read (once).
CREATE FUNCTION notifications.guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'notifications are retained' USING ERRCODE = '42501'; END IF;
  IF (NEW.id, NEW.college_id, NEW.user_id, NEW.category, NEW.title, NEW.body, NEW.link, NEW.created_at) IS DISTINCT FROM (OLD.id, OLD.college_id, OLD.user_id, OLD.category, OLD.title, OLD.body, OLD.link, OLD.created_at) THEN
    RAISE EXCEPTION 'a notification cannot be edited' USING ERRCODE = '42501';
  END IF;
  IF OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN RAISE EXCEPTION 'a notification is already read' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER notifications_guard BEFORE UPDATE OR DELETE ON notifications FOR EACH ROW EXECUTE FUNCTION notifications.guard();

GRANT SELECT, INSERT, UPDATE ON notifications TO cc_auth;
GRANT SELECT, INSERT, UPDATE ON notification_preferences TO cc_auth;
GRANT SELECT ON notifications, notification_preferences TO cc_app;
ALTER TABLE notifications            ENABLE ROW LEVEL SECURITY; ALTER TABLE notifications            FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY; ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY notifications_own ON notifications FOR SELECT TO cc_app USING (user_id = (SELECT app.current_user_id()) AND college_id = (SELECT app.current_college_id()));
CREATE POLICY prefs_own ON notification_preferences FOR SELECT TO cc_app USING (user_id = (SELECT app.current_user_id()) AND college_id = (SELECT app.current_college_id()));

-- Offers and placement outcomes are deadlines/decisions that matter: they cannot be switched off.
CREATE FUNCTION notifications.is_essential(p_category text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT p_category IN ('OFFERS', 'PLACEMENT') $$;

-- Internal delivery: active users of the college only, respecting opt-outs for non-essential categories.
CREATE FUNCTION notifications.push_many(p_college uuid, p_users uuid[], p_category text, p_title text, p_body text, p_link text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO notifications (college_id, user_id, category, title, body, link)
  SELECT p_college, u.id, p_category, left(p_title, 150), left(p_body, 300), p_link
    FROM users u
   WHERE u.id = ANY (p_users) AND u.college_id = p_college AND u.status = 'ACTIVE'
     AND (notifications.is_essential(p_category) OR NOT EXISTS (SELECT 1 FROM notification_preferences np WHERE np.user_id = u.id AND np.category = p_category AND NOT np.enabled))
$$;

CREATE FUNCTION notifications.officers(p_college uuid) RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(array_agg(id), '{}') FROM users WHERE college_id = p_college AND role = 'PLACEMENT_OFFICER' AND status = 'ACTIVE'
$$;
CREATE FUNCTION notifications.coordinators_of(p_college uuid, p_department uuid) RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(array_agg(DISTINCT ca.user_id), '{}') FROM coordinator_assignments ca WHERE ca.college_id = p_college AND ca.department_id = p_department AND ca.ended_at IS NULL
$$;

-- ── triggers ──
-- A drive is published for the first time: students whose department, passing year and degree match the drive's identity criteria.
CREATE FUNCTION notifications.on_drive() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_users uuid[]; c drive_criteria%ROWTYPE;
BEGIN
  IF NEW.status = 'PUBLISHED' AND OLD.status IS DISTINCT FROM 'PUBLISHED' AND OLD.published_at IS NULL THEN
    SELECT * INTO c FROM drive_criteria WHERE drive_id = NEW.id;
    SELECT coalesce(array_agg(st.user_id), '{}') INTO v_users FROM students st
     WHERE st.college_id = NEW.college_id AND st.user_id IS NOT NULL AND st.department_id IN (SELECT department_id FROM drive_departments WHERE drive_id = NEW.id)
       AND st.passing_year = ANY (c.passing_years) AND (cardinality(c.degrees) = 0 OR st.degree = ANY (c.degrees));
    PERFORM notifications.push_many(NEW.college_id, v_users, 'DRIVES', 'New placement drive: ' || NEW.job_title, NEW.company_name || '. Check your eligibility and register before the deadline.', '/student/drives/' || NEW.id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER drives_notify AFTER UPDATE OF status ON drives FOR EACH ROW EXECUTE FUNCTION notifications.on_drive();

-- A round is scheduled (registered students) or released (students who have a result in it).
CREATE FUNCTION notifications.on_round() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE d drives%ROWTYPE; v_users uuid[];
BEGIN
  SELECT * INTO d FROM drives WHERE id = NEW.drive_id;
  IF TG_OP = 'INSERT' THEN
    SELECT coalesce(array_agg(st.user_id), '{}') INTO v_users FROM registrations r JOIN students st ON st.id = r.student_id WHERE r.drive_id = NEW.drive_id AND r.status = 'REGISTERED' AND st.user_id IS NOT NULL;
    PERFORM notifications.push_many(NEW.college_id, v_users, 'ROUNDS', 'Round ' || NEW.round_number || ' announced: ' || NEW.name, d.job_title || ' at ' || d.company_name, '/student/drives/' || NEW.drive_id);
  ELSIF OLD.released_at IS NULL AND NEW.released_at IS NOT NULL THEN
    SELECT coalesce(array_agg(st.user_id), '{}') INTO v_users FROM round_results rr JOIN registrations r ON r.id = rr.registration_id JOIN students st ON st.id = r.student_id WHERE rr.round_id = NEW.id AND st.user_id IS NOT NULL;
    PERFORM notifications.push_many(NEW.college_id, v_users, 'ROUNDS', 'Results released: ' || NEW.name, d.job_title || ' at ' || d.company_name || '. Open the drive to see your result.', '/student/drives/' || NEW.drive_id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER rounds_notify AFTER INSERT OR UPDATE OF released_at ON drive_rounds FOR EACH ROW EXECUTE FUNCTION notifications.on_round();

-- Selection, offer and placement events.
CREATE FUNCTION notifications.on_selection_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE s selections%ROWTYPE; d drives%ROWTYPE; v_student uuid; v_name text; v_what text;
BEGIN
  SELECT * INTO s FROM selections WHERE id = NEW.selection_id;
  SELECT * INTO d FROM drives WHERE id = s.drive_id;
  SELECT user_id, full_name INTO v_student, v_name FROM students WHERE id = s.student_id;
  v_what := d.job_title || ' at ' || d.company_name;
  CASE NEW.event
    WHEN 'SELECTED' THEN PERFORM notifications.push_many(NEW.college_id, ARRAY[v_student], 'OFFERS', 'You have been selected', v_what || '. The placement office will issue your offer.', '/student/offers/' || s.id);
    WHEN 'OFFER_ISSUED' THEN PERFORM notifications.push_many(NEW.college_id, ARRAY[v_student], 'OFFERS', 'You have received an offer', v_what || '. Respond before the deadline.', '/student/offers/' || s.id);
    WHEN 'DEADLINE_EXTENDED' THEN PERFORM notifications.push_many(NEW.college_id, ARRAY[v_student], 'OFFERS', 'Offer response deadline extended', v_what, '/student/offers/' || s.id);
    WHEN 'WITHDRAWN' THEN PERFORM notifications.push_many(NEW.college_id, ARRAY[v_student], 'OFFERS', 'Your offer was withdrawn', v_what || '. Open the offer to see the reason.', '/student/offers/' || s.id);
    WHEN 'ACCEPTED' THEN PERFORM notifications.push_many(NEW.college_id, notifications.officers(NEW.college_id), 'TASKS', v_name || ' accepted the offer', v_what, '/placement/drives/' || s.drive_id || '/offers');
    WHEN 'DECLINED' THEN PERFORM notifications.push_many(NEW.college_id, notifications.officers(NEW.college_id), 'TASKS', v_name || ' declined the offer', v_what, '/placement/drives/' || s.drive_id || '/offers');
    WHEN 'JOINING_RECORDED' THEN PERFORM notifications.push_many(NEW.college_id, notifications.officers(NEW.college_id), 'TASKS', 'Joining awaiting verification: ' || v_name, v_what, '/placement/placements');
    WHEN 'PLACEMENT_VERIFIED' THEN PERFORM notifications.push_many(NEW.college_id, ARRAY[v_student], 'PLACEMENT', 'Your placement was verified', v_what, '/student/offers/' || s.id);
    WHEN 'OVERRIDE_VERIFIED' THEN PERFORM notifications.push_many(NEW.college_id, ARRAY[v_student], 'PLACEMENT', 'Your placement was verified', v_what, '/student/offers/' || s.id);
    WHEN 'PLACEMENT_REJECTED' THEN PERFORM notifications.push_many(NEW.college_id, ARRAY[v_student], 'PLACEMENT', 'Your joining record was not verified', 'Open the offer to see the reason and submit a correction.', '/student/offers/' || s.id);
    WHEN 'OVERRIDE_REJECTED' THEN PERFORM notifications.push_many(NEW.college_id, ARRAY[v_student], 'PLACEMENT', 'Your joining record was not verified', 'Open the offer to see the reason.', '/student/offers/' || s.id);
    ELSE NULL;
  END CASE;
  RETURN NULL;
END $$;
CREATE TRIGGER selection_events_notify AFTER INSERT ON selection_events FOR EACH ROW EXECUTE FUNCTION notifications.on_selection_event();

-- Academic submissions: coordinators of the department are told of a new submission; the student of the decision.
CREATE FUNCTION notifications.on_academic() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE st students%ROWTYPE;
BEGIN
  SELECT * INTO st FROM students WHERE id = NEW.student_id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'SUBMITTED' THEN PERFORM notifications.push_many(NEW.college_id, notifications.coordinators_of(NEW.college_id, st.department_id), 'TASKS', 'Academic record awaiting review: ' || st.full_name, 'Version ' || NEW.version, '/coordinator/verification'); END IF;
  ELSIF OLD.status = 'SUBMITTED' AND NEW.status = 'VERIFIED' THEN PERFORM notifications.push_many(NEW.college_id, ARRAY[st.user_id], 'ACADEMICS', 'Your academic record was verified', 'You can now be evaluated for placement drives.', '/student/academics');
  ELSIF OLD.status = 'SUBMITTED' AND NEW.status = 'REJECTED' THEN PERFORM notifications.push_many(NEW.college_id, ARRAY[st.user_id], 'ACADEMICS', 'Your academic record needs correction', 'Open Academics to read the reason and resubmit.', '/student/academics');
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER academics_notify AFTER INSERT OR UPDATE OF status ON academic_submissions FOR EACH ROW EXECUTE FUNCTION notifications.on_academic();

-- Documents needing review (coordinators) and review outcomes (student).
CREATE FUNCTION notifications.on_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE st students%ROWTYPE;
BEGIN
  SELECT * INTO st FROM students WHERE id = NEW.student_id;
  IF TG_OP = 'INSERT' THEN
    IF NEW.review_status = 'PENDING' THEN PERFORM notifications.push_many(NEW.college_id, notifications.coordinators_of(NEW.college_id, st.department_id), 'TASKS', 'Document awaiting review: ' || st.full_name, NULL, '/coordinator/documents'); END IF;
  ELSIF OLD.review_status = 'PENDING' AND NEW.review_status = 'VERIFIED' THEN PERFORM notifications.push_many(NEW.college_id, ARRAY[st.user_id], 'DOCUMENTS', 'A document was verified', NULL, '/student/documents');
  ELSIF OLD.review_status = 'PENDING' AND NEW.review_status = 'REJECTED' THEN PERFORM notifications.push_many(NEW.college_id, ARRAY[st.user_id], 'DOCUMENTS', 'A document was rejected', 'Open Documents to read the reason.', '/student/documents');
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER documents_notify AFTER INSERT OR UPDATE OF review_status ON documents FOR EACH ROW EXECUTE FUNCTION notifications.on_document();

-- ── user-facing functions (own rows only) ──
CREATE FUNCTION notifications.mark_read(p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_n int;
BEGIN
  IF v_u IS NULL OR v_c IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  UPDATE notifications SET read_at = now() WHERE id = p_id AND user_id = v_u AND college_id = v_c AND read_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; RETURN v_n > 0;
END $$;
CREATE FUNCTION notifications.mark_all_read() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_n int;
BEGIN
  IF v_u IS NULL OR v_c IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  UPDATE notifications SET read_at = now() WHERE user_id = v_u AND college_id = v_c AND read_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; RETURN v_n;
END $$;
CREATE FUNCTION notifications.set_preference(p_category text, p_enabled boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid := app.current_user_id(); v_c uuid := app.current_college_id();
BEGIN
  IF v_u IS NULL OR v_c IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF p_category IS NULL OR p_category NOT IN ('DRIVES', 'ROUNDS', 'OFFERS', 'PLACEMENT', 'ACADEMICS', 'DOCUMENTS', 'TASKS') OR p_enabled IS NULL THEN RAISE EXCEPTION 'invalid preference' USING ERRCODE = '22023'; END IF;
  IF NOT p_enabled AND notifications.is_essential(p_category) THEN RAISE EXCEPTION 'Offer and placement notifications cannot be turned off.' USING ERRCODE = '22023'; END IF;
  INSERT INTO notification_preferences (college_id, user_id, category, enabled) VALUES (v_c, v_u, p_category, p_enabled)
  ON CONFLICT (user_id, category) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'notifications' AND p.proname NOT IN ('guard') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION notifications.mark_read(uuid), notifications.mark_all_read(), notifications.set_preference(text, boolean) TO cc_app;
REVOKE CREATE ON SCHEMA notifications FROM cc_auth;
