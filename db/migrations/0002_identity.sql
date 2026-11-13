-- 0002_identity: colleges, users, sessions, invitations, password resets, rate limits, audit log,
-- and the SECURITY DEFINER functions that are the ONLY way the runtime role touches credentials.
--
-- Trust model
--   * The server sets exactly ONE session variable per transaction: app.user_id.
--   * College and role are DERIVED from the users table by definer functions (app.current_college_id /
--     app.current_role). They cannot be set independently, and they become NULL (fail closed) when the
--     user is disabled or the college is suspended.
--   * cc_app has no direct access to sessions, invitations, password_resets, rate_limits, and cannot read
--     users.password_hash or write users at all except its own display name.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cc_auth') THEN
    RAISE EXCEPTION 'role cc_auth is missing: create it as a superuser (see docker/postgres/init/01-roles-and-dbs.sh)';
  END IF;
END $$;

-- ───────────────────────── tables ─────────────────────────
CREATE TABLE colleges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  status     text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id          uuid REFERENCES colleges (id),
  email               citext NOT NULL UNIQUE,   -- globally unique (supersedes TD-05 "per college")
  full_name           text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 200),
  password_hash       text NOT NULL,
  role                text NOT NULL CHECK (role IN ('PLATFORM_SUPER_ADMIN','COLLEGE_ADMIN','PLACEMENT_OFFICER','COORDINATOR','STUDENT')),
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  last_login_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_role_college CHECK ((role = 'PLATFORM_SUPER_ADMIN') = (college_id IS NULL)),
  CONSTRAINT users_email_len CHECK (length(email::text) BETWEEN 3 AND 254),
  UNIQUE (college_id, id)                         -- target for tenant-aware composite FKs
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,             -- SHA-256 of the cookie token; the token itself is never stored
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_seconds int NOT NULL CHECK (idle_seconds BETWEEN 60 AND 604800),
  expires_at   timestamptz NOT NULL,              -- absolute expiry
  revoked_at   timestamptz,
  ip_hash      text,
  user_agent   text CHECK (length(user_agent) <= 300)
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE invitations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            citext NOT NULL,
  role             text NOT NULL CHECK (role IN ('COLLEGE_ADMIN','PLACEMENT_OFFICER','COORDINATOR','STUDENT')),
  college_id       uuid NOT NULL REFERENCES colleges (id),
  invited_by       uuid NOT NULL REFERENCES users (id),
  token_hash       bytea NOT NULL UNIQUE,
  expires_at       timestamptz NOT NULL,
  accepted_at      timestamptz,
  accepted_user_id uuid REFERENCES users (id),
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_email_idx ON invitations (email);
CREATE INDEX invitations_college_idx ON invitations (college_id);

CREATE TABLE password_resets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  issued_by  uuid NOT NULL REFERENCES users (id),
  token_hash bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rate_limits (
  key          text NOT NULL,                      -- already HMAC'd by the app; never a raw email/IP
  window_start timestamptz NOT NULL,
  hits         int NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX rate_limits_window_idx ON rate_limits (window_start);

CREATE TABLE audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  scope         text NOT NULL CHECK (scope IN ('PLATFORM', 'COLLEGE')),
  college_id    uuid REFERENCES colleges (id),
  actor_user_id uuid REFERENCES users (id),
  actor_role    text,
  action        text NOT NULL CHECK (length(action) BETWEEN 3 AND 80),
  entity_type   text,
  entity_id     text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash       text,
  CONSTRAINT audit_scope_college CHECK ((scope = 'COLLEGE') = (college_id IS NOT NULL))
);
CREATE INDEX audit_college_idx ON audit_log (college_id, occurred_at DESC);

-- Append-only: no UPDATE / DELETE / TRUNCATE for ANYONE (including the table owner).
CREATE FUNCTION app.audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = '42501'; END $$;
CREATE TRIGGER audit_no_update_delete BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION app.audit_immutable();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION app.audit_immutable();

-- ───────────────────── privileges for cc_auth ─────────────────────
GRANT USAGE ON SCHEMA public TO cc_auth;
GRANT SELECT, INSERT, UPDATE ON colleges, users TO cc_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO cc_auth;
GRANT SELECT, INSERT, UPDATE ON invitations, password_resets TO cc_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limits TO cc_auth;
GRANT SELECT, INSERT ON audit_log TO cc_auth;

-- ───────────────────── derived request context ─────────────────────
CREATE SCHEMA auth;
REVOKE ALL ON SCHEMA auth FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO cc_app;
GRANT USAGE, CREATE ON SCHEMA auth TO cc_auth;    -- CREATE is revoked again at the end of this migration
GRANT USAGE, CREATE ON SCHEMA app TO cc_auth;     -- (needed only to transfer function ownership)
GRANT EXECUTE ON FUNCTION app.current_user_id() TO cc_auth;  -- definer functions read the per-transaction user id

CREATE OR REPLACE FUNCTION app.current_college_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT u.college_id FROM users u
   WHERE u.id = app.current_user_id() AND u.status = 'ACTIVE'
     AND (u.college_id IS NULL OR EXISTS (SELECT 1 FROM colleges c WHERE c.id = u.college_id AND c.status = 'ACTIVE'))
$$;

CREATE OR REPLACE FUNCTION app.current_role() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT u.role FROM users u
   WHERE u.id = app.current_user_id() AND u.status = 'ACTIVE'
     AND (u.college_id IS NULL OR EXISTS (SELECT 1 FROM colleges c WHERE c.id = u.college_id AND c.status = 'ACTIVE'))
$$;

ALTER FUNCTION app.current_college_id() OWNER TO cc_auth;
ALTER FUNCTION app.current_role() OWNER TO cc_auth;

-- ───────────────────── RLS ─────────────────────
ALTER TABLE colleges ENABLE ROW LEVEL SECURITY;  ALTER TABLE colleges FORCE ROW LEVEL SECURITY;
ALTER TABLE users    ENABLE ROW LEVEL SECURITY;  ALTER TABLE users    FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY; ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
-- Credential/session/rate-limit tables: RLS on, NO policies, NO grants to cc_app => unreachable by the runtime role.
ALTER TABLE sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits     ENABLE ROW LEVEL SECURITY;

-- colleges
CREATE POLICY colleges_select ON colleges FOR SELECT TO cc_app
  USING ((SELECT app.current_role()) = 'PLATFORM_SUPER_ADMIN' OR id = (SELECT app.current_college_id()));
CREATE POLICY colleges_insert ON colleges FOR INSERT TO cc_app
  WITH CHECK ((SELECT app.current_role()) = 'PLATFORM_SUPER_ADMIN');
CREATE POLICY colleges_update ON colleges FOR UPDATE TO cc_app
  USING ((SELECT app.current_role()) = 'PLATFORM_SUPER_ADMIN')
  WITH CHECK ((SELECT app.current_role()) = 'PLATFORM_SUPER_ADMIN');

-- users: own row; college admins see their college; platform admins see platform admins + college admins only
CREATE POLICY users_select_self ON users FOR SELECT TO cc_app USING (id = app.current_user_id() AND (SELECT app.current_role()) IS NOT NULL);
CREATE POLICY users_select_college_admin ON users FOR SELECT TO cc_app
  USING ((SELECT app.current_role()) = 'COLLEGE_ADMIN' AND college_id = (SELECT app.current_college_id()));
CREATE POLICY users_select_platform ON users FOR SELECT TO cc_app
  USING ((SELECT app.current_role()) = 'PLATFORM_SUPER_ADMIN' AND role IN ('PLATFORM_SUPER_ADMIN', 'COLLEGE_ADMIN'));
CREATE POLICY users_update_self ON users FOR UPDATE TO cc_app
  USING (id = app.current_user_id() AND (SELECT app.current_role()) IS NOT NULL)
  WITH CHECK (id = app.current_user_id());

-- invitations (read-only for admins; creation/acceptance only via definer functions)
CREATE POLICY invitations_select_college_admin ON invitations FOR SELECT TO cc_app
  USING ((SELECT app.current_role()) = 'COLLEGE_ADMIN' AND college_id = (SELECT app.current_college_id()));
CREATE POLICY invitations_select_platform ON invitations FOR SELECT TO cc_app
  USING ((SELECT app.current_role()) = 'PLATFORM_SUPER_ADMIN' AND role = 'COLLEGE_ADMIN');

-- audit_log
CREATE POLICY audit_select_college ON audit_log FOR SELECT TO cc_app
  USING (scope = 'COLLEGE' AND (SELECT app.current_role()) = 'COLLEGE_ADMIN' AND college_id = (SELECT app.current_college_id()));
CREATE POLICY audit_select_platform ON audit_log FOR SELECT TO cc_app
  USING (scope = 'PLATFORM' AND (SELECT app.current_role()) = 'PLATFORM_SUPER_ADMIN');
CREATE POLICY audit_insert ON audit_log FOR INSERT TO cc_app
  WITH CHECK (
    actor_user_id = app.current_user_id() AND actor_role = (SELECT app.current_role())
    AND ((scope = 'COLLEGE' AND college_id = (SELECT app.current_college_id()))
      OR (scope = 'PLATFORM' AND (SELECT app.current_role()) = 'PLATFORM_SUPER_ADMIN'))
  );

-- ───────────────────── grants for cc_app (column-level where it matters) ─────────────────────
GRANT SELECT (id, name, status, created_at, updated_at) ON colleges TO cc_app;
GRANT INSERT (name) ON colleges TO cc_app;
GRANT UPDATE (name, status, updated_at) ON colleges TO cc_app;
GRANT SELECT (id, college_id, email, full_name, role, status, password_changed_at, last_login_at, created_at, updated_at) ON users TO cc_app;
GRANT UPDATE (full_name, updated_at) ON users TO cc_app;      -- nothing else; never role, college_id, status, email, password_hash
GRANT SELECT (id, email, role, college_id, invited_by, expires_at, accepted_at, accepted_user_id, revoked_at, created_at) ON invitations TO cc_app;
GRANT SELECT ON audit_log TO cc_app;
GRANT INSERT (scope, college_id, actor_user_id, actor_role, action, entity_type, entity_id, metadata, ip_hash) ON audit_log TO cc_app;

-- ───────────────────── internal helpers ─────────────────────
CREATE FUNCTION auth.write_audit(p_scope text, p_college uuid, p_actor uuid, p_actor_role text, p_action text,
                                 p_entity_type text, p_entity_id text, p_meta jsonb, p_ip text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO audit_log (scope, college_id, actor_user_id, actor_role, action, entity_type, entity_id, metadata, ip_hash)
  VALUES (p_scope, p_college, p_actor, p_actor_role, p_action, p_entity_type, p_entity_id, COALESCE(p_meta, '{}'::jsonb), p_ip)
$$;

-- ───────────────────── login / session functions ─────────────────────
CREATE FUNCTION auth.get_login_user(p_email citext)
  RETURNS TABLE (id uuid, password_hash text, status text, role text, college_id uuid, college_active boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT u.id, u.password_hash, u.status, u.role, u.college_id,
         (u.college_id IS NULL OR c.status = 'ACTIVE')
    FROM users u LEFT JOIN colleges c ON c.id = u.college_id
   WHERE u.email = p_email
$$;

CREATE FUNCTION auth.create_session(p_user_id uuid, p_token_hash bytea, p_idle_seconds int, p_absolute_seconds int,
                                    p_ip_hash text, p_user_agent text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid; v_user users%ROWTYPE;
BEGIN
  IF p_absolute_seconds NOT BETWEEN 300 AND 2592000 THEN RAISE EXCEPTION 'bad session lifetime'; END IF;
  SELECT * INTO v_user FROM users WHERE id = p_user_id AND status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'user not active' USING ERRCODE = '42501'; END IF;
  IF v_user.college_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM colleges WHERE id = v_user.college_id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'college not active' USING ERRCODE = '42501';
  END IF;
  INSERT INTO sessions (user_id, token_hash, idle_seconds, expires_at, ip_hash, user_agent)
  VALUES (p_user_id, p_token_hash, p_idle_seconds, now() + make_interval(secs => p_absolute_seconds), p_ip_hash, left(p_user_agent, 300))
  RETURNING id INTO v_id;
  UPDATE users SET last_login_at = now() WHERE id = p_user_id;
  DELETE FROM sessions WHERE user_id = p_user_id AND (expires_at < now() OR revoked_at IS NOT NULL);  -- housekeeping
  RETURN v_id;
END $$;

CREATE FUNCTION auth.resolve_session(p_token_hash bytea)
  RETURNS TABLE (session_id uuid, user_id uuid, role text, college_id uuid, full_name text, email citext)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_sid uuid; v_last timestamptz;
BEGIN
  SELECT s.id, s.last_seen_at INTO v_sid, v_last
    FROM sessions s
    JOIN users u ON u.id = s.user_id AND u.status = 'ACTIVE'
    LEFT JOIN colleges c ON c.id = u.college_id
   WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL
     AND s.expires_at > now()
     AND s.last_seen_at + make_interval(secs => s.idle_seconds) > now()
     AND (u.college_id IS NULL OR c.status = 'ACTIVE');
  IF v_sid IS NULL THEN RETURN; END IF;
  IF v_last < now() - interval '60 seconds' THEN UPDATE sessions SET last_seen_at = now() WHERE id = v_sid; END IF;
  RETURN QUERY SELECT v_sid, u.id, u.role, u.college_id, u.full_name, u.email
                 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = v_sid;
END $$;

CREATE FUNCTION auth.revoke_session(p_token_hash bytea) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE sessions SET revoked_at = now() WHERE token_hash = p_token_hash AND revoked_at IS NULL
$$;

CREATE FUNCTION auth.log_auth_event(p_user_id uuid, p_action text, p_ip_hash text, p_meta jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user users%ROWTYPE;
BEGIN
  IF p_action NOT IN ('LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'LOGIN_BLOCKED', 'LOGOUT', 'PASSWORD_RESET_REQUEST_REJECTED') THEN
    RAISE EXCEPTION 'unknown auth event' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NOT NULL THEN SELECT * INTO v_user FROM users WHERE id = p_user_id; END IF;
  IF v_user.id IS NOT NULL AND v_user.college_id IS NOT NULL THEN
    PERFORM auth.write_audit('COLLEGE', v_user.college_id, v_user.id, v_user.role, p_action, 'user', v_user.id::text, p_meta, p_ip_hash);
  ELSE
    PERFORM auth.write_audit('PLATFORM', NULL, v_user.id, v_user.role, p_action, 'user', v_user.id::text, p_meta, p_ip_hash);
  END IF;
END $$;

-- fixed-window rate limiter. Returns TRUE if the call is allowed.
CREATE FUNCTION auth.rate_limit_check(p_key text, p_max int, p_window_seconds int) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_window timestamptz; v_hits int;
BEGIN
  IF p_window_seconds NOT BETWEEN 1 AND 86400 OR p_max < 1 THEN RAISE EXCEPTION 'bad limiter config'; END IF;
  v_window := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  INSERT INTO rate_limits (key, window_start, hits) VALUES (p_key, v_window, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET hits = rate_limits.hits + 1
  RETURNING hits INTO v_hits;
  IF random() < 0.02 THEN DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'; END IF;
  RETURN v_hits <= p_max;
END $$;

-- ───────────────────── invitations ─────────────────────
CREATE FUNCTION auth.create_invitation(p_email citext, p_role text, p_college_id uuid, p_token_hash bytea, p_ttl_seconds int)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := app.current_user_id(); v_role text := app.current_role(); v_college uuid := app.current_college_id();
        v_target_college uuid; v_id uuid;
BEGIN
  IF v_actor IS NULL OR v_role IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_ttl_seconds NOT BETWEEN 600 AND 1209600 THEN RAISE EXCEPTION 'invitation lifetime must be 10 minutes to 14 days' USING ERRCODE = '22023'; END IF;
  IF p_email IS NULL OR length(p_email::text) NOT BETWEEN 3 AND 254 OR position('@' IN p_email::text) < 2 THEN
    RAISE EXCEPTION 'invalid email' USING ERRCODE = '22023';
  END IF;

  IF v_role = 'PLATFORM_SUPER_ADMIN' THEN
    IF p_role <> 'COLLEGE_ADMIN' THEN RAISE EXCEPTION 'platform admins may only invite college admins' USING ERRCODE = '42501'; END IF;
    v_target_college := p_college_id;
  ELSIF v_role = 'COLLEGE_ADMIN' THEN
    IF p_role NOT IN ('PLACEMENT_OFFICER', 'COORDINATOR', 'STUDENT') THEN
      RAISE EXCEPTION 'college admins may only invite placement officers, coordinators and students' USING ERRCODE = '42501';
    END IF;
    IF p_college_id IS NOT NULL AND p_college_id <> v_college THEN RAISE EXCEPTION 'cross-college invitation refused' USING ERRCODE = '42501'; END IF;
    v_target_college := v_college;
  ELSE
    RAISE EXCEPTION 'role % may not invite' , v_role USING ERRCODE = '42501';
  END IF;

  IF v_target_college IS NULL OR NOT EXISTS (SELECT 1 FROM colleges WHERE id = v_target_college AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'college not found or not active' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE email = p_email) THEN RAISE EXCEPTION 'an account with this email already exists' USING ERRCODE = '23505'; END IF;

  UPDATE invitations SET revoked_at = now() WHERE email = p_email AND accepted_at IS NULL AND revoked_at IS NULL;
  INSERT INTO invitations (email, role, college_id, invited_by, token_hash, expires_at)
  VALUES (p_email, p_role, v_target_college, v_actor, p_token_hash, now() + make_interval(secs => p_ttl_seconds))
  RETURNING id INTO v_id;
  PERFORM auth.write_audit('COLLEGE', v_target_college, v_actor, v_role, 'INVITATION_CREATED', 'invitation', v_id::text,
                           jsonb_build_object('role', p_role), NULL);
  RETURN v_id;
END $$;

CREATE FUNCTION auth.peek_invitation(p_token_hash bytea)
  RETURNS TABLE (email citext, role text, college_name text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT i.email, i.role, c.name FROM invitations i JOIN colleges c ON c.id = i.college_id
   WHERE i.token_hash = p_token_hash AND i.accepted_at IS NULL AND i.revoked_at IS NULL
     AND i.expires_at > now() AND c.status = 'ACTIVE'
$$;

CREATE FUNCTION auth.accept_invitation(p_token_hash bytea, p_full_name text, p_password_hash text)
  RETURNS TABLE (user_id uuid, role text, college_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_inv invitations%ROWTYPE; v_uid uuid;
BEGIN
  SELECT i.* INTO v_inv FROM invitations i JOIN colleges c ON c.id = i.college_id
   WHERE i.token_hash = p_token_hash AND i.accepted_at IS NULL AND i.revoked_at IS NULL
     AND i.expires_at > now() AND c.status = 'ACTIVE'
   FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_or_expired' USING ERRCODE = 'P0001'; END IF;
  IF p_password_hash IS NULL OR p_password_hash NOT LIKE '$argon2id$%' THEN RAISE EXCEPTION 'invalid password hash' USING ERRCODE = '22023'; END IF;
  INSERT INTO users (college_id, email, full_name, password_hash, role)
  VALUES (v_inv.college_id, v_inv.email, p_full_name, p_password_hash, v_inv.role)
  RETURNING id INTO v_uid;
  UPDATE invitations SET accepted_at = now(), accepted_user_id = v_uid WHERE id = v_inv.id;
  PERFORM auth.write_audit('COLLEGE', v_inv.college_id, v_uid, v_inv.role, 'INVITATION_ACCEPTED', 'invitation', v_inv.id::text, '{}'::jsonb, NULL);
  RETURN QUERY SELECT v_uid, v_inv.role, v_inv.college_id;
END $$;

-- ───────────────────── passwords ─────────────────────
CREATE FUNCTION auth.issue_password_reset(p_target uuid, p_token_hash bytea, p_ttl_seconds int) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := app.current_user_id(); v_role text := app.current_role(); v_college uuid := app.current_college_id();
        v_t users%ROWTYPE; v_id uuid;
BEGIN
  IF v_actor IS NULL OR v_role IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_ttl_seconds NOT BETWEEN 600 AND 86400 THEN RAISE EXCEPTION 'reset lifetime must be 10 minutes to 24 hours' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_t FROM users WHERE id = p_target AND status = 'ACTIVE';
  IF NOT FOUND OR p_target = v_actor THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF NOT ((v_role = 'PLATFORM_SUPER_ADMIN' AND v_t.role = 'COLLEGE_ADMIN')
       OR (v_role = 'COLLEGE_ADMIN' AND v_t.college_id = v_college AND v_t.role IN ('PLACEMENT_OFFICER', 'COORDINATOR', 'STUDENT'))) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE password_resets SET used_at = now() WHERE user_id = p_target AND used_at IS NULL;
  INSERT INTO password_resets (user_id, issued_by, token_hash, expires_at)
  VALUES (p_target, v_actor, p_token_hash, now() + make_interval(secs => p_ttl_seconds)) RETURNING id INTO v_id;
  IF v_t.college_id IS NULL THEN
    PERFORM auth.write_audit('PLATFORM', NULL, v_actor, v_role, 'PASSWORD_RESET_ISSUED', 'user', p_target::text, '{}'::jsonb, NULL);
  ELSE
    PERFORM auth.write_audit('COLLEGE', v_t.college_id, v_actor, v_role, 'PASSWORD_RESET_ISSUED', 'user', p_target::text, '{}'::jsonb, NULL);
  END IF;
  RETURN v_id;
END $$;

CREATE FUNCTION auth.peek_password_reset(p_token_hash bytea) RETURNS TABLE (email citext)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT u.email FROM password_resets r JOIN users u ON u.id = r.user_id
   WHERE r.token_hash = p_token_hash AND r.used_at IS NULL AND r.expires_at > now() AND u.status = 'ACTIVE'
$$;

CREATE FUNCTION auth.complete_password_reset(p_token_hash bytea, p_new_hash text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_r password_resets%ROWTYPE; v_u users%ROWTYPE;
BEGIN
  IF p_new_hash IS NULL OR p_new_hash NOT LIKE '$argon2id$%' THEN RAISE EXCEPTION 'invalid password hash' USING ERRCODE = '22023'; END IF;
  SELECT r.* INTO v_r FROM password_resets r JOIN users u ON u.id = r.user_id AND u.status = 'ACTIVE'
   WHERE r.token_hash = p_token_hash AND r.used_at IS NULL AND r.expires_at > now() FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_or_expired' USING ERRCODE = 'P0001'; END IF;
  UPDATE password_resets SET used_at = now() WHERE id = v_r.id;
  UPDATE users SET password_hash = p_new_hash, password_changed_at = now(), updated_at = now() WHERE id = v_r.user_id RETURNING * INTO v_u;
  UPDATE sessions SET revoked_at = now() WHERE user_id = v_r.user_id AND revoked_at IS NULL;
  PERFORM auth.write_audit(CASE WHEN v_u.college_id IS NULL THEN 'PLATFORM' ELSE 'COLLEGE' END, v_u.college_id, v_u.id, v_u.role,
                           'PASSWORD_RESET_COMPLETED', 'user', v_u.id::text, '{}'::jsonb, NULL);
  RETURN v_u.id;
END $$;

-- Caller proves the current password in the app layer (get_login_user + argon2 verify); this function only
-- allows changing the CALLER's own password and revokes every other session.
CREATE FUNCTION auth.change_own_password(p_new_hash text, p_keep_session_token_hash bytea) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := app.current_user_id(); v_role text := app.current_role(); v_college uuid := app.current_college_id();
BEGIN
  IF v_actor IS NULL OR v_role IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_new_hash IS NULL OR p_new_hash NOT LIKE '$argon2id$%' THEN RAISE EXCEPTION 'invalid password hash' USING ERRCODE = '22023'; END IF;
  UPDATE users SET password_hash = p_new_hash, password_changed_at = now(), updated_at = now() WHERE id = v_actor;
  UPDATE sessions SET revoked_at = now() WHERE user_id = v_actor AND revoked_at IS NULL AND token_hash IS DISTINCT FROM p_keep_session_token_hash;
  PERFORM auth.write_audit(CASE WHEN v_college IS NULL THEN 'PLATFORM' ELSE 'COLLEGE' END, v_college, v_actor, v_role,
                           'PASSWORD_CHANGED', 'user', v_actor::text, '{}'::jsonb, NULL);
END $$;

-- ───────────────────── account status ─────────────────────
CREATE FUNCTION auth.set_user_status(p_target uuid, p_status text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := app.current_user_id(); v_role text := app.current_role(); v_college uuid := app.current_college_id(); v_t users%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_role IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('ACTIVE', 'DISABLED') THEN RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_t FROM users WHERE id = p_target;
  IF NOT FOUND OR p_target = v_actor THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF NOT ((v_role = 'PLATFORM_SUPER_ADMIN' AND v_t.role = 'COLLEGE_ADMIN')
       OR (v_role = 'COLLEGE_ADMIN' AND v_t.college_id = v_college AND v_t.role IN ('PLACEMENT_OFFICER', 'COORDINATOR', 'STUDENT'))) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE users SET status = p_status, updated_at = now() WHERE id = p_target;
  IF p_status = 'DISABLED' THEN UPDATE sessions SET revoked_at = now() WHERE user_id = p_target AND revoked_at IS NULL; END IF;
  PERFORM auth.write_audit(CASE WHEN v_t.college_id IS NULL THEN 'PLATFORM' ELSE 'COLLEGE' END, v_t.college_id, v_actor, v_role,
                           CASE WHEN p_status = 'DISABLED' THEN 'USER_DISABLED' ELSE 'USER_ENABLED' END, 'user', p_target::text, '{}'::jsonb, NULL);
END $$;

-- ───────────────────── bootstrap (owner-only, one time) ─────────────────────
CREATE FUNCTION auth.bootstrap_platform_admin(p_email citext, p_full_name text, p_password_hash text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE role = 'PLATFORM_SUPER_ADMIN') THEN RAISE EXCEPTION 'a platform admin already exists' USING ERRCODE = '23505'; END IF;
  IF p_password_hash NOT LIKE '$argon2id$%' THEN RAISE EXCEPTION 'invalid password hash' USING ERRCODE = '22023'; END IF;
  INSERT INTO users (college_id, email, full_name, password_hash, role) VALUES (NULL, p_email, p_full_name, p_password_hash, 'PLATFORM_SUPER_ADMIN')
  RETURNING id INTO v_id;
  PERFORM auth.write_audit('PLATFORM', NULL, v_id, 'PLATFORM_SUPER_ADMIN', 'PLATFORM_ADMIN_BOOTSTRAPPED', 'user', v_id::text, '{}'::jsonb, NULL);
  RETURN v_id;
END $$;

-- ───────────────────── ownership + execute privileges ─────────────────────
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auth' LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION
  auth.get_login_user(citext), auth.create_session(uuid, bytea, int, int, text, text), auth.resolve_session(bytea),
  auth.revoke_session(bytea), auth.log_auth_event(uuid, text, text, jsonb), auth.rate_limit_check(text, int, int),
  auth.create_invitation(citext, text, uuid, bytea, int), auth.peek_invitation(bytea), auth.accept_invitation(bytea, text, text),
  auth.issue_password_reset(uuid, bytea, int), auth.peek_password_reset(bytea), auth.complete_password_reset(bytea, text),
  auth.change_own_password(text, bytea), auth.set_user_status(uuid, text)
  TO cc_app;
GRANT EXECUTE ON FUNCTION auth.bootstrap_platform_admin(citext, text, text) TO cc_owner;
-- auth.write_audit is internal: no grant to cc_app.

REVOKE CREATE ON SCHEMA auth FROM cc_auth;
REVOKE CREATE ON SCHEMA app FROM cc_auth;
