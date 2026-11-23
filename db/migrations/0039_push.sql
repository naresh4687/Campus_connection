-- 0039_push: real Web Push on top of the in-app notifications (0014).
-- Design (see PUSH_NOTIFICATIONS.md):
--  * Notifications are still created ONLY by the existing triggers. An AFTER INSERT trigger on `notifications` writes one outbox row
--    (push_jobs) in the SAME transaction, so a push exists if and only if its notification was committed, exactly once (unique notification_id).
--  * The tables below are invisible to the runtime role. Everything goes through SECURITY DEFINER functions owned by cc_auth:
--    user-facing ones act only on the caller's own rows (caller identity comes from the session context, never from an argument);
--    worker ones (claim / record / finish) are reached only by the dispatcher route, which requires a secret.
--  * A push carries no content: the worker builds a generic title from the category and the device opens /notifications/<id>/open,
--    which authenticates the user and checks the notification is theirs. Subscription endpoints and keys never leave the server.

CREATE SCHEMA push; REVOKE ALL ON SCHEMA push FROM PUBLIC; GRANT USAGE ON SCHEMA push TO cc_app; GRANT USAGE, CREATE ON SCHEMA push TO cc_auth;

CREATE TABLE push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id      uuid NOT NULL,
  user_id         uuid NOT NULL,
  -- only the real browser push services (no other host, port or userinfo): the server later makes requests to this URL
  endpoint        text NOT NULL CHECK (endpoint ~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)/[^[:space:]@]*$' AND char_length(endpoint) <= 1000),
  p256dh          text NOT NULL CHECK (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth            text NOT NULL CHECK (auth ~ '^[A-Za-z0-9_-]{20,32}$'),
  device_label    text CHECK (device_label IS NULL OR char_length(device_label) <= 80),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count   int NOT NULL DEFAULT 0,
  last_error      text CHECK (last_error IS NULL OR char_length(last_error) <= 200),
  FOREIGN KEY (college_id, user_id) REFERENCES users (college_id, id)
);
CREATE UNIQUE INDEX push_subscriptions_endpoint_key ON push_subscriptions (endpoint);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id) WHERE active;

-- One master switch per user (default on). Per-category choices stay in notification_preferences and apply to push as well.
CREATE TABLE push_settings (
  user_id      uuid PRIMARY KEY,
  college_id   uuid NOT NULL,
  push_enabled boolean NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (college_id, user_id) REFERENCES users (college_id, id)
);

-- The outbox: one job per notification, claimed with FOR UPDATE SKIP LOCKED.
CREATE TABLE push_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL UNIQUE REFERENCES notifications (id),
  college_id      uuid NOT NULL,
  user_id         uuid NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENDING', 'DONE', 'FAILED', 'SKIPPED')),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until    timestamptz,
  last_error      text CHECK (last_error IS NULL OR char_length(last_error) <= 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);
CREATE INDEX push_jobs_due_idx ON push_jobs (next_attempt_at) WHERE status IN ('PENDING', 'SENDING');

-- Delivery log. A SENT row per (job, subscription) is unique, so a retry can never send the same push to the same device twice.
CREATE TABLE push_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid NOT NULL REFERENCES push_jobs (id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES push_subscriptions (id) ON DELETE CASCADE,
  outcome         text NOT NULL CHECK (outcome IN ('SENT', 'EXPIRED', 'RETRY', 'FAILED')),
  http_status     int,
  detail          text CHECK (detail IS NULL OR char_length(detail) <= 200),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX push_deliveries_sent_key ON push_deliveries (job_id, subscription_id) WHERE outcome = 'SENT';

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY; ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE push_settings      ENABLE ROW LEVEL SECURITY; ALTER TABLE push_settings      FORCE ROW LEVEL SECURITY;
ALTER TABLE push_jobs          ENABLE ROW LEVEL SECURITY; ALTER TABLE push_jobs          FORCE ROW LEVEL SECURITY;
ALTER TABLE push_deliveries    ENABLE ROW LEVEL SECURITY; ALTER TABLE push_deliveries    FORCE ROW LEVEL SECURITY;
-- No policy and no grant for cc_app: the runtime role cannot even see these tables. cc_auth (the definer) bypasses RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions, push_jobs, push_deliveries TO cc_auth;
GRANT SELECT, INSERT, UPDATE ON push_settings TO cc_auth;

-- ── outbox trigger ──
CREATE FUNCTION push.on_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  -- Only users with at least one active device and the master switch on get a job (everyone else just has the in-app inbox).
  INSERT INTO push_jobs (notification_id, college_id, user_id)
  SELECT NEW.id, NEW.college_id, NEW.user_id
   WHERE EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = NEW.user_id AND s.active)
     AND coalesce((SELECT ps.push_enabled FROM push_settings ps WHERE ps.user_id = NEW.user_id), true)
  ON CONFLICT (notification_id) DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER notifications_push AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION push.on_notification();

-- ── user-facing functions: the caller's own rows only ──
CREATE FUNCTION push.subscribe(p_endpoint text, p_p256dh text, p_auth text, p_label text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_id uuid; v_owner uuid;
BEGIN
  IF v_u IS NULL OR v_c IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_u AND college_id = v_c AND status = 'ACTIVE') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF p_endpoint IS NULL OR p_endpoint !~* '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)/[^[:space:]@]*$' OR char_length(p_endpoint) > 1000
     OR p_p256dh IS NULL OR p_p256dh !~ '^[A-Za-z0-9_-]{80,100}$' OR p_auth IS NULL OR p_auth !~ '^[A-Za-z0-9_-]{20,32}$' THEN
    RAISE EXCEPTION 'invalid push subscription' USING ERRCODE = '22023';
  END IF;
  -- An endpoint that is active for ANOTHER account is never taken over (it would silently cut that person's notifications off): the device
  -- must create a new subscription instead (the browser does this when it sees the error).
  SELECT id, user_id INTO v_id, v_owner FROM push_subscriptions WHERE endpoint = p_endpoint FOR UPDATE;
  IF FOUND AND v_owner <> v_u AND (SELECT active FROM push_subscriptions WHERE id = v_id) THEN
    RAISE EXCEPTION 'this device is registered to another account' USING ERRCODE = '23505';
  END IF;
  IF FOUND THEN
    UPDATE push_subscriptions SET college_id = v_c, user_id = v_u, p256dh = p_p256dh, auth = p_auth, device_label = left(p_label, 80), active = true,
           failure_count = 0, last_error = NULL, updated_at = now() WHERE id = v_id;
  ELSE
    INSERT INTO push_subscriptions (college_id, user_id, endpoint, p256dh, auth, device_label) VALUES (v_c, v_u, p_endpoint, p_p256dh, p_auth, left(p_label, 80)) RETURNING id INTO v_id;
  END IF;
  -- At most 10 active devices per account: the newest win.
  UPDATE push_subscriptions SET active = false, updated_at = now()
   WHERE user_id = v_u AND active AND id NOT IN (SELECT id FROM push_subscriptions WHERE user_id = v_u AND active ORDER BY updated_at DESC, id LIMIT 10);
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, app.current_role(), 'PUSH_SUBSCRIBED', 'push_subscription', v_id::text, '{}'::jsonb, NULL);
  RETURN v_id;
END $$;

CREATE FUNCTION push.unsubscribe(p_endpoint text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_id uuid;
BEGIN
  IF v_u IS NULL OR v_c IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  UPDATE push_subscriptions SET active = false, updated_at = now() WHERE endpoint = p_endpoint AND user_id = v_u AND college_id = v_c AND active RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN false; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, app.current_role(), 'PUSH_UNSUBSCRIBED', 'push_subscription', v_id::text, '{}'::jsonb, NULL);
  RETURN true;
END $$;

CREATE FUNCTION push.remove_device(p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_n int;
BEGIN
  IF v_u IS NULL OR v_c IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  UPDATE push_subscriptions SET active = false, updated_at = now() WHERE id = p_id AND user_id = v_u AND college_id = v_c AND active;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN PERFORM auth.write_audit('COLLEGE', v_c, v_u, app.current_role(), 'PUSH_UNSUBSCRIBED', 'push_subscription', p_id::text, '{}'::jsonb, NULL); END IF;
  RETURN v_n > 0;
END $$;

-- Never returns endpoints or keys.
CREATE FUNCTION push.my_devices() RETURNS TABLE (id uuid, device_label text, created_at timestamptz, last_success_at timestamptz)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT s.id, s.device_label, s.created_at, s.last_success_at FROM push_subscriptions s
   WHERE s.user_id = app.current_user_id() AND s.college_id = app.current_college_id() AND s.active ORDER BY s.created_at DESC
$$;

CREATE FUNCTION push.is_subscribed(p_endpoint text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.endpoint = p_endpoint AND s.user_id = app.current_user_id() AND s.college_id = app.current_college_id() AND s.active)
$$;

CREATE FUNCTION push.get_enabled() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((SELECT ps.push_enabled FROM push_settings ps WHERE ps.user_id = app.current_user_id()), true)
$$;

CREATE FUNCTION push.set_enabled(p_enabled boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid := app.current_user_id(); v_c uuid := app.current_college_id();
BEGIN
  IF v_u IS NULL OR v_c IS NULL OR p_enabled IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  INSERT INTO push_settings (college_id, user_id, push_enabled) VALUES (v_c, v_u, p_enabled)
  ON CONFLICT (user_id) DO UPDATE SET push_enabled = EXCLUDED.push_enabled, updated_at = now();
END $$;

-- ── worker functions (reached only by the dispatcher route, which requires PUSH_WORKER_SECRET) ──
-- Claims due jobs (also jobs whose earlier worker died: lock expired), re-checks the recipient's choices AT DELIVERY TIME, and returns one row per
-- device still to be sent to (devices already sent to for that job are not returned again).
CREATE FUNCTION push.claim(p_limit int, p_lock_seconds int)
  RETURNS TABLE (job_id uuid, notification_id uuid, category text, attempt int, subscription_id uuid, endpoint text, p256dh text, auth text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_ids uuid[];
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 OR p_lock_seconds IS NULL OR p_lock_seconds < 10 OR p_lock_seconds > 900 THEN RAISE EXCEPTION 'invalid arguments' USING ERRCODE = '22023'; END IF;
  WITH due AS (
    SELECT j.id FROM push_jobs j
     WHERE (j.status = 'PENDING' AND j.next_attempt_at <= now()) OR (j.status = 'SENDING' AND j.locked_until < now())
     ORDER BY j.next_attempt_at, j.id LIMIT p_limit FOR UPDATE SKIP LOCKED),
  upd AS (
    UPDATE push_jobs j SET status = 'SENDING', locked_until = now() + make_interval(secs => p_lock_seconds), attempts = j.attempts + 1
      FROM due WHERE j.id = due.id RETURNING j.id)
  SELECT coalesce(array_agg(upd.id), '{}') INTO v_ids FROM upd;

  -- Delivery-time checks: closed account, already read in the app, master switch off, category switched off (offers and placement cannot be).
  UPDATE push_jobs j SET status = 'SKIPPED', locked_until = NULL, completed_at = now()
    FROM notifications n, users u
   WHERE j.id = ANY (v_ids) AND n.id = j.notification_id AND u.id = j.user_id
     AND (u.status <> 'ACTIVE' OR n.read_at IS NOT NULL
          OR NOT coalesce((SELECT ps.push_enabled FROM push_settings ps WHERE ps.user_id = u.id), true)
          OR (NOT notifications.is_essential(n.category) AND EXISTS (SELECT 1 FROM notification_preferences np WHERE np.user_id = u.id AND np.category = n.category AND NOT np.enabled)));

  -- Nothing left to send (no active device, or every device already has it): finished.
  UPDATE push_jobs j SET status = 'DONE', locked_until = NULL, completed_at = now()
   WHERE j.id = ANY (v_ids) AND j.status = 'SENDING'
     AND NOT EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = j.user_id AND s.active
                        AND NOT EXISTS (SELECT 1 FROM push_deliveries d WHERE d.job_id = j.id AND d.subscription_id = s.id AND d.outcome = 'SENT'));

  RETURN QUERY
    SELECT j.id, j.notification_id, n.category, j.attempts, s.id, s.endpoint, s.p256dh, s.auth
      FROM push_jobs j JOIN notifications n ON n.id = j.notification_id
      JOIN push_subscriptions s ON s.user_id = j.user_id AND s.college_id = j.college_id AND s.active
     WHERE j.id = ANY (v_ids) AND j.status = 'SENDING'
       AND NOT EXISTS (SELECT 1 FROM push_deliveries d WHERE d.job_id = j.id AND d.subscription_id = s.id AND d.outcome = 'SENT');
END $$;

CREATE FUNCTION push.record(p_job uuid, p_sub uuid, p_outcome text, p_status int, p_detail text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_outcome NOT IN ('SENT', 'EXPIRED', 'RETRY', 'FAILED') THEN RAISE EXCEPTION 'invalid outcome' USING ERRCODE = '22023'; END IF;
  INSERT INTO push_deliveries (job_id, subscription_id, outcome, http_status, detail) VALUES (p_job, p_sub, p_outcome, p_status, left(p_detail, 200)) ON CONFLICT DO NOTHING;
  IF p_outcome = 'SENT' THEN
    UPDATE push_subscriptions SET last_success_at = now(), failure_count = 0, last_error = NULL, updated_at = now() WHERE id = p_sub;
  ELSIF p_outcome = 'EXPIRED' THEN   -- 404 / 410 from the push service: the browser has dropped this subscription
    UPDATE push_subscriptions SET active = false, last_failure_at = now(), last_error = left(coalesce(p_detail, 'expired'), 200), updated_at = now() WHERE id = p_sub;
  ELSE
    UPDATE push_subscriptions SET last_failure_at = now(), failure_count = failure_count + 1, last_error = left(p_detail, 200), updated_at = now(),
           active = (failure_count + 1) < 10 WHERE id = p_sub;
  END IF;
END $$;

-- Done, or retry with exponential backoff (30 s, 2 min, 8 min, 32 min), then a terminal FAILED state after 5 attempts.
CREATE FUNCTION push.finish(p_job uuid, p_retry boolean, p_error text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE j push_jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM push_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND OR j.status <> 'SENDING' THEN RETURN 'IGNORED'; END IF;
  IF NOT p_retry THEN
    UPDATE push_jobs SET status = 'DONE', locked_until = NULL, completed_at = now(), last_error = NULL WHERE id = p_job; RETURN 'DONE';
  ELSIF j.attempts >= 5 THEN
    UPDATE push_jobs SET status = 'FAILED', locked_until = NULL, completed_at = now(), last_error = left(p_error, 200) WHERE id = p_job; RETURN 'FAILED';
  ELSE
    UPDATE push_jobs SET status = 'PENDING', locked_until = NULL, last_error = left(p_error, 200), next_attempt_at = now() + make_interval(secs => 30 * power(4, j.attempts - 1)::int) WHERE id = p_job; RETURN 'PENDING';
  END IF;
END $$;

CREATE FUNCTION push.health() RETURNS TABLE (pending int, sending int, failed int, oldest_pending_seconds int, sent_24h int, expired_24h int, active_devices int)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT (SELECT count(*)::int FROM push_jobs WHERE status = 'PENDING'), (SELECT count(*)::int FROM push_jobs WHERE status = 'SENDING'),
         (SELECT count(*)::int FROM push_jobs WHERE status = 'FAILED' AND completed_at > now() - interval '7 days'),
         (SELECT coalesce(extract(epoch FROM now() - min(next_attempt_at))::int, 0) FROM push_jobs WHERE status = 'PENDING' AND next_attempt_at <= now()),
         (SELECT count(*)::int FROM push_deliveries WHERE outcome = 'SENT' AND created_at > now() - interval '1 day'),
         (SELECT count(*)::int FROM push_deliveries WHERE outcome = 'EXPIRED' AND created_at > now() - interval '1 day'),
         (SELECT count(*)::int FROM push_subscriptions WHERE active)
$$;

-- Housekeeping: finished jobs and their logs after 30 days; devices that have been inactive for 30 days.
CREATE FUNCTION push.purge() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE a int; b int;
BEGIN
  DELETE FROM push_jobs WHERE status IN ('DONE', 'SKIPPED', 'FAILED') AND completed_at < now() - interval '30 days'; GET DIAGNOSTICS a = ROW_COUNT;
  DELETE FROM push_subscriptions WHERE NOT active AND updated_at < now() - interval '30 days'; GET DIAGNOSTICS b = ROW_COUNT;
  RETURN a + b;
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'push' LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION push.subscribe(text, text, text, text), push.unsubscribe(text), push.remove_device(uuid), push.my_devices(), push.is_subscribed(text),
  push.get_enabled(), push.set_enabled(boolean), push.claim(int, int), push.record(uuid, uuid, text, int, text), push.finish(uuid, boolean, text), push.health(), push.purge() TO cc_app;
REVOKE CREATE ON SCHEMA push FROM cc_auth;
