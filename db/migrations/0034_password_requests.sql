-- 0034_password_requests: password changes by approval, and own name/email changes.
--   Who approves whom: a student -> the coordinators of their department and every placement officer (and college administrators);
--   a coordinator or placement officer -> the college administrators; a college administrator -> the platform administrator.
--   The requester is signed in when they ask. An approval is valid for 24 hours and for ONE new password; the requester sets it on a page that asks
--   for the password twice (no current password is needed because a person above them approved it). Approvers never see or set the password.
--   A platform administrator has nobody above them and keeps the direct change.

CREATE TABLE password_change_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id    uuid NOT NULL REFERENCES users (id),
  college_id      uuid REFERENCES colleges (id),
  requester_role  text NOT NULL CHECK (requester_role IN ('STUDENT', 'COORDINATOR', 'PLACEMENT_OFFICER', 'COLLEGE_ADMIN')),
  department_id   uuid,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'DENIED', 'USED')),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid REFERENCES users (id),
  decided_by_name text,
  decided_at      timestamptz,
  expires_at      timestamptz,
  used_at         timestamptz
);
CREATE UNIQUE INDEX password_requests_one_open ON password_change_requests (requester_id) WHERE status IN ('PENDING', 'APPROVED');
GRANT SELECT, INSERT, UPDATE ON password_change_requests TO cc_auth;
GRANT SELECT ON password_change_requests TO cc_app;
ALTER TABLE password_change_requests ENABLE ROW LEVEL SECURITY; ALTER TABLE password_change_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY password_requests_own ON password_change_requests FOR SELECT TO cc_app USING (requester_id = (SELECT app.current_user_id()));

-- Does the caller (role, departments) have authority over this request?
CREATE FUNCTION auth.can_decide_password(p_requester_role text, p_college uuid, p_dept uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE app.current_role()
    WHEN 'COORDINATOR' THEN p_requester_role = 'STUDENT' AND p_college = app.current_college_id() AND p_dept = ANY (announcements.my_departments())
    WHEN 'PLACEMENT_OFFICER' THEN p_requester_role = 'STUDENT' AND p_college = app.current_college_id()
    WHEN 'COLLEGE_ADMIN' THEN p_requester_role IN ('STUDENT', 'COORDINATOR', 'PLACEMENT_OFFICER') AND p_college = app.current_college_id()
    WHEN 'PLATFORM_SUPER_ADMIN' THEN p_requester_role = 'COLLEGE_ADMIN'
    ELSE false END
$$;

CREATE FUNCTION auth.request_password_change() RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_role text := app.current_role(); v_dept uuid; v_id uuid; v_name text; v_to uuid[];
BEGIN
  IF v_user IS NULL OR v_role IS NULL OR v_role NOT IN ('STUDENT', 'COORDINATOR', 'PLACEMENT_OFFICER', 'COLLEGE_ADMIN') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  UPDATE password_change_requests SET status = 'DENIED', decided_at = now(), decided_by_name = 'Expired' WHERE requester_id = v_user AND status = 'APPROVED' AND expires_at <= now();
  IF EXISTS (SELECT 1 FROM password_change_requests WHERE requester_id = v_user AND status IN ('PENDING', 'APPROVED')) THEN RAISE EXCEPTION 'You already have a password request in progress.' USING ERRCODE = '22023'; END IF;
  IF v_role = 'STUDENT' THEN SELECT department_id INTO v_dept FROM students WHERE user_id = v_user AND college_id = v_c; END IF;
  INSERT INTO password_change_requests (requester_id, college_id, requester_role, department_id) VALUES (v_user, v_c, v_role, v_dept) RETURNING id INTO v_id;
  SELECT full_name INTO v_name FROM users WHERE id = v_user;
  IF v_role = 'STUDENT' THEN v_to := notifications.coordinators_of(v_c, v_dept) || notifications.officers(v_c) || ARRAY(SELECT id FROM users WHERE college_id = v_c AND role = 'COLLEGE_ADMIN' AND status = 'ACTIVE');
  ELSIF v_role IN ('COORDINATOR', 'PLACEMENT_OFFICER') THEN v_to := ARRAY(SELECT id FROM users WHERE college_id = v_c AND role = 'COLLEGE_ADMIN' AND status = 'ACTIVE');
  ELSE v_to := '{}'; END IF;                                                  -- a college administrator's request waits on the platform administrator's list
  PERFORM notifications.push_many(v_c, v_to, 'TASKS', 'Password change request', coalesce(v_name, 'A user') || ' (' || lower(replace(v_role, '_', ' ')) || ') asks to change their password. Approve or decline it.', '/account/password-requests');
  PERFORM auth.write_audit(CASE WHEN v_c IS NULL THEN 'PLATFORM' ELSE 'COLLEGE' END, v_c, v_user, v_role, 'PASSWORD_CHANGE_REQUESTED', 'user', v_user::text, '{}'::jsonb, NULL);
  RETURN v_id;
END $$;

CREATE FUNCTION auth.pending_password_requests() RETURNS TABLE (id uuid, full_name text, email text, requester_role text, department_code text, requested_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT r.id, u.full_name, u.email::text, r.requester_role, d.code::text, r.requested_at
    FROM password_change_requests r JOIN users u ON u.id = r.requester_id LEFT JOIN departments d ON d.id = r.department_id
   WHERE r.status = 'PENDING' AND auth.can_decide_password(r.requester_role, r.college_id, r.department_id) ORDER BY r.requested_at
$$;

CREATE FUNCTION auth.decide_password_request(p_id uuid, p_approve boolean) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_role text := app.current_role(); v_c uuid := app.current_college_id(); r password_change_requests%ROWTYPE; v_name text;
BEGIN
  IF v_user IS NULL OR v_role IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM password_change_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT auth.can_decide_password(r.requester_role, r.college_id, r.department_id) THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'PENDING' THEN RAISE EXCEPTION 'This request was already decided.' USING ERRCODE = '22023'; END IF;
  SELECT full_name INTO v_name FROM users WHERE id = v_user;
  UPDATE password_change_requests SET status = CASE WHEN p_approve THEN 'APPROVED' ELSE 'DENIED' END, decided_by = v_user, decided_by_name = coalesce(v_name, 'Staff'), decided_at = now(),
    expires_at = CASE WHEN p_approve THEN now() + interval '24 hours' END WHERE id = p_id;
  IF r.college_id IS NOT NULL THEN
    PERFORM notifications.push_many(r.college_id, ARRAY[r.requester_id], 'TASKS', CASE WHEN p_approve THEN 'Password change approved' ELSE 'Password change declined' END,
      CASE WHEN p_approve THEN 'You can now choose a new password. Open this notification within 24 hours.' ELSE 'Your request to change your password was declined.' END,
      CASE WHEN p_approve THEN '/account/password/' || p_id::text ELSE '/account' END);
  END IF;
  PERFORM auth.write_audit(CASE WHEN v_c IS NULL THEN 'PLATFORM' ELSE 'COLLEGE' END, v_c, v_user, v_role, CASE WHEN p_approve THEN 'PASSWORD_CHANGE_APPROVED' ELSE 'PASSWORD_CHANGE_DECLINED' END, 'user', r.requester_id::text, '{}'::jsonb, NULL);
END $$;

CREATE FUNCTION auth.my_password_request() RETURNS TABLE (id uuid, status text, requested_at timestamptz, decided_by_name text, expires_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT r.id, CASE WHEN r.status = 'APPROVED' AND r.expires_at <= now() THEN 'EXPIRED' ELSE r.status END, r.requested_at, r.decided_by_name, r.expires_at
    FROM password_change_requests r WHERE r.requester_id = app.current_user_id() ORDER BY r.requested_at DESC LIMIT 1
$$;

CREATE FUNCTION auth.complete_password_request(p_id uuid, p_new_hash text, p_keep_session_token_hash bytea) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_role text := app.current_role(); v_c uuid := app.current_college_id(); r password_change_requests%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF p_new_hash IS NULL OR p_new_hash NOT LIKE '$argon2id$%' THEN RAISE EXCEPTION 'invalid password hash' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM password_change_requests WHERE id = p_id AND requester_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'APPROVED' OR r.expires_at <= now() THEN RAISE EXCEPTION 'This approval is no longer valid. Ask for a new password change.' USING ERRCODE = '22023'; END IF;
  UPDATE users SET password_hash = p_new_hash, password_changed_at = now(), updated_at = now() WHERE id = v_user;
  UPDATE sessions SET revoked_at = now() WHERE user_id = v_user AND revoked_at IS NULL AND token_hash IS DISTINCT FROM p_keep_session_token_hash;
  UPDATE password_change_requests SET status = 'USED', used_at = now() WHERE id = p_id;
  PERFORM auth.write_audit(CASE WHEN v_c IS NULL THEN 'PLATFORM' ELSE 'COLLEGE' END, v_c, v_user, v_role, 'PASSWORD_CHANGED', 'user', v_user::text, jsonb_build_object('approved', true), NULL);
END $$;

-- Own name and sign-in email (the application checks the current password first). A student's record follows, so the two never disagree.
CREATE FUNCTION auth.update_own_profile(p_name text, p_email citext) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_role text := app.current_role(); v_c uuid := app.current_college_id(); v_name text := btrim(coalesce(p_name, '')); v_email citext := lower(btrim(coalesce(p_email::text, '')))::citext;
BEGIN
  IF v_user IS NULL OR v_role IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF length(v_name) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'Enter your name (2 to 120 characters).' USING ERRCODE = '22023'; END IF;
  IF v_email::text !~ '^[^@[:space:]]+@[^@[:space:]]+$' OR length(v_email::text) > 254 THEN RAISE EXCEPTION 'Enter a valid email address.' USING ERRCODE = '22023'; END IF;
  BEGIN
    UPDATE users SET full_name = v_name, email = v_email, updated_at = now() WHERE id = v_user;
    IF v_role = 'STUDENT' THEN UPDATE students SET full_name = v_name, college_email = v_email, updated_at = now() WHERE user_id = v_user AND college_id = v_c; END IF;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'That email address is already used by another account.' USING ERRCODE = '22023';
  END;
  PERFORM auth.write_audit(CASE WHEN v_c IS NULL THEN 'PLATFORM' ELSE 'COLLEGE' END, v_c, v_user, v_role, 'PROFILE_UPDATED', 'user', v_user::text, '{}'::jsonb, NULL);
END $$;

GRANT CREATE ON SCHEMA auth TO cc_auth;
ALTER FUNCTION auth.can_decide_password(text, uuid, uuid) OWNER TO cc_auth;
ALTER FUNCTION auth.request_password_change() OWNER TO cc_auth;
ALTER FUNCTION auth.pending_password_requests() OWNER TO cc_auth;
ALTER FUNCTION auth.decide_password_request(uuid, boolean) OWNER TO cc_auth;
ALTER FUNCTION auth.my_password_request() OWNER TO cc_auth;
ALTER FUNCTION auth.complete_password_request(uuid, text, bytea) OWNER TO cc_auth;
ALTER FUNCTION auth.update_own_profile(text, citext) OWNER TO cc_auth;
REVOKE CREATE ON SCHEMA auth FROM cc_auth;
REVOKE ALL ON FUNCTION auth.can_decide_password(text, uuid, uuid), auth.request_password_change(), auth.pending_password_requests(), auth.decide_password_request(uuid, boolean), auth.my_password_request(),
  auth.complete_password_request(uuid, text, bytea), auth.update_own_profile(text, citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.request_password_change(), auth.pending_password_requests(), auth.decide_password_request(uuid, boolean), auth.my_password_request(),
  auth.complete_password_request(uuid, text, bytea), auth.update_own_profile(text, citext) TO cc_app;      -- can_decide_password is internal
