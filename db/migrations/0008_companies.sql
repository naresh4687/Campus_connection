-- 0008_companies: recruiting companies owned by a college's placement officers. Written only through audited functions
-- (placement.*); officers manage them, college admins have read-only oversight, nobody else sees them.

CREATE SCHEMA placement;
REVOKE ALL ON SCHEMA placement FROM PUBLIC;
GRANT USAGE ON SCHEMA placement TO cc_app;
GRANT USAGE, CREATE ON SCHEMA placement TO cc_auth;   -- CREATE revoked at the end

CREATE TABLE companies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id     uuid NOT NULL REFERENCES colleges (id),
  name           citext NOT NULL CHECK (length(btrim(name::text)) BETWEEN 2 AND 150),
  website        text CHECK (website IS NULL OR (length(website) <= 300 AND website ~* '^https?://[^[:space:]]+$')),
  industry       text CHECK (industry IS NULL OR length(btrim(industry)) BETWEEN 2 AND 80),
  description    text CHECK (description IS NULL OR length(description) <= 2000),
  contact_person text CHECK (contact_person IS NULL OR length(btrim(contact_person)) BETWEEN 2 AND 120),
  contact_email  citext CHECK (contact_email IS NULL OR (length(contact_email::text) BETWEEN 3 AND 254 AND contact_email::text ~ '^[^@[:space:]]+@[^@[:space:]]+$')),
  contact_phone  text CHECK (contact_phone IS NULL OR contact_phone ~ '^[0-9+() -]{7,20}$'),
  location       text CHECK (location IS NULL OR length(btrim(location)) BETWEEN 2 AND 150),
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by     uuid NOT NULL REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES users (id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_name_per_college UNIQUE (college_id, name),
  UNIQUE (college_id, id)
);
CREATE INDEX companies_status_idx ON companies (college_id, status, name);

CREATE FUNCTION placement.company_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'companies are retained (deactivate instead)' USING ERRCODE = '42501'; END IF;
  IF (NEW.college_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.college_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'company ownership and creation details are immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER companies_guard BEFORE UPDATE OR DELETE ON companies FOR EACH ROW EXECUTE FUNCTION placement.company_guard();

CREATE TABLE company_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  college_id    uuid NOT NULL,
  company_id    uuid NOT NULL,
  event         text NOT NULL CHECK (event IN ('CREATED', 'UPDATED', 'DEACTIVATED', 'REACTIVATED')),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  actor_name    text NOT NULL,
  detail        text CHECK (detail IS NULL OR length(detail) <= 500),   -- names of the fields that changed, never their values
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (college_id, company_id) REFERENCES companies (college_id, id)
);
CREATE INDEX company_events_company_idx ON company_events (company_id, occurred_at);
CREATE FUNCTION placement.events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'company history is append-only' USING ERRCODE = '42501'; END $$;
CREATE TRIGGER company_events_no_change BEFORE UPDATE OR DELETE ON company_events FOR EACH ROW EXECUTE FUNCTION placement.events_immutable();
CREATE TRIGGER company_events_no_truncate BEFORE TRUNCATE ON company_events FOR EACH STATEMENT EXECUTE FUNCTION placement.events_immutable();

GRANT SELECT, INSERT, UPDATE ON companies TO cc_auth;
GRANT SELECT, INSERT ON company_events TO cc_auth;
GRANT SELECT ON companies, company_events TO cc_app;          -- runtime role: read only
ALTER TABLE companies       ENABLE ROW LEVEL SECURITY; ALTER TABLE companies       FORCE ROW LEVEL SECURITY;
ALTER TABLE company_events  ENABLE ROW LEVEL SECURITY; ALTER TABLE company_events  FORCE ROW LEVEL SECURITY;

-- Placement officers (manage) and college admins (oversight) see their own college's companies. No one else.
CREATE POLICY companies_select ON companies FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN'));
CREATE POLICY company_events_select ON company_events FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN'));

-- ───────────── functions ─────────────
CREATE FUNCTION placement.require_officer(OUT o_user uuid, OUT o_college uuid, OUT o_name text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF app.current_role() IS DISTINCT FROM 'PLACEMENT_OFFICER' THEN RAISE EXCEPTION 'placement officers only' USING ERRCODE = '42501'; END IF;
  o_user := app.current_user_id(); o_college := app.current_college_id();
  SELECT full_name INTO o_name FROM users WHERE id = o_user;
END $$;

CREATE FUNCTION placement.create_company(p_name text, p_website text, p_industry text, p_description text, p_contact_person text, p_contact_email citext, p_contact_phone text, p_location text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; v_id uuid;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  INSERT INTO companies (college_id, name, website, industry, description, contact_person, contact_email, contact_phone, location, created_by)
  VALUES (v_c, btrim(p_name), nullif(btrim(coalesce(p_website, '')), ''), nullif(btrim(coalesce(p_industry, '')), ''), nullif(btrim(coalesce(p_description, '')), ''),
          nullif(btrim(coalesce(p_contact_person, '')), ''), nullif(lower(btrim(coalesce(p_contact_email::text, ''))), ''), nullif(btrim(coalesce(p_contact_phone, '')), ''),
          nullif(btrim(coalesce(p_location, '')), ''), v_u)
  RETURNING id INTO v_id;
  INSERT INTO company_events (college_id, company_id, event, actor_user_id, actor_name) VALUES (v_c, v_id, 'CREATED', v_u, v_n);
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'COMPANY_CREATED', 'company', v_id::text, '{}'::jsonb, NULL);
  RETURN v_id;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'A company with this name already exists.' USING ERRCODE = '23505';
  WHEN check_violation THEN RAISE EXCEPTION 'Some company details are invalid (check the name, website, email and phone).' USING ERRCODE = '22023';
END $$;

CREATE FUNCTION placement.update_company(p_id uuid, p_name text, p_website text, p_industry text, p_description text, p_contact_person text, p_contact_email citext, p_contact_phone text, p_location text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; o companies%ROWTYPE; n_ companies%ROWTYPE; v_changed text[] := '{}';
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  SELECT * INTO o FROM companies WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company not found' USING ERRCODE = '22023'; END IF;
  UPDATE companies SET name = btrim(p_name), website = nullif(btrim(coalesce(p_website, '')), ''), industry = nullif(btrim(coalesce(p_industry, '')), ''),
         description = nullif(btrim(coalesce(p_description, '')), ''), contact_person = nullif(btrim(coalesce(p_contact_person, '')), ''),
         contact_email = nullif(lower(btrim(coalesce(p_contact_email::text, ''))), ''), contact_phone = nullif(btrim(coalesce(p_contact_phone, '')), ''),
         location = nullif(btrim(coalesce(p_location, '')), ''), updated_by = v_u, updated_at = now()
   WHERE id = p_id RETURNING * INTO n_;
  IF n_.name IS DISTINCT FROM o.name THEN v_changed := array_append(v_changed, 'name'::text); END IF;
  IF n_.website IS DISTINCT FROM o.website THEN v_changed := array_append(v_changed, 'website'::text); END IF;
  IF n_.industry IS DISTINCT FROM o.industry THEN v_changed := array_append(v_changed, 'industry'::text); END IF;
  IF n_.description IS DISTINCT FROM o.description THEN v_changed := array_append(v_changed, 'description'::text); END IF;
  IF n_.contact_person IS DISTINCT FROM o.contact_person THEN v_changed := array_append(v_changed, 'contact person'::text); END IF;
  IF n_.contact_email IS DISTINCT FROM o.contact_email THEN v_changed := array_append(v_changed, 'contact email'::text); END IF;
  IF n_.contact_phone IS DISTINCT FROM o.contact_phone THEN v_changed := array_append(v_changed, 'contact phone'::text); END IF;
  IF n_.location IS DISTINCT FROM o.location THEN v_changed := array_append(v_changed, 'location'::text); END IF;
  IF array_length(v_changed, 1) IS NOT NULL THEN
    INSERT INTO company_events (college_id, company_id, event, actor_user_id, actor_name, detail) VALUES (v_c, p_id, 'UPDATED', v_u, v_n, 'Changed: ' || array_to_string(v_changed, ', '));
    PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'COMPANY_UPDATED', 'company', p_id::text, '{}'::jsonb, NULL);
  END IF;
EXCEPTION
  WHEN unique_violation THEN RAISE EXCEPTION 'A company with this name already exists.' USING ERRCODE = '23505';
  WHEN check_violation THEN RAISE EXCEPTION 'Some company details are invalid (check the name, website, email and phone).' USING ERRCODE = '22023';
END $$;

CREATE FUNCTION placement.set_company_status(p_id uuid, p_status text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; v_old text;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  IF p_status NOT IN ('ACTIVE', 'INACTIVE') THEN RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_old FROM companies WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company not found' USING ERRCODE = '22023'; END IF;
  IF v_old = p_status THEN RAISE EXCEPTION 'company is already %', lower(p_status) USING ERRCODE = '22023'; END IF;
  UPDATE companies SET status = p_status, updated_by = v_u, updated_at = now() WHERE id = p_id;
  INSERT INTO company_events (college_id, company_id, event, actor_user_id, actor_name) VALUES (v_c, p_id, CASE WHEN p_status = 'INACTIVE' THEN 'DEACTIVATED' ELSE 'REACTIVATED' END, v_u, v_n);
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', CASE WHEN p_status = 'INACTIVE' THEN 'COMPANY_DEACTIVATED' ELSE 'COMPANY_REACTIVATED' END, 'company', p_id::text, '{}'::jsonb, NULL);
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'placement' AND p.proname NOT IN ('company_guard', 'events_immutable') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION placement.create_company(text, text, text, text, text, citext, text, text),
                          placement.update_company(uuid, text, text, text, text, text, citext, text, text),
                          placement.set_company_status(uuid, text) TO cc_app;
-- placement.require_officer is internal.
REVOKE CREATE ON SCHEMA placement FROM cc_auth;
