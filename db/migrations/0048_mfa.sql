-- 0048_mfa: a second sign-in step with an authenticator app (TOTP) and one-time recovery codes.
-- The application verifies the 6-digit code (as it verifies passwords). The secret is stored only encrypted; recovery codes only as hashes.
-- These tables are invisible to the runtime role: every access goes through the functions below.

CREATE TABLE user_mfa (
  user_id     uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  secret_enc  text CHECK (secret_enc IS NULL OR length(secret_enc) <= 400),     -- in use
  pending_enc text CHECK (pending_enc IS NULL OR length(pending_enc) <= 400),   -- being set up, not yet confirmed
  last_step   bigint NOT NULL DEFAULT 0,                                        -- newest time step accepted: a code works once
  enabled_at  timestamptz,
  CONSTRAINT mfa_enabled_has_secret CHECK ((enabled_at IS NULL) = (secret_enc IS NULL))
);
CREATE TABLE mfa_recovery_codes (
  user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash bytea NOT NULL,
  used_at   timestamptz,
  PRIMARY KEY (user_id, code_hash)
);
CREATE TABLE mfa_challenges (
  token_hash bytea PRIMARY KEY,                 -- the password step was passed; the code step is waiting
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  attempts   int NOT NULL DEFAULT 0
);
ALTER TABLE user_mfa ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_challenges ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_mfa, mfa_recovery_codes, mfa_challenges TO cc_auth;

GRANT CREATE ON SCHEMA auth TO cc_auth;

CREATE FUNCTION auth.mfa_enabled(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM user_mfa WHERE user_id = p_user AND enabled_at IS NOT NULL)
$$;

CREATE FUNCTION auth.mfa_begin_challenge(p_user uuid, p_token_hash bytea) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT auth.mfa_enabled(p_user) THEN RAISE EXCEPTION 'not enrolled' USING ERRCODE = '22023'; END IF;
  DELETE FROM mfa_challenges WHERE user_id = p_user OR expires_at <= now();
  INSERT INTO mfa_challenges (token_hash, user_id, expires_at) VALUES (p_token_hash, p_user, now() + interval '5 minutes');
END $$;

-- Reading a challenge to check a code counts as an attempt; after five the challenge is dead.
CREATE FUNCTION auth.mfa_try_challenge(p_token_hash bytea) RETURNS TABLE (user_id uuid, role text, secret_enc text, last_step bigint)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid;
BEGIN
  UPDATE mfa_challenges c SET attempts = c.attempts + 1 WHERE c.token_hash = p_token_hash AND c.expires_at > now() AND c.attempts < 5 RETURNING c.user_id INTO v_user;
  IF v_user IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT u.id, u.role, m.secret_enc, m.last_step FROM users u JOIN user_mfa m ON m.user_id = u.id
    WHERE u.id = v_user AND u.status = 'ACTIVE' AND m.enabled_at IS NOT NULL;
END $$;

-- Finishes a challenge with an authenticator code (its time step) or a recovery code (its hash). FALSE: already used.
CREATE FUNCTION auth.mfa_finish_challenge(p_token_hash bytea, p_step bigint, p_recovery_hash bytea) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid; u users%ROWTYPE; v_n int;
BEGIN
  SELECT c.user_id INTO v_user FROM mfa_challenges c WHERE c.token_hash = p_token_hash AND c.expires_at > now() AND c.attempts <= 5 FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_recovery_hash IS NOT NULL THEN
    UPDATE mfa_recovery_codes SET used_at = now() WHERE user_id = v_user AND code_hash = p_recovery_hash AND used_at IS NULL;
  ELSE
    UPDATE user_mfa SET last_step = p_step WHERE user_id = v_user AND enabled_at IS NOT NULL AND last_step < p_step;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN false; END IF;
  DELETE FROM mfa_challenges WHERE token_hash = p_token_hash;
  IF p_recovery_hash IS NOT NULL THEN
    SELECT * INTO u FROM users WHERE id = v_user;
    PERFORM auth.write_audit(CASE WHEN u.college_id IS NULL THEN 'PLATFORM' ELSE 'COLLEGE' END, u.college_id, u.id, u.role, 'MFA_RECOVERY_CODE_USED', 'user', u.id::text, '{}'::jsonb, NULL);
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION auth.mfa_my_status() RETURNS TABLE (enabled boolean, pending_enc text, codes_left int)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(m.enabled_at IS NOT NULL, false), m.pending_enc,
         (SELECT count(*)::int FROM mfa_recovery_codes c WHERE c.user_id = u.id AND c.used_at IS NULL)
    FROM users u LEFT JOIN user_mfa m ON m.user_id = u.id WHERE u.id = app.current_user_id() AND app.current_role() IS NOT NULL
$$;

CREATE FUNCTION auth.mfa_start_setup(p_secret_enc text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id();
BEGIN
  IF v_user IS NULL OR app.current_role() IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF auth.mfa_enabled(v_user) THEN RAISE EXCEPTION 'Two-step sign-in is already on.' USING ERRCODE = '22023'; END IF;
  INSERT INTO user_mfa (user_id, pending_enc) VALUES (v_user, p_secret_enc) ON CONFLICT (user_id) DO UPDATE SET pending_enc = p_secret_enc;
END $$;

-- The app has checked a code against the pending secret. Other sessions are signed out: they never passed the second step.
CREATE FUNCTION auth.mfa_confirm_setup(p_step bigint, p_code_hashes bytea[], p_keep_session_token_hash bytea) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_role text := app.current_role(); v_c uuid := app.current_college_id(); v_n int;
BEGIN
  IF v_user IS NULL OR v_role IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF coalesce(array_length(p_code_hashes, 1), 0) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'bad recovery codes' USING ERRCODE = '22023'; END IF;
  UPDATE user_mfa SET secret_enc = pending_enc, pending_enc = NULL, enabled_at = now(), last_step = p_step WHERE user_id = v_user AND enabled_at IS NULL AND pending_enc IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'Start the setup again.' USING ERRCODE = '22023'; END IF;
  DELETE FROM mfa_recovery_codes WHERE user_id = v_user;
  INSERT INTO mfa_recovery_codes (user_id, code_hash) SELECT v_user, h FROM unnest(p_code_hashes) AS h;
  UPDATE sessions SET revoked_at = now() WHERE user_id = v_user AND revoked_at IS NULL AND token_hash IS DISTINCT FROM p_keep_session_token_hash;
  PERFORM auth.write_audit(CASE WHEN v_c IS NULL THEN 'PLATFORM' ELSE 'COLLEGE' END, v_c, v_user, v_role, 'MFA_ENABLED', 'user', v_user::text, '{}'::jsonb, NULL);
END $$;

-- Turning it off yourself (the app checks the password first). Administrators must keep it.
CREATE FUNCTION auth.mfa_disable() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_role text := app.current_role(); v_c uuid := app.current_college_id();
BEGIN
  IF v_user IS NULL OR v_role IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF v_role IN ('PLATFORM_SUPER_ADMIN', 'COLLEGE_ADMIN') THEN RAISE EXCEPTION 'Administrators must keep two-step sign-in on.' USING ERRCODE = '22023'; END IF;
  DELETE FROM user_mfa WHERE user_id = v_user;
  DELETE FROM mfa_recovery_codes WHERE user_id = v_user;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, v_role, 'MFA_DISABLED', 'user', v_user::text, '{}'::jsonb, NULL);
END $$;

-- A lost phone: someone above removes it. College administrator -> their college's staff and students; platform administrator -> college administrators.
CREATE FUNCTION auth.mfa_admin_reset(p_target uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_role text := app.current_role(); v_c uuid := app.current_college_id(); t users%ROWTYPE;
BEGIN
  SELECT * INTO t FROM users WHERE id = p_target;
  IF NOT FOUND OR NOT coalesce(
       (v_role = 'COLLEGE_ADMIN' AND t.college_id = v_c AND t.role IN ('PLACEMENT_OFFICER', 'COORDINATOR', 'STUDENT'))
    OR (v_role = 'PLATFORM_SUPER_ADMIN' AND t.role = 'COLLEGE_ADMIN'), false) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT auth.mfa_enabled(p_target) THEN RAISE EXCEPTION 'Two-step sign-in is not on for this account.' USING ERRCODE = '22023'; END IF;
  DELETE FROM user_mfa WHERE user_id = p_target;
  DELETE FROM mfa_recovery_codes WHERE user_id = p_target;
  UPDATE sessions SET revoked_at = now() WHERE user_id = p_target AND revoked_at IS NULL;
  PERFORM auth.write_audit('COLLEGE', t.college_id, v_user, v_role, 'MFA_RESET', 'user', t.id::text, '{}'::jsonb, NULL);
END $$;

-- Whether an account the caller may reset has it on (for showing the button).
CREATE FUNCTION auth.mfa_can_reset(p_target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT auth.mfa_enabled(p_target) AND EXISTS (SELECT 1 FROM users t WHERE t.id = p_target AND (
       (app.current_role() = 'COLLEGE_ADMIN' AND t.college_id = app.current_college_id() AND t.role IN ('PLACEMENT_OFFICER', 'COORDINATOR', 'STUDENT'))
    OR (app.current_role() = 'PLATFORM_SUPER_ADMIN' AND t.role = 'COLLEGE_ADMIN')))
$$;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'auth' AND p.proname LIKE 'mfa\_%' LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO cc_app', f.sig);
  END LOOP;
END $$;
REVOKE CREATE ON SCHEMA auth FROM cc_auth;
