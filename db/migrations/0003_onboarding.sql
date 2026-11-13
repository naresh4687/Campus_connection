-- 0003_onboarding: college applications, college profile + commercial status, contact inquiries,
-- and the `platform` function layer. After this migration colleges can ONLY be created by approving an
-- application, and changed only through audited functions (direct INSERT/UPDATE grants are removed).

CREATE SCHEMA platform;
REVOKE ALL ON SCHEMA platform FROM PUBLIC;
GRANT USAGE ON SCHEMA platform TO cc_app;
GRANT USAGE, CREATE ON SCHEMA platform TO cc_auth;   -- CREATE revoked at the end (ownership transfer only)

-- ───────────── colleges: profile + commercial status ─────────────
ALTER TABLE colleges
  ADD COLUMN application_id        uuid,
  ADD COLUMN official_email        citext,
  ADD COLUMN address               text,
  ADD COLUMN state                 text,
  ADD COLUMN district              text,
  ADD COLUMN website               text CHECK (website IS NULL OR website ~* '^https?://[^[:space:]]+$'),
  ADD COLUMN college_type          text,
  ADD COLUMN contact_person        text,
  ADD COLUMN contact_phone         text,
  ADD COLUMN approx_students       int,
  -- Commercial status is a MANUAL record in v1 (no payments are simulated). It does not by itself block access;
  -- suspension of access is the separate `status` column.
  ADD COLUMN commercial_status     text NOT NULL DEFAULT 'NOT_STARTED'
             CHECK (commercial_status IN ('NOT_STARTED', 'PENDING', 'ACTIVE', 'EXPIRED', 'SUSPENDED')),
  ADD COLUMN commercial_note       text CHECK (length(commercial_note) <= 1000),
  ADD COLUMN commercial_updated_at timestamptz,
  ADD COLUMN suspended_reason      text CHECK (length(suspended_reason) <= 1000),
  ADD COLUMN suspended_at          timestamptz,
  ADD CONSTRAINT colleges_suspension_reason CHECK (status <> 'SUSPENDED' OR length(btrim(coalesce(suspended_reason, ''))) >= 5);

-- ───────────── applications ─────────────
CREATE TABLE college_applications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_hash    bytea NOT NULL UNIQUE,   -- SHA-256 of the applicant's status-link token (token never stored)
  status            text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')),
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  official_email    citext NOT NULL CHECK (length(official_email::text) BETWEEN 3 AND 254 AND position('@' IN official_email::text) > 1),
  address           text NOT NULL CHECK (length(btrim(address)) BETWEEN 5 AND 500),
  state             text NOT NULL CHECK (length(btrim(state)) BETWEEN 2 AND 60),
  district          text NOT NULL CHECK (length(btrim(district)) BETWEEN 2 AND 100),
  website           text NOT NULL CHECK (length(website) <= 300 AND website ~* '^https?://[^[:space:]]+$'),
  contact_person    text NOT NULL CHECK (length(btrim(contact_person)) BETWEEN 2 AND 120),
  phone             text NOT NULL CHECK (phone ~ '^[0-9+() -]{7,20}$'),
  college_type      text NOT NULL CHECK (college_type IN ('GOVERNMENT', 'GOVERNMENT_AIDED', 'PRIVATE', 'DEEMED_UNIVERSITY', 'OTHER')),
  approx_students   int  NOT NULL CHECK (approx_students BETWEEN 10 AND 200000),
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  review_started_at timestamptz,
  reviewed_by       uuid REFERENCES users (id),
  decided_at        timestamptz,
  decision_reason   text CHECK (length(decision_reason) <= 1000),
  college_id        uuid UNIQUE REFERENCES colleges (id),
  CONSTRAINT app_rejection_reason CHECK (status <> 'REJECTED' OR length(btrim(coalesce(decision_reason, ''))) >= 5),
  CONSTRAINT app_approved_has_college CHECK ((status = 'APPROVED') = (college_id IS NOT NULL)),
  CONSTRAINT app_decided_at CHECK ((status IN ('APPROVED', 'REJECTED')) = (decided_at IS NOT NULL)),
  CONSTRAINT app_reviewed CHECK (status = 'SUBMITTED' OR reviewed_by IS NOT NULL)
);
-- At most one live application per official email (rejected ones may re-apply).
CREATE UNIQUE INDEX college_applications_one_live ON college_applications (official_email)
  WHERE status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED');
CREATE INDEX college_applications_status_idx ON college_applications (status, submitted_at DESC);
ALTER TABLE colleges ADD CONSTRAINT colleges_application_fk FOREIGN KEY (application_id) REFERENCES college_applications (id);
CREATE UNIQUE INDEX colleges_application_uq ON colleges (application_id) WHERE application_id IS NOT NULL;

-- State machine enforced by the database itself, whoever writes: SUBMITTED -> UNDER_REVIEW -> APPROVED | REJECTED.
-- Terminal states are frozen; what the applicant submitted can never be edited; rows are never deleted.
CREATE FUNCTION platform.application_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'applications are retained' USING ERRCODE = '42501'; END IF;
  IF OLD.status IN ('APPROVED', 'REJECTED') THEN RAISE EXCEPTION 'application is already decided' USING ERRCODE = '42501'; END IF;
  IF NOT ((OLD.status = 'SUBMITTED' AND NEW.status IN ('SUBMITTED', 'UNDER_REVIEW'))
       OR (OLD.status = 'UNDER_REVIEW' AND NEW.status IN ('UNDER_REVIEW', 'APPROVED', 'REJECTED'))) THEN
    RAISE EXCEPTION 'illegal application status transition % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;
  IF (NEW.name, NEW.official_email, NEW.address, NEW.state, NEW.district, NEW.website, NEW.contact_person, NEW.phone,
      NEW.college_type, NEW.approx_students, NEW.reference_hash, NEW.submitted_at)
     IS DISTINCT FROM
     (OLD.name, OLD.official_email, OLD.address, OLD.state, OLD.district, OLD.website, OLD.contact_person, OLD.phone,
      OLD.college_type, OLD.approx_students, OLD.reference_hash, OLD.submitted_at) THEN
    RAISE EXCEPTION 'submitted application details are immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER college_applications_guard BEFORE UPDATE OR DELETE ON college_applications
  FOR EACH ROW EXECUTE FUNCTION platform.application_guard();

-- ───────────── inquiries (contact form) ─────────────
CREATE TABLE contact_inquiries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  email        citext NOT NULL CHECK (length(email::text) BETWEEN 3 AND 254 AND position('@' IN email::text) > 1),
  organization text CHECK (length(organization) <= 200),
  message      text NOT NULL CHECK (length(btrim(message)) BETWEEN 10 AND 2000),
  status       text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'HANDLED')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  handled_by   uuid REFERENCES users (id),
  handled_at   timestamptz,
  CONSTRAINT inquiry_handled CHECK ((status = 'HANDLED') = (handled_at IS NOT NULL AND handled_by IS NOT NULL))
);
CREATE INDEX contact_inquiries_status_idx ON contact_inquiries (status, created_at DESC);

-- ───────────── privileges + RLS ─────────────
GRANT SELECT, INSERT, UPDATE ON college_applications, contact_inquiries TO cc_auth;
GRANT SELECT, UPDATE ON colleges TO cc_auth;  -- (already has INSERT from 0002)

ALTER TABLE college_applications ENABLE ROW LEVEL SECURITY; ALTER TABLE college_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE contact_inquiries    ENABLE ROW LEVEL SECURITY; ALTER TABLE contact_inquiries    FORCE ROW LEVEL SECURITY;

CREATE POLICY applications_select_platform ON college_applications FOR SELECT TO cc_app
  USING ((SELECT app.current_role()) = 'PLATFORM_SUPER_ADMIN');
CREATE POLICY inquiries_select_platform ON contact_inquiries FOR SELECT TO cc_app
  USING ((SELECT app.current_role()) = 'PLATFORM_SUPER_ADMIN');

-- Platform admins read applications/inquiries through RLS (policy above). The applicant's status-link hash is never readable.
GRANT SELECT (id, status, name, official_email, address, state, district, website, contact_person, phone, college_type, approx_students,
              submitted_at, review_started_at, reviewed_by, decided_at, decision_reason, college_id) ON college_applications TO cc_app;
GRANT SELECT ON contact_inquiries TO cc_app;

-- colleges can no longer be written directly by the runtime role
DROP POLICY colleges_insert ON colleges;
DROP POLICY colleges_update ON colleges;
REVOKE INSERT, UPDATE ON colleges FROM cc_app;
-- Tenants (and the platform) read the public profile columns directly. The two INTERNAL notes (commercial_note,
-- suspended_reason) are deliberately NOT granted to cc_app; the platform admin reads them via platform.college_internal().
GRANT SELECT (application_id, official_email, address, state, district, website, college_type, contact_person, contact_phone,
              approx_students, commercial_status, commercial_updated_at, suspended_at)
  ON colleges TO cc_app;

CREATE FUNCTION platform.require_admin() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF app.current_role() IS DISTINCT FROM 'PLATFORM_SUPER_ADMIN' THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE = '42501'; END IF;
  RETURN app.current_user_id();
END $$;

CREATE FUNCTION platform.college_internal(p_college uuid) RETURNS TABLE (commercial_note text, suspended_reason text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM platform.require_admin();
  RETURN QUERY SELECT c.commercial_note, c.suspended_reason FROM colleges c WHERE c.id = p_college;
END $$;

-- ───────────── public (anonymous) entry points ─────────────
CREATE FUNCTION platform.submit_application(p_ref_hash bytea, p_name text, p_email citext, p_address text, p_state text, p_district text,
                                           p_website text, p_contact text, p_phone text, p_type text, p_students int) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO college_applications (reference_hash, name, official_email, address, state, district, website, contact_person, phone, college_type, approx_students)
  VALUES (p_ref_hash, btrim(p_name), btrim(p_email::text), btrim(p_address), btrim(p_state), btrim(p_district), btrim(p_website), btrim(p_contact), btrim(p_phone), p_type, p_students)
  RETURNING id INTO v_id;
  PERFORM auth.write_audit('PLATFORM', NULL, NULL, NULL, 'APPLICATION_SUBMITTED', 'college_application', v_id::text, '{}'::jsonb, NULL);
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'duplicate_application' USING ERRCODE = '23505';
END $$;

CREATE FUNCTION platform.application_status(p_ref_hash bytea)
  RETURNS TABLE (status text, name text, submitted_at timestamptz, decided_at timestamptz, decision_reason text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT a.status, a.name, a.submitted_at, a.decided_at, CASE WHEN a.status = 'REJECTED' THEN a.decision_reason END
    FROM college_applications a WHERE a.reference_hash = p_ref_hash
$$;

CREATE FUNCTION platform.submit_inquiry(p_name text, p_email citext, p_org text, p_message text) RETURNS uuid
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO contact_inquiries (name, email, organization, message)
  VALUES (btrim(p_name), btrim(p_email::text), nullif(btrim(coalesce(p_org, '')), ''), btrim(p_message)) RETURNING id
$$;

-- ───────────── platform administrator actions ─────────────
CREATE FUNCTION platform.start_review(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := platform.require_admin(); v_a college_applications%ROWTYPE;
BEGIN
  SELECT * INTO v_a FROM college_applications WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'application not found' USING ERRCODE = '22023'; END IF;
  IF v_a.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'only a submitted application can be taken into review' USING ERRCODE = '22023'; END IF;
  UPDATE college_applications SET status = 'UNDER_REVIEW', review_started_at = now(), reviewed_by = v_actor WHERE id = p_id;
  PERFORM auth.write_audit('PLATFORM', NULL, v_actor, 'PLATFORM_SUPER_ADMIN', 'APPLICATION_REVIEW_STARTED', 'college_application', p_id::text, '{}'::jsonb, NULL);
END $$;

-- Approval creates the college workspace. The caller issues the one-time College Admin invitation in the SAME transaction
-- (auth.create_invitation), so a failure there rolls the approval back.
CREATE FUNCTION platform.approve_application(p_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := platform.require_admin(); v_a college_applications%ROWTYPE; v_college uuid; v_actor_email citext;
BEGIN
  SELECT * INTO v_a FROM college_applications WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'application not found' USING ERRCODE = '22023'; END IF;
  IF v_a.status <> 'UNDER_REVIEW' THEN RAISE EXCEPTION 'only an application under review can be approved' USING ERRCODE = '22023'; END IF;
  SELECT email INTO v_actor_email FROM users WHERE id = v_actor;
  IF v_actor_email = v_a.official_email THEN RAISE EXCEPTION 'conflict of interest: you cannot decide your own application' USING ERRCODE = '42501'; END IF;
  INSERT INTO colleges (name, application_id, official_email, address, state, district, website, college_type, contact_person, contact_phone, approx_students)
  VALUES (v_a.name, v_a.id, v_a.official_email, v_a.address, v_a.state, v_a.district, v_a.website, v_a.college_type, v_a.contact_person, v_a.phone, v_a.approx_students)
  RETURNING id INTO v_college;
  UPDATE college_applications SET status = 'APPROVED', college_id = v_college, decided_at = now(), reviewed_by = v_actor WHERE id = p_id;
  PERFORM auth.write_audit('PLATFORM', NULL, v_actor, 'PLATFORM_SUPER_ADMIN', 'APPLICATION_APPROVED', 'college_application', p_id::text,
                           jsonb_build_object('college_id', v_college), NULL);
  RETURN v_college;
END $$;

CREATE FUNCTION platform.reject_application(p_id uuid, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := platform.require_admin(); v_a college_applications%ROWTYPE; v_actor_email citext;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 OR length(p_reason) > 1000 THEN RAISE EXCEPTION 'a rejection reason of 5-1000 characters is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_a FROM college_applications WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'application not found' USING ERRCODE = '22023'; END IF;
  IF v_a.status <> 'UNDER_REVIEW' THEN RAISE EXCEPTION 'only an application under review can be rejected' USING ERRCODE = '22023'; END IF;
  SELECT email INTO v_actor_email FROM users WHERE id = v_actor;
  IF v_actor_email = v_a.official_email THEN RAISE EXCEPTION 'conflict of interest: you cannot decide your own application' USING ERRCODE = '42501'; END IF;
  UPDATE college_applications SET status = 'REJECTED', decision_reason = btrim(p_reason), decided_at = now(), reviewed_by = v_actor WHERE id = p_id;
  PERFORM auth.write_audit('PLATFORM', NULL, v_actor, 'PLATFORM_SUPER_ADMIN', 'APPLICATION_REJECTED', 'college_application', p_id::text, '{}'::jsonb, NULL);
END $$;

CREATE FUNCTION platform.set_commercial_status(p_college uuid, p_status text, p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := platform.require_admin(); v_old text;
BEGIN
  IF p_status NOT IN ('NOT_STARTED', 'PENDING', 'ACTIVE', 'EXPIRED', 'SUSPENDED') THEN RAISE EXCEPTION 'invalid commercial status' USING ERRCODE = '22023'; END IF;
  IF p_note IS NOT NULL AND length(p_note) > 1000 THEN RAISE EXCEPTION 'note too long' USING ERRCODE = '22023'; END IF;
  SELECT commercial_status INTO v_old FROM colleges WHERE id = p_college FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'college not found' USING ERRCODE = '22023'; END IF;
  UPDATE colleges SET commercial_status = p_status, commercial_note = nullif(btrim(coalesce(p_note, '')), ''), commercial_updated_at = now(), updated_at = now() WHERE id = p_college;
  PERFORM auth.write_audit('PLATFORM', NULL, v_actor, 'PLATFORM_SUPER_ADMIN', 'COMMERCIAL_STATUS_CHANGED', 'college', p_college::text,
                           jsonb_build_object('from', v_old, 'to', p_status), NULL);
END $$;

-- Suspending blocks ALL access for the college immediately (sessions stop resolving, RLS context becomes NULL).
CREATE FUNCTION platform.set_college_access(p_college uuid, p_status text, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := platform.require_admin(); v_old text;
BEGIN
  IF p_status NOT IN ('ACTIVE', 'SUSPENDED') THEN RAISE EXCEPTION 'invalid access status' USING ERRCODE = '22023'; END IF;
  IF p_status = 'SUSPENDED' AND (p_reason IS NULL OR length(btrim(p_reason)) < 5 OR length(p_reason) > 1000) THEN
    RAISE EXCEPTION 'a suspension reason of 5-1000 characters is required' USING ERRCODE = '22023';
  END IF;
  SELECT status INTO v_old FROM colleges WHERE id = p_college FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'college not found' USING ERRCODE = '22023'; END IF;
  IF v_old = p_status THEN RAISE EXCEPTION 'college is already %', lower(p_status) USING ERRCODE = '22023'; END IF;
  IF p_status = 'SUSPENDED' THEN
    UPDATE colleges SET status = 'SUSPENDED', suspended_reason = btrim(p_reason), suspended_at = now(), updated_at = now() WHERE id = p_college;
  ELSE
    UPDATE colleges SET status = 'ACTIVE', suspended_reason = NULL, suspended_at = NULL, updated_at = now() WHERE id = p_college;
  END IF;
  PERFORM auth.write_audit('PLATFORM', NULL, v_actor, 'PLATFORM_SUPER_ADMIN', CASE WHEN p_status = 'SUSPENDED' THEN 'COLLEGE_SUSPENDED' ELSE 'COLLEGE_REACTIVATED' END,
                           'college', p_college::text, jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), '')), NULL);
END $$;

CREATE FUNCTION platform.handle_inquiry(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := platform.require_admin();
BEGIN
  UPDATE contact_inquiries SET status = 'HANDLED', handled_by = v_actor, handled_at = now() WHERE id = p_id AND status = 'NEW';
  IF NOT FOUND THEN RAISE EXCEPTION 'inquiry not found or already handled' USING ERRCODE = '22023'; END IF;
  PERFORM auth.write_audit('PLATFORM', NULL, v_actor, 'PLATFORM_SUPER_ADMIN', 'INQUIRY_HANDLED', 'contact_inquiry', p_id::text, '{}'::jsonb, NULL);
END $$;

-- ───────────── ownership + execute privileges ─────────────
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'platform' LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION
  platform.submit_application(bytea, text, citext, text, text, text, text, text, text, text, int),
  platform.application_status(bytea), platform.submit_inquiry(text, citext, text, text),
  platform.start_review(uuid), platform.approve_application(uuid), platform.reject_application(uuid, text),
  platform.set_commercial_status(uuid, text, text), platform.set_college_access(uuid, text, text),
  platform.handle_inquiry(uuid), platform.college_internal(uuid)
  TO cc_app;
-- platform.require_admin is internal (called only by other definer functions owned by cc_auth).
REVOKE CREATE ON SCHEMA platform FROM cc_auth;
