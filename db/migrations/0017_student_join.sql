-- 0017_student_join: one shareable sign-up link per college (for WhatsApp etc.) that lets students ASK for an account.
-- A request creates nothing usable: it waits for the college administrator or the coordinator of the chosen department, who approves
-- (creating the student record and an active account) or rejects. The link is a signed value built by the application; the database holds only
-- the on/off switch and a version number (rotating the version kills every older link). Passwords are hashed by the application and kept only
-- until the request is decided; the runtime role can never read them.

GRANT CREATE ON SCHEMA students TO cc_auth;      -- temporary; revoked at the end

CREATE TABLE college_join_links (
  college_id uuid PRIMARY KEY REFERENCES colleges (id),
  enabled    boolean NOT NULL DEFAULT false,
  version    int NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE join_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id      uuid NOT NULL,
  department_id   uuid NOT NULL,
  register_number citext NOT NULL CHECK (register_number::text ~ '^[A-Za-z0-9][A-Za-z0-9/._-]{2,29}$'),
  full_name       text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 120),
  college_email   citext NOT NULL CHECK (length(college_email::text) BETWEEN 3 AND 254 AND college_email::text ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  personal_email  citext CHECK (personal_email IS NULL OR (length(personal_email::text) BETWEEN 3 AND 254 AND personal_email::text ~ '^[^@[:space:]]+@[^@[:space:]]+$')),
  phone           text NOT NULL CHECK (phone ~ '^[0-9+() -]{7,20}$'),
  degree          text NOT NULL CHECK (degree IN ('B.E.', 'B.Tech', 'M.E.', 'M.Tech', 'MCA', 'MBA', 'B.Sc', 'M.Sc', 'Diploma', 'Other')),
  admission_year  int NOT NULL CHECK (admission_year BETWEEN 1990 AND 2100),
  passing_year    int NOT NULL CHECK (passing_year BETWEEN 1990 AND 2110),
  password_hash   text CHECK (password_hash IS NULL OR password_hash LIKE '$argon2id$%'),
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  student_id      uuid,
  decided_by      uuid REFERENCES users (id),
  decided_by_name text,
  decided_at      timestamptz,
  decision_reason text CHECK (decision_reason IS NULL OR length(decision_reason) <= 500),
  ip_hash         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, id),
  FOREIGN KEY (college_id, department_id) REFERENCES departments (college_id, id),
  CONSTRAINT join_passing_after_admission CHECK (passing_year > admission_year AND passing_year <= admission_year + 8),
  CONSTRAINT join_pending_has_password CHECK ((status = 'PENDING') = (password_hash IS NOT NULL)),
  CONSTRAINT join_decided CHECK ((status = 'PENDING') = (decided_at IS NULL)),
  CONSTRAINT join_rejected_reason CHECK (status <> 'REJECTED' OR length(btrim(coalesce(decision_reason, ''))) >= 5)
);
CREATE UNIQUE INDEX join_pending_register ON join_requests (college_id, register_number) WHERE status = 'PENDING';
CREATE UNIQUE INDEX join_pending_email ON join_requests (college_id, college_email) WHERE status = 'PENDING';
CREATE INDEX join_requests_college_idx ON join_requests (college_id, status, created_at DESC);

CREATE FUNCTION students.join_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'join requests are retained' USING ERRCODE = '42501'; END IF;
  IF OLD.status <> 'PENDING' THEN RAISE EXCEPTION 'a decided request cannot change' USING ERRCODE = '42501'; END IF;
  IF (NEW.college_id, NEW.department_id, NEW.register_number, NEW.college_email, NEW.full_name) IS DISTINCT FROM (OLD.college_id, OLD.department_id, OLD.register_number, OLD.college_email, OLD.full_name) THEN
    RAISE EXCEPTION 'request details cannot be edited' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER join_requests_guard BEFORE UPDATE OR DELETE ON join_requests FOR EACH ROW EXECUTE FUNCTION students.join_guard();

GRANT SELECT, INSERT, UPDATE ON college_join_links TO cc_auth;
GRANT SELECT, INSERT, UPDATE ON join_requests TO cc_auth;
GRANT INSERT, UPDATE ON students TO cc_auth;      -- already granted in 0005; harmless repeat
GRANT SELECT ON college_join_links TO cc_app;
-- the password hash and network hash are never readable by the runtime role
GRANT SELECT (id, college_id, department_id, register_number, full_name, college_email, personal_email, phone, degree, admission_year, passing_year, status, student_id, decided_by, decided_by_name, decided_at, decision_reason, created_at) ON join_requests TO cc_app;
ALTER TABLE college_join_links ENABLE ROW LEVEL SECURITY; ALTER TABLE college_join_links FORCE ROW LEVEL SECURITY;
ALTER TABLE join_requests      ENABLE ROW LEVEL SECURITY; ALTER TABLE join_requests      FORCE ROW LEVEL SECURITY;
CREATE POLICY join_links_admin ON college_join_links FOR SELECT TO cc_app USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) = 'COLLEGE_ADMIN');
CREATE POLICY join_requests_admin ON join_requests FOR SELECT TO cc_app USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) = 'COLLEGE_ADMIN');
CREATE POLICY join_requests_coordinator ON join_requests FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) = 'COORDINATOR'
         AND department_id IN (SELECT a.department_id FROM coordinator_assignments a WHERE a.user_id = app.current_user_id() AND a.ended_at IS NULL));

-- ───────────── administrator: the link switch ─────────────
CREATE FUNCTION students.join_link_state() RETURNS TABLE (enabled boolean, version int)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  INSERT INTO college_join_links (college_id, updated_by) VALUES (v_c, v_u) ON CONFLICT (college_id) DO NOTHING;
  RETURN QUERY SELECT l.enabled, l.version FROM college_join_links l WHERE l.college_id = v_c;
END $$;

CREATE FUNCTION students.set_join_link(p_enabled boolean, p_rotate boolean) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  IF p_enabled IS NULL OR p_rotate IS NULL THEN RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023'; END IF;
  INSERT INTO college_join_links (college_id, enabled, updated_by) VALUES (v_c, p_enabled, v_u)
  ON CONFLICT (college_id) DO UPDATE SET enabled = EXCLUDED.enabled, version = college_join_links.version + CASE WHEN p_rotate THEN 1 ELSE 0 END, updated_by = v_u, updated_at = now();
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', CASE WHEN p_rotate THEN 'JOIN_LINK_ROTATED' WHEN p_enabled THEN 'JOIN_LINK_ENABLED' ELSE 'JOIN_LINK_DISABLED' END, 'college', v_c::text, '{}'::jsonb, NULL);
END $$;

-- ───────────── public: what the join page shows, and the request itself ─────────────
CREATE FUNCTION students.peek_join(p_college uuid, p_version int) RETURNS TABLE (college_name text, departments jsonb)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT c.name::text,
         coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code::text, 'name', d.name::text) ORDER BY d.code) FROM departments d WHERE d.college_id = c.id AND d.status = 'ACTIVE'), '[]'::jsonb)
    FROM colleges c JOIN college_join_links l ON l.college_id = c.id
   WHERE c.id = p_college AND c.status = 'ACTIVE' AND l.enabled AND l.version = p_version
$$;

CREATE FUNCTION students.submit_join_request(p_college uuid, p_version int, p_dept uuid, p_register text, p_name text, p_email citext, p_personal citext, p_phone text,
                                             p_degree text, p_adm int, p_pass int, p_password_hash text, p_ip_hash text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid; v_email citext := lower(btrim(coalesce(p_email::text, ''))); v_reg text := btrim(coalesce(p_register, ''));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM colleges c JOIN college_join_links l ON l.college_id = c.id WHERE c.id = p_college AND c.status = 'ACTIVE' AND l.enabled AND l.version = p_version) THEN
    RAISE EXCEPTION 'This sign-up link is not active. Ask your college for a new one.' USING ERRCODE = '22023';
  END IF;
  IF p_password_hash IS NULL OR p_password_hash NOT LIKE '$argon2id$%' THEN RAISE EXCEPTION 'invalid password hash' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM departments WHERE id = p_dept AND college_id = p_college AND status = 'ACTIVE') THEN RAISE EXCEPTION 'Choose your department from the list.' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM join_requests WHERE college_id = p_college AND status = 'PENDING') >= 300 THEN RAISE EXCEPTION 'Too many requests are waiting for approval. Please try again later or contact your college.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM students WHERE college_id = p_college AND (register_number = v_reg::citext OR college_email = v_email))
     OR EXISTS (SELECT 1 FROM users WHERE email = v_email)
     OR EXISTS (SELECT 1 FROM join_requests WHERE college_id = p_college AND status = 'PENDING' AND (register_number = v_reg::citext OR college_email = v_email)) THEN
    RAISE EXCEPTION 'This register number or email already has an account or is waiting for approval. Try signing in, or contact your department.' USING ERRCODE = '23505';
  END IF;
  INSERT INTO join_requests (college_id, department_id, register_number, full_name, college_email, personal_email, phone, degree, admission_year, passing_year, password_hash, ip_hash)
  VALUES (p_college, p_dept, v_reg, btrim(coalesce(p_name, '')), v_email, nullif(lower(btrim(coalesce(p_personal::text, ''))), ''), btrim(coalesce(p_phone, '')), p_degree, p_adm, p_pass, p_password_hash, p_ip_hash)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION
  WHEN check_violation THEN RAISE EXCEPTION 'Some details are invalid. Check the register number, email, mobile number, degree and years.' USING ERRCODE = '22023';
  WHEN unique_violation THEN RAISE EXCEPTION 'This register number or email already has an account or is waiting for approval. Try signing in, or contact your department.' USING ERRCODE = '23505';
END $$;

-- ───────────── approval ─────────────
CREATE FUNCTION students.decide_join_request(p_id uuid, p_approve boolean, p_reason text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_role text := app.current_role(); v_name text; r join_requests%ROWTYPE; v_sid uuid; v_uid uuid;
        v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('COLLEGE_ADMIN', 'COORDINATOR') OR v_c IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023'; END IF;
  SELECT full_name INTO v_name FROM users WHERE id = v_user;
  SELECT * INTO r FROM join_requests WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found' USING ERRCODE = '22023'; END IF;
  IF v_role = 'COORDINATOR' AND NOT EXISTS (SELECT 1 FROM coordinator_assignments a WHERE a.user_id = v_user AND a.department_id = r.department_id AND a.college_id = v_c AND a.ended_at IS NULL) THEN
    RAISE EXCEPTION 'request not found' USING ERRCODE = '22023';       -- another department's request: indistinguishable from a missing one
  END IF;
  IF r.status <> 'PENDING' THEN RAISE EXCEPTION 'This request has already been decided.' USING ERRCODE = '22023'; END IF;
  IF NOT p_approve THEN
    IF v_reason IS NULL OR char_length(v_reason) < 5 THEN RAISE EXCEPTION 'Give a reason of at least 5 characters when rejecting.' USING ERRCODE = '22023'; END IF;
    UPDATE join_requests SET status = 'REJECTED', password_hash = NULL, decided_by = v_user, decided_by_name = v_name, decided_at = now(), decision_reason = v_reason WHERE id = p_id;
    PERFORM auth.write_audit('COLLEGE', v_c, v_user, v_role, 'JOIN_REQUEST_REJECTED', 'join_request', p_id::text, '{}'::jsonb, NULL);
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM departments WHERE id = r.department_id AND college_id = v_c AND status = 'ACTIVE') THEN RAISE EXCEPTION 'The department is not active. Reactivate it or reject the request.' USING ERRCODE = '22023'; END IF;
  BEGIN
    INSERT INTO users (college_id, email, full_name, password_hash, role) VALUES (v_c, r.college_email, r.full_name, r.password_hash, 'STUDENT') RETURNING id INTO v_uid;
    INSERT INTO students (college_id, department_id, user_id, register_number, full_name, college_email, personal_email, phone, degree, admission_year, passing_year, created_by)
    VALUES (v_c, r.department_id, v_uid, r.register_number, r.full_name, r.college_email, r.personal_email, r.phone, r.degree, r.admission_year, r.passing_year, v_user) RETURNING id INTO v_sid;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A student or user with this register number or email already exists, so this request cannot be approved. Reject it.' USING ERRCODE = '22023';
  END;
  UPDATE join_requests SET status = 'APPROVED', student_id = v_sid, password_hash = NULL, decided_by = v_user, decided_by_name = v_name, decided_at = now() WHERE id = p_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, v_role, 'JOIN_REQUEST_APPROVED', 'student', v_sid::text, '{}'::jsonb, NULL);
END $$;

-- Tell the department's coordinators and the college administrators when a request arrives.
CREATE FUNCTION students.on_join_request() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_admins uuid[];
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO v_admins FROM users WHERE college_id = NEW.college_id AND role = 'COLLEGE_ADMIN' AND status = 'ACTIVE';
  PERFORM notifications.push_many(NEW.college_id, notifications.coordinators_of(NEW.college_id, NEW.department_id), 'TASKS', 'Student sign-up awaiting approval: ' || NEW.full_name, NEW.register_number::text, '/coordinator/requests');
  PERFORM notifications.push_many(NEW.college_id, v_admins, 'TASKS', 'Student sign-up awaiting approval: ' || NEW.full_name, NEW.register_number::text, '/college/students/requests');
  RETURN NULL;
END $$;
CREATE TRIGGER join_requests_notify AFTER INSERT ON join_requests FOR EACH ROW EXECUTE FUNCTION students.on_join_request();

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'students' AND p.proname IN ('join_link_state', 'set_join_link', 'peek_join', 'submit_join_request', 'decide_join_request', 'on_join_request') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION students.join_link_state(), students.set_join_link(boolean, boolean), students.peek_join(uuid, int),
  students.submit_join_request(uuid, int, uuid, text, text, citext, citext, text, text, int, int, text, text), students.decide_join_request(uuid, boolean, text) TO cc_app;
REVOKE CREATE ON SCHEMA students FROM cc_auth;
