-- 0012_offers_placements: final selections, offers (NOT_ISSUED -> ISSUED -> ACCEPTED / DECLINED / WITHDRAWN), private offer letters and
-- joining proofs, and independently verified placements.
-- Separation of concepts (TD-11): SELECTED (a round result) != selection (this table) != offer ISSUED != ACCEPTED != JOINED != VERIFIED PLACEMENT.
-- Only a placement whose status is VERIFIED counts as a placement; an accepted offer never does.

CREATE SCHEMA offers; REVOKE ALL ON SCHEMA offers FROM PUBLIC; GRANT USAGE ON SCHEMA offers TO cc_app; GRANT USAGE, CREATE ON SCHEMA offers TO cc_auth;

CREATE TABLE selections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id         uuid NOT NULL,
  drive_id           uuid NOT NULL,
  registration_id    uuid NOT NULL,
  student_id         uuid NOT NULL,
  offer_status       text NOT NULL DEFAULT 'NOT_ISSUED' CHECK (offer_status IN ('NOT_ISSUED', 'ISSUED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN')),
  offered_ctc_lpa    numeric(6, 2) CHECK (offered_ctc_lpa IS NULL OR offered_ctc_lpa BETWEEN 0.01 AND 1000),
  response_deadline  timestamptz,
  issued_at          timestamptz,
  issued_by          uuid REFERENCES users (id),
  responded_at       timestamptz,
  withdrawn_at       timestamptz,
  withdrawn_by       uuid REFERENCES users (id),
  withdrawal_reason  text CHECK (withdrawal_reason IS NULL OR char_length(withdrawal_reason) <= 500),
  selected_by        uuid NOT NULL REFERENCES users (id),
  selected_at        timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (drive_id, student_id),
  UNIQUE (college_id, id),
  UNIQUE (college_id, student_id, id),
  FOREIGN KEY (college_id, drive_id) REFERENCES drives (college_id, id),
  FOREIGN KEY (college_id, registration_id) REFERENCES registrations (college_id, id),
  FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id),
  CONSTRAINT selections_issued CHECK ((offer_status IN ('NOT_ISSUED')) = (issued_at IS NULL) OR offer_status = 'WITHDRAWN'),
  CONSTRAINT selections_issue_fields CHECK (offer_status NOT IN ('ISSUED', 'ACCEPTED', 'DECLINED') OR (issued_by IS NOT NULL AND response_deadline IS NOT NULL)),
  CONSTRAINT selections_responded CHECK ((offer_status NOT IN ('ACCEPTED', 'DECLINED') OR responded_at IS NOT NULL) AND (responded_at IS NULL OR offer_status IN ('ACCEPTED', 'DECLINED', 'WITHDRAWN'))),
  CONSTRAINT selections_withdrawn CHECK ((offer_status = 'WITHDRAWN') = (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND char_length(btrim(coalesce(withdrawal_reason, ''))) >= 5)
                                        OR (offer_status <> 'WITHDRAWN' AND withdrawn_at IS NULL))
);
CREATE INDEX selections_drive_idx ON selections (drive_id, offer_status);

CREATE TABLE selection_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  college_id    uuid NOT NULL,
  selection_id  uuid NOT NULL,
  event         text NOT NULL CHECK (event IN ('SELECTED', 'OFFER_ISSUED', 'DEADLINE_EXTENDED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'JOINING_RECORDED',
                                               'PLACEMENT_VERIFIED', 'PLACEMENT_REJECTED', 'OVERRIDE_VERIFIED', 'OVERRIDE_REJECTED')),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  actor_role    text NOT NULL,
  actor_name    text NOT NULL,
  note          text CHECK (note IS NULL OR char_length(note) <= 500),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (college_id, selection_id) REFERENCES selections (college_id, id)
);
CREATE INDEX selection_events_idx ON selection_events (selection_id, id);

CREATE TABLE selection_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id    uuid NOT NULL,
  selection_id  uuid NOT NULL,
  student_id    uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('OFFER_LETTER', 'JOINING_PROOF')),
  original_name text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 120 AND original_name !~ '[\x00-\x1F\x7F/\\]'),
  content_type  text NOT NULL CHECK (content_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes    int NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key   text NOT NULL UNIQUE CHECK (storage_key ~ '^c/[0-9a-f-]{36}/o/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  uploaded_by   uuid NOT NULL REFERENCES users (id),
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, id),
  UNIQUE (college_id, selection_id, id),
  FOREIGN KEY (college_id, selection_id) REFERENCES selections (college_id, id),
  FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id)
);
CREATE INDEX selection_files_sel_idx ON selection_files (selection_id, kind, uploaded_at DESC);

CREATE TABLE placements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id      uuid NOT NULL,
  selection_id    uuid NOT NULL UNIQUE,
  student_id      uuid NOT NULL,
  drive_id        uuid NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (status IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED')),
  joined_on       date NOT NULL,
  designation     text CHECK (designation IS NULL OR char_length(designation) <= 150),
  note            text CHECK (note IS NULL OR char_length(note) <= 500),
  evidence_file_id uuid NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  decided_by      uuid REFERENCES users (id),
  decided_by_name text,
  decided_at      timestamptz,
  decision_reason text CHECK (decision_reason IS NULL OR char_length(decision_reason) <= 500),
  overridden      boolean NOT NULL DEFAULT false,
  UNIQUE (college_id, id),
  FOREIGN KEY (college_id, selection_id) REFERENCES selections (college_id, id),
  FOREIGN KEY (college_id, student_id) REFERENCES students (college_id, id),
  FOREIGN KEY (college_id, drive_id) REFERENCES drives (college_id, id),
  FOREIGN KEY (college_id, selection_id, evidence_file_id) REFERENCES selection_files (college_id, selection_id, id),
  CONSTRAINT placements_decided CHECK ((status = 'PENDING_VERIFICATION') = (decided_at IS NULL) AND (status = 'PENDING_VERIFICATION') = (decided_by IS NULL)),
  CONSTRAINT placements_reject_reason CHECK (status <> 'REJECTED' OR char_length(btrim(coalesce(decision_reason, ''))) >= 5)
);
CREATE INDEX placements_status_idx ON placements (college_id, status);

-- ── state machines and immutability ──
CREATE FUNCTION offers.append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'this history is append-only' USING ERRCODE = '42501'; END $$;
CREATE TRIGGER selection_events_no_change BEFORE UPDATE OR DELETE ON selection_events FOR EACH ROW EXECUTE FUNCTION offers.append_only();
CREATE TRIGGER selection_files_no_change BEFORE UPDATE OR DELETE ON selection_files FOR EACH ROW EXECUTE FUNCTION offers.append_only();

CREATE FUNCTION offers.guard_selection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'selections are retained' USING ERRCODE = '42501'; END IF;
  IF (NEW.college_id, NEW.drive_id, NEW.registration_id, NEW.student_id, NEW.selected_by, NEW.selected_at) IS DISTINCT FROM (OLD.college_id, OLD.drive_id, OLD.registration_id, OLD.student_id, OLD.selected_by, OLD.selected_at) THEN
    RAISE EXCEPTION 'a selection cannot be moved' USING ERRCODE = '42501';
  END IF;
  IF NEW.offer_status <> OLD.offer_status AND NOT (
       (OLD.offer_status = 'NOT_ISSUED' AND NEW.offer_status IN ('ISSUED', 'WITHDRAWN'))
    OR (OLD.offer_status = 'ISSUED'     AND NEW.offer_status IN ('ACCEPTED', 'DECLINED', 'WITHDRAWN'))
    OR (OLD.offer_status = 'ACCEPTED'   AND NEW.offer_status = 'WITHDRAWN')) THEN
    RAISE EXCEPTION 'illegal offer transition % -> %', OLD.offer_status, NEW.offer_status USING ERRCODE = '42501';
  END IF;
  -- once responded or withdrawn, the commercial terms are final
  IF OLD.offer_status IN ('ACCEPTED', 'DECLINED', 'WITHDRAWN') AND (NEW.offered_ctc_lpa, NEW.response_deadline, NEW.issued_at, NEW.issued_by, NEW.responded_at)
     IS DISTINCT FROM (OLD.offered_ctc_lpa, OLD.response_deadline, OLD.issued_at, OLD.issued_by, OLD.responded_at) THEN
    RAISE EXCEPTION 'a decided offer cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER selections_guard BEFORE UPDATE OR DELETE ON selections FOR EACH ROW EXECUTE FUNCTION offers.guard_selection();

CREATE FUNCTION offers.guard_placement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'placement records are retained' USING ERRCODE = '42501'; END IF;
  IF (NEW.college_id, NEW.selection_id, NEW.student_id, NEW.drive_id) IS DISTINCT FROM (OLD.college_id, OLD.selection_id, OLD.student_id, OLD.drive_id) THEN RAISE EXCEPTION 'a placement cannot be moved' USING ERRCODE = '42501'; END IF;
  IF OLD.status = 'VERIFIED' AND (NEW.joined_on, NEW.designation, NEW.note, NEW.evidence_file_id) IS DISTINCT FROM (OLD.joined_on, OLD.designation, OLD.note, OLD.evidence_file_id) THEN
    RAISE EXCEPTION 'a verified placement record cannot be edited' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER placements_guard BEFORE UPDATE OR DELETE ON placements FOR EACH ROW EXECUTE FUNCTION offers.guard_placement();

GRANT SELECT, INSERT, UPDATE ON selections, placements TO cc_auth;
GRANT SELECT, INSERT ON selection_events, selection_files TO cc_auth;
GRANT SELECT ON selections, placements, selection_events TO cc_app;
-- the storage key of a file is never readable by the runtime role; only the authorising function returns it
GRANT SELECT (id, college_id, selection_id, student_id, kind, original_name, content_type, size_bytes, uploaded_by, uploaded_at) ON selection_files TO cc_app;
ALTER TABLE selections       ENABLE ROW LEVEL SECURITY; ALTER TABLE selections       FORCE ROW LEVEL SECURITY;
ALTER TABLE selection_events ENABLE ROW LEVEL SECURITY; ALTER TABLE selection_events FORCE ROW LEVEL SECURITY;
ALTER TABLE selection_files  ENABLE ROW LEVEL SECURITY; ALTER TABLE selection_files  FORCE ROW LEVEL SECURITY;
ALTER TABLE placements       ENABLE ROW LEVEL SECURITY; ALTER TABLE placements       FORCE ROW LEVEL SECURITY;

-- Staff of the college see everything here; a student sees only their own; coordinators and other colleges see nothing.
CREATE POLICY selections_select ON selections FOR SELECT TO cc_app USING (college_id = (SELECT app.current_college_id()) AND
  ((SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN') OR ((SELECT app.current_role()) = 'STUDENT' AND student_id IN (SELECT st.id FROM students st))));
CREATE POLICY files_select ON selection_files FOR SELECT TO cc_app USING (college_id = (SELECT app.current_college_id()) AND
  ((SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN') OR ((SELECT app.current_role()) = 'STUDENT' AND student_id IN (SELECT st.id FROM students st))));
CREATE POLICY placements_select ON placements FOR SELECT TO cc_app USING (college_id = (SELECT app.current_college_id()) AND
  ((SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN') OR ((SELECT app.current_role()) = 'STUDENT' AND student_id IN (SELECT st.id FROM students st))));
CREATE POLICY sel_events_select ON selection_events FOR SELECT TO cc_app USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN'));

-- ───────────── functions ─────────────
CREATE FUNCTION offers.who(OUT o_user uuid, OUT o_college uuid, OUT o_role text, OUT o_name text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  o_role := app.current_role(); o_user := app.current_user_id(); o_college := app.current_college_id();
  IF o_role IS NULL OR o_college IS NULL THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  SELECT full_name INTO o_name FROM users WHERE id = o_user;
END $$;
CREATE FUNCTION offers.require(p_role text, OUT o_user uuid, OUT o_college uuid, OUT o_name text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r text;
BEGIN
  SELECT * INTO o_user, o_college, r, o_name FROM offers.who();
  IF r IS DISTINCT FROM p_role THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
END $$;
CREATE FUNCTION offers.event(p_sel uuid, p_college uuid, p_event text, p_user uuid, p_role text, p_name text, p_note text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO selection_events (college_id, selection_id, event, actor_user_id, actor_role, actor_name, note) VALUES (p_college, p_sel, p_event, p_user, p_role, p_name, nullif(btrim(coalesce(p_note, '')), ''))
$$;

-- Registrations whose student was SELECTED in the LAST round of the drive, provided every round is released (no selection from a partial process).
CREATE FUNCTION offers.final_selected(p_drive uuid) RETURNS TABLE (registration_id uuid, student_id uuid)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_last drive_rounds%ROWTYPE;
BEGIN
  SELECT * INTO v_last FROM drive_rounds WHERE drive_id = p_drive ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND OR v_last.released_at IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM drive_rounds WHERE drive_id = p_drive AND released_at IS NULL) THEN RETURN; END IF;
  RETURN QUERY SELECT rr.registration_id, g.student_id FROM round_results rr JOIN registrations g ON g.id = rr.registration_id WHERE rr.round_id = v_last.id AND rr.result = 'SELECTED';
END $$;

CREATE FUNCTION offers.select_candidates(p_drive uuid) RETURNS TABLE (registration_id uuid, student_id uuid, full_name text, register_number text, department_code text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid;
BEGIN
  SELECT o_college INTO v_c FROM offers.require('PLACEMENT_OFFICER');
  IF NOT EXISTS (SELECT 1 FROM drives WHERE id = p_drive AND college_id = v_c) THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT f.registration_id, f.student_id, st.full_name, st.register_number::text, dp.code::text FROM offers.final_selected(p_drive) f
    JOIN students st ON st.id = f.student_id JOIN departments dp ON dp.id = st.department_id
   WHERE NOT EXISTS (SELECT 1 FROM selections s WHERE s.drive_id = p_drive AND s.student_id = f.student_id) ORDER BY st.full_name, st.id;
END $$;

CREATE FUNCTION offers.select_students(p_drive uuid, p_regs uuid[]) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; g uuid; v_sid uuid; v_id uuid; v_count int := 0;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM offers.require('PLACEMENT_OFFICER');
  IF p_regs IS NULL OR cardinality(p_regs) = 0 THEN RAISE EXCEPTION 'Choose at least one student.' USING ERRCODE = '22023'; END IF;
  IF cardinality(p_regs) > 500 THEN RAISE EXCEPTION 'At most 500 students at a time.' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM drives WHERE id = p_drive AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  FOREACH g IN ARRAY (SELECT array_agg(DISTINCT x) FROM unnest(p_regs) x) LOOP
    SELECT f.student_id INTO v_sid FROM offers.final_selected(p_drive) f WHERE f.registration_id = g;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only students selected in the final, released round can be given a selection.' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM selections WHERE drive_id = p_drive AND student_id = v_sid) THEN RAISE EXCEPTION 'A chosen student already has a selection for this drive.' USING ERRCODE = '22023'; END IF;
    INSERT INTO selections (college_id, drive_id, registration_id, student_id, selected_by) VALUES (v_c, p_drive, g, v_sid, v_u) RETURNING id INTO v_id;
    PERFORM offers.event(v_id, v_c, 'SELECTED', v_u, 'PLACEMENT_OFFICER', v_n, NULL);
    v_count := v_count + 1;
  END LOOP;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'STUDENTS_SELECTED', 'drive', p_drive::text, jsonb_build_object('count', v_count), NULL);
  RETURN v_count;
END $$;

-- File registration: OFFER_LETTER by an officer; JOINING_PROOF by the student. The key must be server-generated for THIS selection.
CREATE FUNCTION offers.register_file(p_selection uuid, p_kind text, p_name text, p_type text, p_size int, p_sha text, p_key text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_r text; v_n text; s selections%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO v_u, v_c, v_r, v_n FROM offers.who();
  IF p_kind NOT IN ('OFFER_LETTER', 'JOINING_PROOF') THEN RAISE EXCEPTION 'invalid file kind' USING ERRCODE = '22023'; END IF;
  IF (p_kind = 'OFFER_LETTER' AND v_r IS DISTINCT FROM 'PLACEMENT_OFFICER') OR (p_kind = 'JOINING_PROOF' AND v_r IS DISTINCT FROM 'STUDENT') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM selections WHERE id = p_selection AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'selection not found' USING ERRCODE = '22023'; END IF;
  IF p_kind = 'JOINING_PROOF' AND NOT EXISTS (SELECT 1 FROM students WHERE id = s.student_id AND user_id = v_u) THEN RAISE EXCEPTION 'selection not found' USING ERRCODE = '22023'; END IF;
  IF p_kind = 'OFFER_LETTER' AND s.offer_status NOT IN ('NOT_ISSUED', 'ISSUED') THEN RAISE EXCEPTION 'A letter can be attached only before the offer is answered.' USING ERRCODE = '22023'; END IF;
  IF p_kind = 'JOINING_PROOF' AND s.offer_status <> 'ACCEPTED' THEN RAISE EXCEPTION 'Joining proof can be added only after you accept the offer.' USING ERRCODE = '22023'; END IF;
  IF p_key IS NULL OR p_key !~ ('^c/' || v_c || '/o/' || p_selection || '/[0-9a-f-]{36}$') THEN RAISE EXCEPTION 'invalid storage key' USING ERRCODE = '22023'; END IF;
  INSERT INTO selection_files (college_id, selection_id, student_id, kind, original_name, content_type, size_bytes, sha256, storage_key, uploaded_by)
  VALUES (v_c, p_selection, s.student_id, p_kind, p_name, p_type, p_size, p_sha, p_key, v_u) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION offers.file_key_for(p_file uuid) RETURNS TABLE (storage_key text, content_type text, original_name text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_r text; v_n text; f selection_files%ROWTYPE; v_own boolean;
BEGIN
  SELECT * INTO v_u, v_c, v_r, v_n FROM offers.who();
  SELECT * INTO f FROM selection_files WHERE id = p_file AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'file not found' USING ERRCODE = '22023'; END IF;
  v_own := EXISTS (SELECT 1 FROM students WHERE id = f.student_id AND user_id = v_u);
  IF v_r = 'STUDENT' THEN IF NOT v_own THEN RAISE EXCEPTION 'file not found' USING ERRCODE = '22023'; END IF;
  ELSIF v_r NOT IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT v_own THEN PERFORM auth.write_audit('COLLEGE', v_c, v_u, v_r, 'PLACEMENT_FILE_ACCESSED', 'selection', f.selection_id::text, jsonb_build_object('kind', f.kind), NULL); END IF;
  RETURN QUERY SELECT f.storage_key, f.content_type, f.original_name;
END $$;

CREATE FUNCTION offers.issue_offer(p_selection uuid, p_ctc numeric, p_deadline timestamptz, p_letter uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; s selections%ROWTYPE;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM offers.require('PLACEMENT_OFFICER');
  SELECT * INTO s FROM selections WHERE id = p_selection AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'selection not found' USING ERRCODE = '22023'; END IF;
  IF s.offer_status <> 'NOT_ISSUED' THEN RAISE EXCEPTION 'An offer has already been issued or closed for this student.' USING ERRCODE = '22023'; END IF;
  IF p_ctc IS NOT NULL AND (p_ctc < 0.01 OR p_ctc > 1000) THEN RAISE EXCEPTION 'Enter a CTC between 0.01 and 1000 LPA.' USING ERRCODE = '22023'; END IF;
  IF p_deadline IS NULL OR p_deadline <= now() THEN RAISE EXCEPTION 'The response deadline must be in the future.' USING ERRCODE = '22023'; END IF;
  IF p_deadline > now() + interval '120 days' THEN RAISE EXCEPTION 'The response deadline can be at most 120 days away.' USING ERRCODE = '22023'; END IF;
  IF p_letter IS NOT NULL AND NOT EXISTS (SELECT 1 FROM selection_files WHERE id = p_letter AND selection_id = p_selection AND kind = 'OFFER_LETTER') THEN RAISE EXCEPTION 'The offer letter does not belong to this selection.' USING ERRCODE = '22023'; END IF;
  UPDATE selections SET offer_status = 'ISSUED', offered_ctc_lpa = p_ctc, response_deadline = p_deadline, issued_at = now(), issued_by = v_u, updated_at = now() WHERE id = p_selection;
  PERFORM offers.event(p_selection, v_c, 'OFFER_ISSUED', v_u, 'PLACEMENT_OFFICER', v_n, NULL);
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'OFFER_ISSUED', 'selection', p_selection::text, '{}'::jsonb, NULL);
END $$;

CREATE FUNCTION offers.extend_deadline(p_selection uuid, p_deadline timestamptz) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; s selections%ROWTYPE;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM offers.require('PLACEMENT_OFFICER');
  SELECT * INTO s FROM selections WHERE id = p_selection AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'selection not found' USING ERRCODE = '22023'; END IF;
  IF s.offer_status <> 'ISSUED' THEN RAISE EXCEPTION 'The deadline can be extended only while the offer awaits a response.' USING ERRCODE = '22023'; END IF;
  IF p_deadline IS NULL OR p_deadline <= greatest(now(), s.response_deadline) THEN RAISE EXCEPTION 'The new deadline must be later than the current one and in the future.' USING ERRCODE = '22023'; END IF;
  IF p_deadline > now() + interval '120 days' THEN RAISE EXCEPTION 'The response deadline can be at most 120 days away.' USING ERRCODE = '22023'; END IF;
  UPDATE selections SET response_deadline = p_deadline, updated_at = now() WHERE id = p_selection;
  PERFORM offers.event(p_selection, v_c, 'DEADLINE_EXTENDED', v_u, 'PLACEMENT_OFFICER', v_n, NULL);
END $$;

-- The student's answer. The row is locked, so two simultaneous answers (accept + decline, or double click) cannot both succeed.
CREATE FUNCTION offers.respond(p_selection uuid, p_accept boolean) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; s selections%ROWTYPE; v_new text;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM offers.require('STUDENT');
  IF p_accept IS NULL THEN RAISE EXCEPTION 'Choose accept or decline.' USING ERRCODE = '22023'; END IF;
  SELECT s2.* INTO s FROM selections s2 JOIN students st ON st.id = s2.student_id WHERE s2.id = p_selection AND s2.college_id = v_c AND st.user_id = v_u FOR UPDATE OF s2;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer not found' USING ERRCODE = '22023'; END IF;
  IF s.offer_status <> 'ISSUED' THEN RAISE EXCEPTION 'This offer is no longer open for a response (it is %).', lower(replace(s.offer_status, '_', ' ')) USING ERRCODE = '22023'; END IF;
  IF s.response_deadline < now() THEN RAISE EXCEPTION 'The response deadline for this offer has passed. Please contact the placement office.' USING ERRCODE = '22023'; END IF;
  v_new := CASE WHEN p_accept THEN 'ACCEPTED' ELSE 'DECLINED' END;
  UPDATE selections SET offer_status = v_new, responded_at = now(), updated_at = now() WHERE id = p_selection;
  PERFORM offers.event(p_selection, v_c, v_new, v_u, 'STUDENT', v_n, NULL);
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'STUDENT', 'OFFER_' || v_new, 'selection', p_selection::text, '{}'::jsonb, NULL);
  RETURN v_new;
END $$;

CREATE FUNCTION offers.withdraw_offer(p_selection uuid, p_reason text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; s selections%ROWTYPE; v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM offers.require('PLACEMENT_OFFICER');
  IF char_length(v_reason) < 5 THEN RAISE EXCEPTION 'Give a reason of at least 5 characters.' USING ERRCODE = '22023'; END IF;
  IF char_length(v_reason) > 500 THEN RAISE EXCEPTION 'Keep the reason under 500 characters.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO s FROM selections WHERE id = p_selection AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'selection not found' USING ERRCODE = '22023'; END IF;
  IF s.offer_status NOT IN ('NOT_ISSUED', 'ISSUED', 'ACCEPTED') THEN RAISE EXCEPTION 'This offer can no longer be withdrawn.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM placements WHERE selection_id = p_selection AND status = 'VERIFIED') THEN RAISE EXCEPTION 'A verified placement exists for this offer. Ask the college administrator to override the verification first.' USING ERRCODE = '22023'; END IF;
  UPDATE selections SET offer_status = 'WITHDRAWN', withdrawn_at = now(), withdrawn_by = v_u, withdrawal_reason = v_reason, updated_at = now() WHERE id = p_selection;
  PERFORM offers.event(p_selection, v_c, 'WITHDRAWN', v_u, 'PLACEMENT_OFFICER', v_n, v_reason);
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'OFFER_WITHDRAWN', 'selection', p_selection::text, '{}'::jsonb, NULL);
END $$;

-- ── joining and verification ──
CREATE FUNCTION offers.record_joining(p_selection uuid, p_joined_on date, p_designation text, p_note text, p_file uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; s selections%ROWTYPE; p placements%ROWTYPE; v_id uuid; v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM offers.require('STUDENT');
  SELECT s2.* INTO s FROM selections s2 JOIN students st ON st.id = s2.student_id WHERE s2.id = p_selection AND s2.college_id = v_c AND st.user_id = v_u FOR UPDATE OF s2;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer not found' USING ERRCODE = '22023'; END IF;
  IF s.offer_status <> 'ACCEPTED' THEN RAISE EXCEPTION 'You can record joining only for an offer you have accepted.' USING ERRCODE = '22023'; END IF;
  IF p_joined_on IS NULL OR p_joined_on > v_today THEN RAISE EXCEPTION 'The joining date cannot be in the future. Record joining once you have actually joined.' USING ERRCODE = '22023'; END IF;
  IF p_joined_on < s.issued_at::date THEN RAISE EXCEPTION 'The joining date cannot be before the offer was issued.' USING ERRCODE = '22023'; END IF;
  IF char_length(coalesce(p_designation, '')) > 150 OR char_length(coalesce(p_note, '')) > 500 THEN RAISE EXCEPTION 'Designation or note is too long.' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM selection_files WHERE id = p_file AND selection_id = p_selection AND kind = 'JOINING_PROOF' AND uploaded_by = v_u) THEN
    RAISE EXCEPTION 'Upload your joining proof (for example the joining letter) and attach it.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO p FROM placements WHERE selection_id = p_selection FOR UPDATE;
  IF FOUND THEN
    IF p.status <> 'REJECTED' THEN RAISE EXCEPTION 'A joining record already exists for this offer (%).', lower(replace(p.status, '_', ' ')) USING ERRCODE = '22023'; END IF;
    UPDATE placements SET status = 'PENDING_VERIFICATION', joined_on = p_joined_on, designation = nullif(btrim(coalesce(p_designation, '')), ''), note = nullif(btrim(coalesce(p_note, '')), ''), evidence_file_id = p_file,
      recorded_at = now(), decided_by = NULL, decided_by_name = NULL, decided_at = NULL, decision_reason = NULL, overridden = false WHERE id = p.id;
    v_id := p.id;
  ELSE
    INSERT INTO placements (college_id, selection_id, student_id, drive_id, joined_on, designation, note, evidence_file_id)
    VALUES (v_c, p_selection, s.student_id, s.drive_id, p_joined_on, nullif(btrim(coalesce(p_designation, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), p_file) RETURNING id INTO v_id;
  END IF;
  PERFORM offers.event(p_selection, v_c, 'JOINING_RECORDED', v_u, 'STUDENT', v_n, NULL);
  RETURN v_id;
END $$;

CREATE FUNCTION offers.decide_placement(p_selection uuid, p_decision text, p_reason text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; p placements%ROWTYPE; s selections%ROWTYPE; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM offers.require('PLACEMENT_OFFICER');
  IF p_decision NOT IN ('VERIFIED', 'REJECTED') THEN RAISE EXCEPTION 'Choose verify or reject.' USING ERRCODE = '22023'; END IF;
  IF p_decision = 'REJECTED' AND (v_reason IS NULL OR char_length(v_reason) < 5) THEN RAISE EXCEPTION 'Give a reason of at least 5 characters when rejecting.' USING ERRCODE = '22023'; END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN RAISE EXCEPTION 'Keep the reason under 500 characters.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO s FROM selections WHERE id = p_selection AND college_id = v_c FOR UPDATE;
  SELECT * INTO p FROM placements WHERE selection_id = p_selection AND college_id = v_c FOR UPDATE;
  IF s.id IS NULL OR p.id IS NULL THEN RAISE EXCEPTION 'joining record not found' USING ERRCODE = '22023'; END IF;
  IF p.status <> 'PENDING_VERIFICATION' THEN RAISE EXCEPTION 'This joining record has already been decided.' USING ERRCODE = '22023'; END IF;
  IF p_decision = 'VERIFIED' AND s.offer_status <> 'ACCEPTED' THEN RAISE EXCEPTION 'The offer is no longer accepted, so this joining cannot be verified.' USING ERRCODE = '22023'; END IF;
  UPDATE placements SET status = p_decision, decided_by = v_u, decided_by_name = v_n, decided_at = now(), decision_reason = v_reason WHERE id = p.id;
  PERFORM offers.event(p_selection, v_c, CASE p_decision WHEN 'VERIFIED' THEN 'PLACEMENT_VERIFIED' ELSE 'PLACEMENT_REJECTED' END, v_u, 'PLACEMENT_OFFICER', v_n, v_reason);
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'PLACEMENT_' || p_decision, 'selection', p_selection::text, '{}'::jsonb, NULL);
END $$;

-- The college administrator may override a decision (either way) with a reason; the override is flagged and recorded.
CREATE FUNCTION offers.override_placement(p_selection uuid, p_decision text, p_reason text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; p placements%ROWTYPE; s selections%ROWTYPE; v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM offers.require('COLLEGE_ADMIN');
  IF p_decision NOT IN ('VERIFIED', 'REJECTED') THEN RAISE EXCEPTION 'Choose verified or rejected.' USING ERRCODE = '22023'; END IF;
  IF char_length(v_reason) < 10 THEN RAISE EXCEPTION 'An override needs a reason of at least 10 characters.' USING ERRCODE = '22023'; END IF;
  IF char_length(v_reason) > 500 THEN RAISE EXCEPTION 'Keep the reason under 500 characters.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO s FROM selections WHERE id = p_selection AND college_id = v_c FOR UPDATE;
  SELECT * INTO p FROM placements WHERE selection_id = p_selection AND college_id = v_c FOR UPDATE;
  IF s.id IS NULL OR p.id IS NULL THEN RAISE EXCEPTION 'joining record not found' USING ERRCODE = '22023'; END IF;
  IF p.status = p_decision THEN RAISE EXCEPTION 'The record is already %.', lower(p_decision) USING ERRCODE = '22023'; END IF;
  IF p_decision = 'VERIFIED' AND s.offer_status <> 'ACCEPTED' THEN RAISE EXCEPTION 'The offer is not accepted, so this joining cannot be verified.' USING ERRCODE = '22023'; END IF;
  UPDATE placements SET status = p_decision, decided_by = v_u, decided_by_name = v_n, decided_at = now(), decision_reason = v_reason, overridden = true WHERE id = p.id;
  PERFORM offers.event(p_selection, v_c, 'OVERRIDE_' || p_decision, v_u, 'COLLEGE_ADMIN', v_n, v_reason);
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'COLLEGE_ADMIN', 'PLACEMENT_OVERRIDE_' || p_decision, 'selection', p_selection::text, '{}'::jsonb, NULL);
END $$;

-- ── staff read models (officers cannot read the students table directly) ──
CREATE FUNCTION offers.list_for_drive(p_drive uuid) RETURNS TABLE (selection_id uuid, student_id uuid, full_name text, register_number text, department_code text, offer_status text, offered_ctc_lpa numeric,
    response_deadline timestamptz, issued_at timestamptz, responded_at timestamptz, withdrawal_reason text, letter_file_id uuid, placement_status text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid; v_r text;
BEGIN
  SELECT o_college, o_role INTO v_c, v_r FROM offers.who();
  IF v_r NOT IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM drives WHERE id = p_drive AND college_id = v_c) THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT s.id, s.student_id, st.full_name, st.register_number::text, dp.code::text, s.offer_status, s.offered_ctc_lpa, s.response_deadline, s.issued_at, s.responded_at, s.withdrawal_reason,
      (SELECT f.id FROM selection_files f WHERE f.selection_id = s.id AND f.kind = 'OFFER_LETTER' ORDER BY f.uploaded_at DESC, f.id LIMIT 1), pl.status
    FROM selections s JOIN students st ON st.id = s.student_id JOIN departments dp ON dp.id = st.department_id LEFT JOIN placements pl ON pl.selection_id = s.id
   WHERE s.drive_id = p_drive AND s.college_id = v_c ORDER BY st.full_name, s.id;
END $$;

CREATE FUNCTION offers.list_placements(p_status text) RETURNS TABLE (selection_id uuid, drive_id uuid, job_title text, company_name text, student_id uuid, full_name text, register_number text, department_code text,
    status text, joined_on date, designation text, note text, evidence_file_id uuid, recorded_at timestamptz, decided_by_name text, decided_at timestamptz, decision_reason text, overridden boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid; v_r text;
BEGIN
  SELECT o_college, o_role INTO v_c, v_r FROM offers.who();
  IF v_r NOT IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED') THEN RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT p.selection_id, p.drive_id, d.job_title, d.company_name, p.student_id, st.full_name, st.register_number::text, dp.code::text, p.status, p.joined_on, p.designation, p.note, p.evidence_file_id,
      p.recorded_at, p.decided_by_name, p.decided_at, p.decision_reason, p.overridden
    FROM placements p JOIN drives d ON d.id = p.drive_id JOIN students st ON st.id = p.student_id JOIN departments dp ON dp.id = st.department_id
   WHERE p.college_id = v_c AND (p_status IS NULL OR p.status = p_status) ORDER BY p.recorded_at DESC, p.id;
END $$;

-- The four numbers must never be conflated: selections, offers issued, offers accepted, VERIFIED placements.
CREATE FUNCTION offers.funnel() RETURNS TABLE (selected int, offers_issued int, offers_accepted int, joining_recorded int, placements_verified int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_c uuid; v_r text;
BEGIN
  SELECT o_college, o_role INTO v_c, v_r FROM offers.who();
  IF v_r NOT IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT (SELECT count(*)::int FROM selections WHERE college_id = v_c),
                      (SELECT count(*)::int FROM selections WHERE college_id = v_c AND issued_at IS NOT NULL),
                      (SELECT count(*)::int FROM selections WHERE college_id = v_c AND offer_status = 'ACCEPTED'),
                      (SELECT count(*)::int FROM placements WHERE college_id = v_c),
                      (SELECT count(*)::int FROM placements p JOIN selections s ON s.id = p.selection_id WHERE p.college_id = v_c AND p.status = 'VERIFIED' AND s.offer_status = 'ACCEPTED');
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'offers' AND p.proname NOT IN ('append_only', 'guard_selection', 'guard_placement') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION offers.select_candidates(uuid), offers.select_students(uuid, uuid[]), offers.register_file(uuid, text, text, text, int, text, text), offers.file_key_for(uuid),
  offers.issue_offer(uuid, numeric, timestamptz, uuid), offers.extend_deadline(uuid, timestamptz), offers.respond(uuid, boolean), offers.withdraw_offer(uuid, text),
  offers.record_joining(uuid, date, text, text, uuid), offers.decide_placement(uuid, text, text), offers.override_placement(uuid, text, text),
  offers.list_for_drive(uuid), offers.list_placements(text), offers.funnel() TO cc_app;      -- who, require, event, final_selected are internal
REVOKE CREATE ON SCHEMA offers FROM cc_auth;
