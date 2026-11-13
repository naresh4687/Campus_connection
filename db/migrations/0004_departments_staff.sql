-- 0004_departments_staff: departments, coordinator assignments (the first department-scoped tenant data),
-- college profile editing, and invitation revocation. Every write goes through an audited function in schema `college`.

CREATE SCHEMA college;
REVOKE ALL ON SCHEMA college FROM PUBLIC;
GRANT USAGE ON SCHEMA college TO cc_app;
GRANT USAGE, CREATE ON SCHEMA college TO cc_auth;   -- CREATE revoked at the end
GRANT CREATE ON SCHEMA auth TO cc_auth;             -- (ownership transfer of auth.revoke_invitation; revoked at the end)

-- Lets child tables reference "a user of THIS college with THIS role" with a composite foreign key.
ALTER TABLE users ADD CONSTRAINT users_college_id_role_uq UNIQUE (college_id, id, role);

CREATE TABLE departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id  uuid NOT NULL REFERENCES colleges (id),
  name        citext NOT NULL CHECK (length(btrim(name::text)) BETWEEN 2 AND 100),
  code        citext NOT NULL CHECK (code::text ~ '^[A-Z0-9][A-Z0-9-]{1,11}$'),
  description text CHECK (length(description) <= 500),
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_by  uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, id),                       -- target for tenant-aware composite FKs
  CONSTRAINT departments_name_per_college UNIQUE (college_id, name),
  CONSTRAINT departments_code_per_college UNIQUE (college_id, code)
);

CREATE TABLE coordinator_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id    uuid NOT NULL,
  department_id uuid NOT NULL,
  user_id       uuid NOT NULL,
  user_role     text NOT NULL DEFAULT 'COORDINATOR' CHECK (user_role = 'COORDINATOR'),
  assigned_by   uuid NOT NULL REFERENCES users (id),
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  ended_by      uuid REFERENCES users (id),
  -- Tenant-aware: the department and the user must belong to the SAME college, and the user must be a COORDINATOR.
  FOREIGN KEY (college_id, department_id) REFERENCES departments (college_id, id),
  FOREIGN KEY (college_id, user_id, user_role) REFERENCES users (college_id, id, role),
  CONSTRAINT assignment_end_consistent CHECK ((ended_at IS NULL) = (ended_by IS NULL))
);
CREATE UNIQUE INDEX coordinator_assignments_one_active ON coordinator_assignments (department_id, user_id) WHERE ended_at IS NULL;
CREATE INDEX coordinator_assignments_user_idx ON coordinator_assignments (user_id) WHERE ended_at IS NULL;
CREATE INDEX coordinator_assignments_college_idx ON coordinator_assignments (college_id);

GRANT SELECT, INSERT, UPDATE ON departments, coordinator_assignments TO cc_auth;
GRANT SELECT ON departments, coordinator_assignments TO cc_app;      -- no INSERT/UPDATE/DELETE for the runtime role

ALTER TABLE departments             ENABLE ROW LEVEL SECURITY; ALTER TABLE departments             FORCE ROW LEVEL SECURITY;
ALTER TABLE coordinator_assignments ENABLE ROW LEVEL SECURITY; ALTER TABLE coordinator_assignments FORCE ROW LEVEL SECURITY;

-- Admins and placement officers see every department of THEIR college; a coordinator sees ONLY the departments they are
-- currently assigned to; nobody else (students, platform admin) sees any, until a later phase gives students their own.
CREATE POLICY departments_select_staff ON departments FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('COLLEGE_ADMIN', 'PLACEMENT_OFFICER'));
CREATE POLICY departments_select_coordinator ON departments FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) = 'COORDINATOR'
         AND id IN (SELECT a.department_id FROM coordinator_assignments a WHERE a.user_id = app.current_user_id() AND a.ended_at IS NULL));

CREATE POLICY assignments_select_staff ON coordinator_assignments FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('COLLEGE_ADMIN', 'PLACEMENT_OFFICER'));
CREATE POLICY assignments_select_own ON coordinator_assignments FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) = 'COORDINATOR' AND user_id = app.current_user_id());

-- ───────────── functions ─────────────
-- Caller must be an active COLLEGE_ADMIN of an ACTIVE college; returns (user id, college id).
CREATE FUNCTION college.require_admin(OUT o_user uuid, OUT o_college uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF app.current_role() IS DISTINCT FROM 'COLLEGE_ADMIN' THEN RAISE EXCEPTION 'college administrator only' USING ERRCODE = '42501'; END IF;
  o_user := app.current_user_id(); o_college := app.current_college_id();
END $$;

CREATE FUNCTION college.create_department(p_name text, p_code text, p_description text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_id uuid;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  INSERT INTO departments (college_id, name, code, description, created_by)
  VALUES (v_c, btrim(p_name), upper(btrim(p_code)), nullif(btrim(coalesce(p_description, '')), ''), v_u) RETURNING id INTO v_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'DEPARTMENT_CREATED', 'department', v_id::text, jsonb_build_object('code', upper(btrim(p_code))), NULL);
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'A department with this name or code already exists.' USING ERRCODE = '23505';
END $$;

CREATE FUNCTION college.update_department(p_id uuid, p_name text, p_code text, p_description text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  UPDATE departments SET name = btrim(p_name), code = upper(btrim(p_code)), description = nullif(btrim(coalesce(p_description, '')), ''), updated_at = now()
   WHERE id = p_id AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'department not found' USING ERRCODE = '22023'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'DEPARTMENT_UPDATED', 'department', p_id::text, '{}'::jsonb, NULL);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'A department with this name or code already exists.' USING ERRCODE = '23505';
END $$;

CREATE FUNCTION college.set_department_status(p_id uuid, p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_old text;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  IF p_status NOT IN ('ACTIVE', 'INACTIVE') THEN RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_old FROM departments WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'department not found' USING ERRCODE = '22023'; END IF;
  IF v_old = p_status THEN RAISE EXCEPTION 'department is already %', lower(p_status) USING ERRCODE = '22023'; END IF;
  UPDATE departments SET status = p_status, updated_at = now() WHERE id = p_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', CASE WHEN p_status = 'INACTIVE' THEN 'DEPARTMENT_DEACTIVATED' ELSE 'DEPARTMENT_REACTIVATED' END,
                           'department', p_id::text, '{}'::jsonb, NULL);
END $$;

CREATE FUNCTION college.assign_coordinator(p_department uuid, p_user uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_dept_status text; v_target users%ROWTYPE;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  SELECT status INTO v_dept_status FROM departments WHERE id = p_department AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'department not found' USING ERRCODE = '22023'; END IF;
  IF v_dept_status <> 'ACTIVE' THEN RAISE EXCEPTION 'cannot assign a coordinator to an inactive department' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_target FROM users WHERE id = p_user AND college_id = v_c AND role = 'COORDINATOR';
  IF NOT FOUND THEN RAISE EXCEPTION 'coordinator not found' USING ERRCODE = '22023'; END IF;
  IF v_target.status <> 'ACTIVE' THEN RAISE EXCEPTION 'cannot assign a disabled account' USING ERRCODE = '22023'; END IF;
  INSERT INTO coordinator_assignments (college_id, department_id, user_id, assigned_by) VALUES (v_c, p_department, p_user, v_u);
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'COORDINATOR_ASSIGNED', 'department', p_department::text, jsonb_build_object('user_id', p_user), NULL);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This coordinator is already assigned to the department.' USING ERRCODE = '23505';
END $$;

CREATE FUNCTION college.unassign_coordinator(p_department uuid, p_user uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  UPDATE coordinator_assignments SET ended_at = now(), ended_by = v_u
   WHERE college_id = v_c AND department_id = p_department AND user_id = p_user AND ended_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'assignment not found' USING ERRCODE = '22023'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'COORDINATOR_UNASSIGNED', 'department', p_department::text, jsonb_build_object('user_id', p_user), NULL);
END $$;

-- College profile: only these fields are editable by the college. Name, official email, access status and commercial
-- data belong to the platform and cannot be changed here.
CREATE FUNCTION college.update_profile(p_address text, p_district text, p_state text, p_website text, p_contact_person text, p_contact_phone text, p_students int)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid;
BEGIN
  SELECT * INTO v_u, v_c FROM college.require_admin();
  IF length(btrim(coalesce(p_address, ''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'address must be 5-500 characters' USING ERRCODE = '22023'; END IF;
  IF length(btrim(coalesce(p_district, ''))) NOT BETWEEN 2 AND 100 THEN RAISE EXCEPTION 'district must be 2-100 characters' USING ERRCODE = '22023'; END IF;
  IF length(btrim(coalesce(p_state, ''))) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'state must be 2-60 characters' USING ERRCODE = '22023'; END IF;
  IF p_website IS NULL OR length(p_website) > 300 OR p_website !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION 'website must be an http(s) address' USING ERRCODE = '22023'; END IF;
  IF length(btrim(coalesce(p_contact_person, ''))) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'contact person must be 2-120 characters' USING ERRCODE = '22023'; END IF;
  IF p_contact_phone IS NULL OR p_contact_phone !~ '^[0-9+() -]{7,20}$' THEN RAISE EXCEPTION 'invalid phone number' USING ERRCODE = '22023'; END IF;
  IF p_students IS NULL OR p_students NOT BETWEEN 10 AND 200000 THEN RAISE EXCEPTION 'student strength must be 10-200000' USING ERRCODE = '22023'; END IF;
  UPDATE colleges SET address = btrim(p_address), district = btrim(p_district), state = btrim(p_state), website = btrim(p_website),
                      contact_person = btrim(p_contact_person), contact_phone = btrim(p_contact_phone), approx_students = p_students, updated_at = now()
   WHERE id = v_c;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'COLLEGE_PROFILE_UPDATED', 'college', v_c::text, '{}'::jsonb, NULL);
END $$;

-- Revoke an unused invitation. College admins: staff/student invitations of their own college. Platform: college-admin invitations.
CREATE FUNCTION auth.revoke_invitation(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_actor uuid := app.current_user_id(); v_role text := app.current_role(); v_college uuid := app.current_college_id(); v_i invitations%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_role IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_i FROM invitations WHERE id = p_id AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation not found or no longer pending' USING ERRCODE = '22023'; END IF;
  IF NOT ((v_role = 'COLLEGE_ADMIN' AND v_i.college_id = v_college AND v_i.role IN ('PLACEMENT_OFFICER', 'COORDINATOR', 'STUDENT'))
       OR (v_role = 'PLATFORM_SUPER_ADMIN' AND v_i.role = 'COLLEGE_ADMIN')) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  UPDATE invitations SET revoked_at = now() WHERE id = p_id;
  PERFORM auth.write_audit('COLLEGE', v_i.college_id, v_actor, v_role, 'INVITATION_REVOKED', 'invitation', p_id::text, jsonb_build_object('role', v_i.role), NULL);
END $$;

-- ───────────── ownership + execute privileges ─────────────
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'college') OR (n.nspname = 'auth' AND p.proname = 'revoke_invitation') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION
  college.create_department(text, text, text), college.update_department(uuid, text, text, text), college.set_department_status(uuid, text),
  college.assign_coordinator(uuid, uuid), college.unassign_coordinator(uuid, uuid),
  college.update_profile(text, text, text, text, text, text, int), auth.revoke_invitation(uuid)
  TO cc_app;
-- college.require_admin is internal.
REVOKE CREATE ON SCHEMA college FROM cc_auth;
REVOKE CREATE ON SCHEMA auth FROM cc_auth;
