-- 0018_coordinator_invite_department: a coordinator invitation names the department it is for. When the invitation is accepted the new
-- coordinator is assigned to that department in the same transaction, so the administrator no longer needs a separate assign step.
-- (More departments can still be added later from the staff page.)

GRANT CREATE ON SCHEMA auth TO cc_auth;   -- temporary (new function + replacement); revoked at the end

ALTER TABLE invitations ADD COLUMN department_id uuid REFERENCES departments (id);
ALTER TABLE invitations ADD CONSTRAINT invitations_department_only_coordinator CHECK (department_id IS NULL OR role = 'COORDINATOR');

-- The runtime role reads invitations only through explicit column grants (the token hash is never readable); the staff page lists the department.
GRANT SELECT (department_id) ON invitations TO cc_app;

SET LOCAL ROLE cc_auth;

-- Staff invitation with an optional department. Coordinators MUST name one (active, in the administrator's own college); other roles must not.
-- It reuses auth.create_invitation for every other rule (who may invite whom, expiry, duplicate email, audit).
CREATE FUNCTION auth.create_staff_invitation(p_email citext, p_role text, p_college_id uuid, p_token_hash bytea, p_ttl_seconds int, p_department uuid)
  RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_college uuid := app.current_college_id(); v_id uuid;
BEGIN
  IF app.current_user_id() IS NULL OR app.current_role() IS DISTINCT FROM 'COLLEGE_ADMIN' THEN RAISE EXCEPTION 'only a college administrator may invite staff' USING ERRCODE = '42501'; END IF;
  IF p_role = 'COORDINATOR' THEN
    IF p_department IS NULL THEN RAISE EXCEPTION 'Choose the department this coordinator will look after.' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM departments WHERE id = p_department AND college_id = v_college AND status = 'ACTIVE') THEN
      RAISE EXCEPTION 'department not found or not active' USING ERRCODE = '22023';
    END IF;
  ELSIF p_department IS NOT NULL THEN
    RAISE EXCEPTION 'only coordinator invitations name a department' USING ERRCODE = '22023';
  END IF;
  v_id := auth.create_invitation(p_email, p_role, p_college_id, p_token_hash, p_ttl_seconds);
  UPDATE invitations SET department_id = p_department WHERE id = v_id;
  RETURN v_id;
END $$;

-- Accepting a coordinator invitation also assigns the department (if it is still active; otherwise the administrator assigns one later).
CREATE OR REPLACE FUNCTION auth.accept_invitation(p_token_hash bytea, p_full_name text, p_password_hash text)
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
  IF v_inv.role = 'STUDENT' THEN
    UPDATE students s SET user_id = v_uid, updated_at = now()
     WHERE s.id = v_inv.student_id AND s.college_id = v_inv.college_id AND s.user_id IS NULL AND s.college_email = v_inv.email;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_or_expired' USING ERRCODE = 'P0001'; END IF;
  END IF;
  IF v_inv.role = 'COORDINATOR' AND v_inv.department_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM departments d WHERE d.id = v_inv.department_id AND d.college_id = v_inv.college_id AND d.status = 'ACTIVE') THEN
    INSERT INTO coordinator_assignments (college_id, department_id, user_id, assigned_by) VALUES (v_inv.college_id, v_inv.department_id, v_uid, v_inv.invited_by);
    PERFORM auth.write_audit('COLLEGE', v_inv.college_id, v_inv.invited_by, 'COLLEGE_ADMIN', 'COORDINATOR_ASSIGNED', 'department', v_inv.department_id::text,
                             jsonb_build_object('user_id', v_uid, 'via', 'invitation'), NULL);
  END IF;
  UPDATE invitations SET accepted_at = now(), accepted_user_id = v_uid WHERE id = v_inv.id;
  PERFORM auth.write_audit('COLLEGE', v_inv.college_id, v_uid, v_inv.role, 'INVITATION_ACCEPTED', 'invitation', v_inv.id::text, '{}'::jsonb, NULL);
  RETURN QUERY SELECT v_uid, v_inv.role, v_inv.college_id;
END $$;

-- Lets the accept / invite pages say which department an invitation is for.
CREATE FUNCTION auth.peek_invitation_department(p_token_hash bytea) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT d.name FROM invitations i JOIN departments d ON d.id = i.department_id
   WHERE i.token_hash = p_token_hash AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
$$;

RESET ROLE;
REVOKE ALL ON FUNCTION auth.create_staff_invitation(citext, text, uuid, bytea, int, uuid), auth.peek_invitation_department(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.create_staff_invitation(citext, text, uuid, bytea, int, uuid), auth.peek_invitation_department(bytea) TO cc_app;
REVOKE CREATE ON SCHEMA auth FROM cc_auth;
