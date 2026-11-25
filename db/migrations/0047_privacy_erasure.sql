-- 0047_privacy_erasure: a student asks for their personal data to be erased; a college administrator approves or declines.
-- Approval removes what identifies the student and keeps the placement history as anonymous rows (counts and reports stay true).
-- Retained on purpose: the append-only audit log (account ids and keyed hashes, a security record) and anonymous marks/outcomes.
-- Uploaded files are removed from storage by the application right after approval (and can be retried until every one is gone).

-- History tables are immutable for everyone. This is the single, narrow exception: only inside a definer function (running as cc_auth)
-- that has switched erasing on for its own transaction. The runtime role cannot satisfy both halves.
CREATE FUNCTION app.erasing() RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT current_user = 'cc_auth' AND coalesce(current_setting('app.erasing', true), '') = 'on'
$$;
REVOKE ALL ON FUNCTION app.erasing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.erasing() TO cc_auth;

DROP TRIGGER academic_submissions_guard ON academic_submissions;
CREATE TRIGGER academic_submissions_guard BEFORE UPDATE OR DELETE ON academic_submissions FOR EACH ROW WHEN (NOT app.erasing()) EXECUTE FUNCTION academics.submission_guard();
DROP TRIGGER documents_guard ON documents;
CREATE TRIGGER documents_guard BEFORE UPDATE OR DELETE ON documents FOR EACH ROW WHEN (NOT app.erasing()) EXECUTE FUNCTION documents.document_guard();
DROP TRIGGER document_events_no_change ON document_events;
CREATE TRIGGER document_events_no_change BEFORE UPDATE OR DELETE ON document_events FOR EACH ROW WHEN (NOT app.erasing()) EXECUTE FUNCTION documents.events_immutable();
DROP TRIGGER student_achievements_guard ON student_achievements;
CREATE TRIGGER student_achievements_guard BEFORE UPDATE OR DELETE ON student_achievements FOR EACH ROW WHEN (NOT app.erasing()) EXECUTE FUNCTION achievements.guard();
DROP TRIGGER join_requests_guard ON join_requests;
CREATE TRIGGER join_requests_guard BEFORE UPDATE OR DELETE ON join_requests FOR EACH ROW WHEN (NOT app.erasing()) EXECUTE FUNCTION students.join_guard();
DROP TRIGGER notifications_guard ON notifications;
CREATE TRIGGER notifications_guard BEFORE UPDATE OR DELETE ON notifications FOR EACH ROW WHEN (NOT app.erasing()) EXECUTE FUNCTION notifications.guard();
DROP TRIGGER registration_evidence_guard ON registration_evidence;
CREATE TRIGGER registration_evidence_guard BEFORE UPDATE OR DELETE ON registration_evidence FOR EACH ROW WHEN (NOT app.erasing()) EXECUTE FUNCTION registrations.evidence_guard();
DROP TRIGGER selection_events_no_change ON selection_events;
CREATE TRIGGER selection_events_no_change BEFORE UPDATE OR DELETE ON selection_events FOR EACH ROW WHEN (NOT app.erasing()) EXECUTE FUNCTION offers.append_only();
DROP TRIGGER selection_files_no_change ON selection_files;
CREATE TRIGGER selection_files_no_change BEFORE UPDATE OR DELETE ON selection_files FOR EACH ROW WHEN (NOT app.erasing()) EXECUTE FUNCTION offers.append_only();
DROP TRIGGER result_events_no_change ON round_result_events;
CREATE TRIGGER result_events_no_change BEFORE UPDATE OR DELETE ON round_result_events FOR EACH ROW WHEN (NOT app.erasing()) EXECUTE FUNCTION rounds.append_only();
DROP TRIGGER career_history_no_change ON career_preference_history;
CREATE TRIGGER career_history_no_change BEFORE UPDATE OR DELETE ON career_preference_history FOR EACH ROW WHEN (NOT app.erasing()) EXECUTE FUNCTION eligibility.append_only();

ALTER TABLE selection_files ADD COLUMN purged_at timestamptz;
-- an erased account can never be switched back on
ALTER TABLE users ADD CONSTRAINT users_erased_stay_disabled CHECK (email::text NOT LIKE '%@erased.invalid' OR status = 'DISABLED');
GRANT UPDATE ON document_events, selection_events, selection_files, round_result_events, career_preference_history TO cc_auth;

CREATE TABLE erasure_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id      uuid NOT NULL,
  student_id      uuid NOT NULL,
  user_id         uuid NOT NULL REFERENCES users (id),
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CANCELLED', 'DECLINED', 'ERASED')),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid REFERENCES users (id),
  decided_by_name text,
  decided_at      timestamptz,
  decision_reason text CHECK (decision_reason IS NULL OR length(decision_reason) <= 500),
  UNIQUE (college_id, id),
  FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id)
);
CREATE UNIQUE INDEX erasure_requests_one_open ON erasure_requests (student_id) WHERE status = 'PENDING';
GRANT SELECT, INSERT, UPDATE ON erasure_requests TO cc_auth;
GRANT SELECT ON erasure_requests TO cc_app;
ALTER TABLE erasure_requests ENABLE ROW LEVEL SECURITY; ALTER TABLE erasure_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY erasure_own ON erasure_requests FOR SELECT TO cc_app USING (user_id = (SELECT app.current_user_id()) AND (SELECT app.current_role()) = 'STUDENT');
CREATE POLICY erasure_admin ON erasure_requests FOR SELECT TO cc_app USING ((SELECT app.current_role()) = 'COLLEGE_ADMIN' AND college_id = (SELECT app.current_college_id()));

CREATE SCHEMA privacy; REVOKE ALL ON SCHEMA privacy FROM PUBLIC; GRANT USAGE ON SCHEMA privacy TO cc_app; GRANT USAGE, CREATE ON SCHEMA privacy TO cc_auth;
GRANT USAGE ON SCHEMA app TO cc_auth;

CREATE FUNCTION privacy.request_erasure() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_sid uuid; v_name text; v_id uuid;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  SELECT id, full_name INTO v_sid, v_name FROM students WHERE user_id = v_user AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Your student record could not be found.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM erasure_requests WHERE student_id = v_sid AND status = 'PENDING') THEN RAISE EXCEPTION 'You already have a deletion request waiting.' USING ERRCODE = '22023'; END IF;
  INSERT INTO erasure_requests (college_id, student_id, user_id) VALUES (v_c, v_sid, v_user) RETURNING id INTO v_id;
  PERFORM notifications.push_many(v_c, ARRAY(SELECT id FROM users WHERE college_id = v_c AND role = 'COLLEGE_ADMIN' AND status = 'ACTIVE'), 'TASKS',
    'Data deletion request', v_name || ' asks for their account and personal data to be deleted.', '/college/privacy');
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'STUDENT', 'ERASURE_REQUESTED', 'student', v_sid::text, '{}'::jsonb, NULL);
  RETURN v_id;
END $$;

CREATE FUNCTION privacy.cancel_erasure() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); r erasure_requests%ROWTYPE;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  UPDATE erasure_requests SET status = 'CANCELLED', decided_at = now() WHERE user_id = v_user AND college_id = v_c AND status = 'PENDING' RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'There is no waiting request to cancel.' USING ERRCODE = '22023'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'STUDENT', 'ERASURE_CANCELLED', 'student', r.student_id::text, '{}'::jsonb, NULL);
END $$;

-- The erasure itself. Internal: only privacy.decide_erasure may call it.
CREATE FUNCTION privacy.erase_student(p_college uuid, p_student uuid, p_user uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE st students%ROWTYPE; v_tag text := replace(p_student::text, '-', ''); v_anon text := 'Erased student'; v_email citext;
BEGIN
  SELECT * INTO st FROM students WHERE id = p_student AND college_id = p_college FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'student not found' USING ERRCODE = '22023'; END IF;
  v_email := ('erased-' || v_tag || '@erased.invalid')::citext;
  PERFORM set_config('app.erasing', 'on', true);

  -- sign-in and devices
  DELETE FROM sessions WHERE user_id = p_user;
  UPDATE password_resets SET used_at = coalesce(used_at, now()) WHERE user_id = p_user;
  UPDATE push_subscriptions SET active = false, endpoint = 'https://fcm.googleapis.com/erased/' || id::text, p256dh = repeat('A', 87), auth = repeat('A', 22),
    device_label = NULL, last_error = NULL, updated_at = now() WHERE user_id = p_user;

  -- messages that name them, in their own inbox and in other people's
  UPDATE notifications SET title = 'Erased', body = NULL WHERE user_id = p_user;
  UPDATE notifications SET title = left(replace(title, st.full_name, v_anon), 150), body = left(replace(body, st.full_name, v_anon), 300)
   WHERE college_id = p_college AND (position(st.full_name IN title) > 0 OR position(st.full_name IN coalesce(body, '')) > 0);

  -- how they joined
  UPDATE invitations SET email = v_email, revoked_at = CASE WHEN accepted_at IS NULL THEN coalesce(revoked_at, now()) ELSE revoked_at END
   WHERE college_id = p_college AND (student_id = p_student OR email = st.college_email);
  UPDATE join_requests SET full_name = v_anon, register_number = ('E-' || left(replace(id::text, '-', ''), 24))::citext, college_email = v_email, personal_email = NULL, phone = '0000000', ip_hash = NULL,
    password_hash = NULL, status = CASE WHEN status = 'PENDING' THEN 'REJECTED' ELSE status END, decided_at = coalesce(decided_at, now()),
    decision_reason = CASE WHEN status IN ('PENDING', 'REJECTED') THEN 'Erased on request' END
   WHERE college_id = p_college AND (student_id = p_student OR college_email = st.college_email OR register_number = st.register_number);
  UPDATE student_import_rows SET raw = NULL, normalized = NULL, errors = '[]'::jsonb WHERE college_id = p_college AND student_id = p_student;

  -- their record: free text goes, anonymous values stay
  UPDATE academic_submissions SET student_note = NULL, review_note = NULL WHERE student_id = p_student;
  UPDATE student_achievements SET title = 'Erased', description = NULL, link = NULL, review_note = NULL,
    rejection_reason = CASE WHEN rejection_reason IS NULL THEN NULL ELSE 'Erased on request' END WHERE student_id = p_student;
  UPDATE career_preference_history SET reason = 'Erased on request' WHERE student_id = p_student;
  UPDATE manual_placements SET note = NULL, review_note = NULL WHERE student_id = p_student;
  UPDATE documents SET original_name = 'erased-file', review_reason = CASE WHEN review_status = 'REJECTED' THEN 'Erased on request' END,
    status = 'DELETED', deleted_at = coalesce(deleted_at, now()) WHERE student_id = p_student;
  UPDATE document_events SET actor_name = CASE WHEN actor_user_id = p_user THEN v_anon ELSE actor_name END, detail = NULL
   WHERE document_id IN (SELECT id FROM documents WHERE student_id = p_student);
  UPDATE registration_evidence SET original_name = 'erased-file', review_note = NULL WHERE student_id = p_student;
  UPDATE selection_files SET original_name = 'erased-file' WHERE student_id = p_student;
  UPDATE selection_events SET actor_name = CASE WHEN actor_user_id = p_user THEN v_anon ELSE actor_name END, note = NULL
   WHERE selection_id IN (SELECT id FROM selections WHERE student_id = p_student);
  UPDATE round_result_events SET note = NULL WHERE registration_id IN (SELECT id FROM registrations WHERE student_id = p_student);

  -- identity
  UPDATE students SET full_name = v_anon, register_number = ('E-' || left(v_tag, 24))::citext, college_email = v_email, personal_email = NULL, phone = NULL, specialization = NULL,
    github_url = NULL, leetcode_url = NULL, linkedin_url = NULL, updated_at = now() WHERE id = p_student;
  UPDATE users SET full_name = v_anon, email = v_email, password_hash = 'erased', status = 'DISABLED', last_login_at = NULL, updated_at = now() WHERE id = p_user;

  PERFORM set_config('app.erasing', 'off', true);
END $$;

CREATE FUNCTION privacy.decide_erasure(p_request uuid, p_approve boolean, p_reason text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); r erasure_requests%ROWTYPE; v_name text; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF app.current_role() IS DISTINCT FROM 'COLLEGE_ADMIN' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM erasure_requests WHERE id = p_request AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'PENDING' THEN RAISE EXCEPTION 'This request was already decided.' USING ERRCODE = '22023'; END IF;
  IF NOT p_approve AND (v_reason IS NULL OR length(v_reason) NOT BETWEEN 5 AND 500) THEN RAISE EXCEPTION 'Give the student a reason (5 to 500 characters).' USING ERRCODE = '22023'; END IF;
  SELECT full_name INTO v_name FROM users WHERE id = v_user;
  UPDATE erasure_requests SET status = CASE WHEN p_approve THEN 'ERASED' ELSE 'DECLINED' END, decided_by = v_user, decided_by_name = coalesce(v_name, 'Administrator'), decided_at = now(),
    decision_reason = CASE WHEN p_approve THEN NULL ELSE v_reason END WHERE id = p_request;
  IF p_approve THEN
    PERFORM privacy.erase_student(v_c, r.student_id, r.user_id);
  ELSE
    PERFORM notifications.push_many(v_c, ARRAY[r.user_id], 'TASKS', 'Data deletion declined', left(v_reason, 300), '/student/privacy');
  END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, 'COLLEGE_ADMIN', CASE WHEN p_approve THEN 'STUDENT_ERASED' ELSE 'ERASURE_DECLINED' END, 'student', r.student_id::text, '{}'::jsonb, NULL);
END $$;

-- Requests for the administrator's page. Names come from the student record, so an erased one reads "Erased student".
CREATE FUNCTION privacy.erasure_list() RETURNS TABLE (id uuid, status text, requested_at timestamptz, decided_at timestamptz, decided_by_name text, full_name text, register_number text, files_left int)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT r.id, r.status, r.requested_at, r.decided_at, r.decided_by_name, s.full_name, s.register_number::text,
    CASE WHEN r.status = 'ERASED' THEN
      ((SELECT count(*) FROM documents d WHERE d.student_id = r.student_id AND d.purged_at IS NULL)
     + (SELECT count(*) FROM registration_evidence e WHERE e.student_id = r.student_id AND e.purged_at IS NULL)
     + (SELECT count(*) FROM selection_files f WHERE f.student_id = r.student_id AND f.purged_at IS NULL))::int ELSE 0 END
  FROM erasure_requests r JOIN students s ON s.id = r.student_id
  WHERE app.current_role() = 'COLLEGE_ADMIN' AND r.college_id = app.current_college_id() AND r.status <> 'CANCELLED'
  ORDER BY (r.status = 'PENDING') DESC, r.requested_at DESC LIMIT 200
$$;

-- Storage keys still to be removed for an approved request, and the mark that one is gone.
CREATE FUNCTION privacy.erasure_files(p_request uuid) RETURNS TABLE (storage_key text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_sid uuid;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'COLLEGE_ADMIN' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  SELECT r.student_id INTO v_sid FROM erasure_requests r WHERE r.id = p_request AND r.college_id = v_c AND r.status = 'ERASED';
  IF NOT FOUND THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT d.storage_key FROM documents d WHERE d.student_id = v_sid AND d.purged_at IS NULL
    UNION ALL SELECT e.storage_key FROM registration_evidence e WHERE e.student_id = v_sid AND e.purged_at IS NULL
    UNION ALL SELECT f.storage_key FROM selection_files f WHERE f.student_id = v_sid AND f.purged_at IS NULL;
END $$;

CREATE FUNCTION privacy.mark_file_erased(p_request uuid, p_key text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid := app.current_college_id(); v_sid uuid;
BEGIN
  IF app.current_role() IS DISTINCT FROM 'COLLEGE_ADMIN' THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  SELECT r.student_id INTO v_sid FROM erasure_requests r WHERE r.id = p_request AND r.college_id = v_c AND r.status = 'ERASED';
  IF NOT FOUND THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('app.erasing', 'on', true);
  UPDATE documents SET purged_at = now() WHERE student_id = v_sid AND storage_key = p_key AND purged_at IS NULL;
  UPDATE registration_evidence SET purged_at = now() WHERE student_id = v_sid AND storage_key = p_key AND purged_at IS NULL;
  UPDATE selection_files SET purged_at = now() WHERE student_id = v_sid AND storage_key = p_key AND purged_at IS NULL;
  PERFORM set_config('app.erasing', 'off', true);
END $$;

CREATE FUNCTION privacy.log_export() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF app.current_role() IS DISTINCT FROM 'STUDENT' THEN RAISE EXCEPTION 'students only' USING ERRCODE = '42501'; END IF;
  PERFORM auth.write_audit('COLLEGE', app.current_college_id(), app.current_user_id(), 'STUDENT', 'PERSONAL_DATA_DOWNLOADED', 'user', app.current_user_id()::text, '{}'::jsonb, NULL);
END $$;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'privacy' LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
REVOKE CREATE ON SCHEMA privacy FROM cc_auth;
GRANT EXECUTE ON FUNCTION privacy.request_erasure(), privacy.cancel_erasure(), privacy.decide_erasure(uuid, boolean, text), privacy.erasure_list(),
  privacy.erasure_files(uuid), privacy.mark_file_erased(uuid, text), privacy.log_export() TO cc_app;      -- erase_student is internal
