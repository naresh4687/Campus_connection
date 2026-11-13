-- 0009_drives: placement drives (job + eligibility criteria + eligible departments), a database-enforced lifecycle
-- DRAFT -> PUBLISHED -> CLOSED -> ARCHIVED (unpublish allowed), history, and visibility. Written only by placement officers via audited functions.

GRANT CREATE ON SCHEMA placement TO cc_auth;     -- temporary; revoked at the end

CREATE TABLE drives (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id           uuid NOT NULL,
  company_id           uuid NOT NULL,
  company_name         text NOT NULL,                       -- snapshot so students/coordinators never need access to the companies table
  job_title            text NOT NULL CHECK (length(btrim(job_title)) BETWEEN 2 AND 150),
  job_description      text CHECK (job_description IS NULL OR length(job_description) <= 4000),
  location             text CHECK (location IS NULL OR length(btrim(location)) BETWEEN 2 AND 150),
  employment_type      text NOT NULL CHECK (employment_type IN ('FULL_TIME', 'INTERNSHIP', 'INTERNSHIP_PPO', 'CONTRACT')),
  ctc_lpa              numeric(6,2) CHECK (ctc_lpa IS NULL OR ctc_lpa BETWEEN 0 AND 1000),
  ctc_note             text CHECK (ctc_note IS NULL OR length(ctc_note) <= 200),
  bond_details         text CHECK (bond_details IS NULL OR length(bond_details) <= 1000),
  qualification        text CHECK (qualification IS NULL OR length(qualification) <= 300),
  openings             int CHECK (openings IS NULL OR openings BETWEEN 1 AND 10000),
  application_deadline timestamptz,
  interview_details    text CHECK (interview_details IS NULL OR length(interview_details) <= 2000),
  instructions         text CHECK (instructions IS NULL OR length(instructions) <= 3000),
  status               text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED')),
  created_by           uuid NOT NULL REFERENCES users (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES users (id),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  published_at         timestamptz,
  published_by         uuid REFERENCES users (id),
  closed_at            timestamptz,
  archived_at          timestamptz,
  UNIQUE (college_id, id),
  FOREIGN KEY (college_id, company_id) REFERENCES companies (college_id, id),
  CONSTRAINT drives_published_complete CHECK (status IN ('DRAFT', 'ARCHIVED') OR (openings IS NOT NULL AND application_deadline IS NOT NULL AND published_at IS NOT NULL))
);
CREATE INDEX drives_status_idx ON drives (college_id, status, created_at DESC);
CREATE INDEX drives_company_idx ON drives (company_id);

CREATE TABLE drive_criteria (
  drive_id             uuid PRIMARY KEY,
  college_id           uuid NOT NULL,
  min_cgpa             numeric(4,2) CHECK (min_cgpa IS NULL OR min_cgpa BETWEEN 0 AND 10),
  min_tenth            numeric(5,2) CHECK (min_tenth IS NULL OR min_tenth BETWEEN 0 AND 100),
  min_twelfth          numeric(5,2) CHECK (min_twelfth IS NULL OR min_twelfth BETWEEN 0 AND 100),
  min_diploma          numeric(5,2) CHECK (min_diploma IS NULL OR min_diploma BETWEEN 0 AND 100),
  max_active_backlogs  int CHECK (max_active_backlogs IS NULL OR max_active_backlogs BETWEEN 0 AND 50),
  max_historical_arrears int CHECK (max_historical_arrears IS NULL OR max_historical_arrears BETWEEN 0 AND 200),
  passing_years        int[] NOT NULL DEFAULT '{}' CHECK (cardinality(passing_years) <= 10 AND (cardinality(passing_years) = 0 OR (1990 <= ALL (passing_years) AND 2110 >= ALL (passing_years)))),
  degrees              text[] NOT NULL DEFAULT '{}' CHECK (degrees <@ ARRAY['B.E.', 'B.Tech', 'M.E.', 'M.Tech', 'MCA', 'MBA', 'B.Sc', 'M.Sc', 'Diploma', 'Other']::text[]),
  FOREIGN KEY (college_id, drive_id) REFERENCES drives (college_id, id)
);
CREATE TABLE drive_departments (
  college_id    uuid NOT NULL,
  drive_id      uuid NOT NULL,
  department_id uuid NOT NULL,
  PRIMARY KEY (drive_id, department_id),
  FOREIGN KEY (college_id, drive_id) REFERENCES drives (college_id, id),
  FOREIGN KEY (college_id, department_id) REFERENCES departments (college_id, id)
);
CREATE TABLE drive_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  college_id    uuid NOT NULL,
  drive_id      uuid NOT NULL,
  event         text NOT NULL CHECK (event IN ('CREATED', 'UPDATED', 'PUBLISHED', 'UNPUBLISHED', 'CLOSED', 'ARCHIVED')),
  actor_user_id uuid NOT NULL REFERENCES users (id),
  actor_name    text NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (college_id, drive_id) REFERENCES drives (college_id, id)
);
CREATE FUNCTION placement.drive_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'drive history is append-only' USING ERRCODE = '42501'; END $$;
CREATE TRIGGER drive_events_no_change BEFORE UPDATE OR DELETE ON drive_events FOR EACH ROW EXECUTE FUNCTION placement.drive_events_immutable();

-- Lifecycle + freeze enforced by the database, whoever writes.
CREATE FUNCTION placement.drive_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'drives are retained (archive instead)' USING ERRCODE = '42501'; END IF;
  IF (NEW.college_id, NEW.created_by, NEW.created_at) IS DISTINCT FROM (OLD.college_id, OLD.created_by, OLD.created_at) THEN RAISE EXCEPTION 'drive ownership is immutable' USING ERRCODE = '42501'; END IF;
  IF NOT ((OLD.status = NEW.status)
       OR (OLD.status = 'DRAFT' AND NEW.status IN ('PUBLISHED', 'ARCHIVED'))
       OR (OLD.status = 'PUBLISHED' AND NEW.status IN ('DRAFT', 'CLOSED'))
       OR (OLD.status = 'CLOSED' AND NEW.status = 'ARCHIVED')) THEN
    RAISE EXCEPTION 'illegal drive status transition % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;
  -- once a drive has left DRAFT its content is frozen: students registered against these exact conditions
  IF OLD.status <> 'DRAFT' AND OLD.status = NEW.status AND
     (NEW.company_id, NEW.company_name, NEW.job_title, NEW.job_description, NEW.location, NEW.employment_type, NEW.ctc_lpa, NEW.ctc_note, NEW.bond_details, NEW.qualification,
      NEW.openings, NEW.application_deadline, NEW.interview_details, NEW.instructions)
     IS DISTINCT FROM
     (OLD.company_id, OLD.company_name, OLD.job_title, OLD.job_description, OLD.location, OLD.employment_type, OLD.ctc_lpa, OLD.ctc_note, OLD.bond_details, OLD.qualification,
      OLD.openings, OLD.application_deadline, OLD.interview_details, OLD.instructions) THEN
    RAISE EXCEPTION 'a published drive can no longer be edited' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER drives_guard BEFORE UPDATE OR DELETE ON drives FOR EACH ROW EXECUTE FUNCTION placement.drive_guard();

CREATE FUNCTION placement.criteria_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text; v_drive uuid := coalesce(NEW.drive_id, OLD.drive_id);
BEGIN
  SELECT status INTO v_status FROM drives WHERE id = v_drive;
  IF v_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'eligibility criteria and departments can only change while the drive is a draft' USING ERRCODE = '42501'; END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER criteria_guard BEFORE INSERT OR UPDATE OR DELETE ON drive_criteria FOR EACH ROW EXECUTE FUNCTION placement.criteria_guard();
CREATE TRIGGER drive_departments_guard BEFORE INSERT OR UPDATE OR DELETE ON drive_departments FOR EACH ROW EXECUTE FUNCTION placement.criteria_guard();

GRANT SELECT, INSERT, UPDATE ON drives TO cc_auth;
GRANT SELECT, INSERT, UPDATE ON drive_criteria TO cc_auth;
GRANT SELECT, INSERT, DELETE ON drive_departments TO cc_auth;
GRANT SELECT, INSERT ON drive_events TO cc_auth;
GRANT SELECT ON drives, drive_criteria, drive_departments, drive_events TO cc_app;
ALTER TABLE drives            ENABLE ROW LEVEL SECURITY; ALTER TABLE drives            FORCE ROW LEVEL SECURITY;
ALTER TABLE drive_criteria    ENABLE ROW LEVEL SECURITY; ALTER TABLE drive_criteria    FORCE ROW LEVEL SECURITY;
ALTER TABLE drive_departments ENABLE ROW LEVEL SECURITY; ALTER TABLE drive_departments FORCE ROW LEVEL SECURITY;
ALTER TABLE drive_events      ENABLE ROW LEVEL SECURITY; ALTER TABLE drive_events      FORCE ROW LEVEL SECURITY;

-- Officers and admins: every drive of their college. Students and coordinators: only PUBLISHED / CLOSED drives of their college (never drafts or archived).
CREATE POLICY drives_select_staff ON drives FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN'));
CREATE POLICY drives_select_public ON drives FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('STUDENT', 'COORDINATOR') AND status IN ('PUBLISHED', 'CLOSED'));
CREATE POLICY criteria_select ON drive_criteria FOR SELECT TO cc_app USING (drive_id IN (SELECT d.id FROM drives d));
CREATE POLICY drive_departments_select ON drive_departments FOR SELECT TO cc_app USING (drive_id IN (SELECT d.id FROM drives d));
CREATE POLICY drive_events_select ON drive_events FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COLLEGE_ADMIN'));

-- ───────────── functions ─────────────
CREATE FUNCTION placement.drive_event(p_drive uuid, p_college uuid, p_event text, p_user uuid, p_name text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO drive_events (college_id, drive_id, event, actor_user_id, actor_name) VALUES (p_college, p_drive, p_event, p_user, p_name)
$$;

-- Create (p_id NULL) or update a DRAFT drive: content, criteria and eligible departments in one transaction.
CREATE FUNCTION placement.save_drive(p_id uuid, p_company uuid, p_title text, p_description text, p_location text, p_type text, p_ctc numeric, p_ctc_note text, p_bond text, p_qualification text,
    p_openings int, p_deadline timestamptz, p_interview text, p_instructions text, p_departments uuid[], p_years int[], p_degrees text[],
    p_min_cgpa numeric, p_min_tenth numeric, p_min_twelfth numeric, p_min_diploma numeric, p_max_backlogs int, p_max_arrears int) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; v_id uuid := p_id; v_cname text; v_cstatus text; v_status text; v_deps uuid[] := coalesce(p_departments, '{}');
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  SELECT name::text, status INTO v_cname, v_cstatus FROM companies WHERE id = p_company AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'company not found' USING ERRCODE = '22023'; END IF;
  IF v_cstatus <> 'ACTIVE' THEN RAISE EXCEPTION 'This company is inactive. Reactivate it before using it for a drive.' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(v_deps) x) <> cardinality(v_deps) OR (SELECT count(*) FROM departments d WHERE d.id = ANY (v_deps) AND d.college_id = v_c AND d.status = 'ACTIVE') <> cardinality(v_deps) THEN
    RAISE EXCEPTION 'Eligible departments must be active departments of this college.' USING ERRCODE = '22023';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO drives (college_id, company_id, company_name, job_title, job_description, location, employment_type, ctc_lpa, ctc_note, bond_details, qualification, openings, application_deadline, interview_details, instructions, created_by)
    VALUES (v_c, p_company, v_cname, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), nullif(btrim(coalesce(p_location, '')), ''), p_type, p_ctc, nullif(btrim(coalesce(p_ctc_note, '')), ''),
            nullif(btrim(coalesce(p_bond, '')), ''), nullif(btrim(coalesce(p_qualification, '')), ''), p_openings, p_deadline, nullif(btrim(coalesce(p_interview, '')), ''), nullif(btrim(coalesce(p_instructions, '')), ''), v_u)
    RETURNING id INTO v_id;
    INSERT INTO drive_criteria (drive_id, college_id) VALUES (v_id, v_c);
    PERFORM placement.drive_event(v_id, v_c, 'CREATED', v_u, v_n);
    PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'DRIVE_CREATED', 'drive', v_id::text, '{}'::jsonb, NULL);
  ELSE
    SELECT status INTO v_status FROM drives WHERE id = v_id AND college_id = v_c FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
    IF v_status <> 'DRAFT' THEN RAISE EXCEPTION 'Only a draft drive can be edited. Unpublish it first.' USING ERRCODE = '22023'; END IF;
    UPDATE drives SET company_id = p_company, company_name = v_cname, job_title = btrim(p_title), job_description = nullif(btrim(coalesce(p_description, '')), ''), location = nullif(btrim(coalesce(p_location, '')), ''),
           employment_type = p_type, ctc_lpa = p_ctc, ctc_note = nullif(btrim(coalesce(p_ctc_note, '')), ''), bond_details = nullif(btrim(coalesce(p_bond, '')), ''), qualification = nullif(btrim(coalesce(p_qualification, '')), ''),
           openings = p_openings, application_deadline = p_deadline, interview_details = nullif(btrim(coalesce(p_interview, '')), ''), instructions = nullif(btrim(coalesce(p_instructions, '')), ''),
           updated_by = v_u, updated_at = now() WHERE id = v_id;
    PERFORM placement.drive_event(v_id, v_c, 'UPDATED', v_u, v_n);
    PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'DRIVE_UPDATED', 'drive', v_id::text, '{}'::jsonb, NULL);
  END IF;
  UPDATE drive_criteria SET min_cgpa = p_min_cgpa, min_tenth = p_min_tenth, min_twelfth = p_min_twelfth, min_diploma = p_min_diploma, max_active_backlogs = p_max_backlogs,
         max_historical_arrears = p_max_arrears, passing_years = coalesce((SELECT array_agg(DISTINCT y ORDER BY y) FROM unnest(coalesce(p_years, '{}')) y), '{}'),
         degrees = coalesce((SELECT array_agg(DISTINCT g ORDER BY g) FROM unnest(coalesce(p_degrees, '{}')) g), '{}') WHERE drive_id = v_id;
  DELETE FROM drive_departments WHERE drive_id = v_id;
  INSERT INTO drive_departments (college_id, drive_id, department_id) SELECT v_c, v_id, x FROM unnest(v_deps) x;
  RETURN v_id;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Some drive details are invalid (check the job title, type, CTC, openings and criteria).' USING ERRCODE = '22023';
END $$;

CREATE FUNCTION placement.publish_drive(p_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; d drives%ROWTYPE; v_problems text[] := '{}'; v_cstatus text;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  SELECT * INTO d FROM drives WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  IF d.status <> 'DRAFT' THEN RAISE EXCEPTION 'Only a draft drive can be published.' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_cstatus FROM companies WHERE id = d.company_id;
  IF v_cstatus <> 'ACTIVE' THEN v_problems := array_append(v_problems, 'the company is inactive'); END IF;
  IF d.openings IS NULL THEN v_problems := array_append(v_problems, 'openings are missing'); END IF;
  IF d.application_deadline IS NULL OR d.application_deadline <= now() THEN v_problems := array_append(v_problems, 'the application deadline must be in the future'); END IF;
  IF NOT EXISTS (SELECT 1 FROM drive_departments WHERE drive_id = p_id) THEN v_problems := array_append(v_problems, 'choose at least one eligible department'); END IF;
  IF NOT EXISTS (SELECT 1 FROM drive_criteria WHERE drive_id = p_id AND cardinality(passing_years) > 0) THEN v_problems := array_append(v_problems, 'choose at least one eligible passing year'); END IF;
  IF EXISTS (SELECT 1 FROM drive_departments dd JOIN departments dp ON dp.id = dd.department_id WHERE dd.drive_id = p_id AND dp.status <> 'ACTIVE') THEN v_problems := array_append(v_problems, 'an eligible department is inactive'); END IF;
  IF array_length(v_problems, 1) IS NOT NULL THEN RAISE EXCEPTION 'Cannot publish yet: %.', array_to_string(v_problems, '; ') USING ERRCODE = '22023'; END IF;
  UPDATE drives SET status = 'PUBLISHED', published_at = now(), published_by = v_u, updated_by = v_u, updated_at = now() WHERE id = p_id;
  PERFORM placement.drive_event(p_id, v_c, 'PUBLISHED', v_u, v_n);
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'DRIVE_PUBLISHED', 'drive', p_id::text, '{}'::jsonb, NULL);
END $$;

CREATE FUNCTION placement.set_drive_status(p_id uuid, p_to text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; v_from text;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  IF p_to NOT IN ('DRAFT', 'CLOSED', 'ARCHIVED') THEN RAISE EXCEPTION 'use publish_drive to publish' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_from FROM drives WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '22023'; END IF;
  IF NOT ((v_from = 'PUBLISHED' AND p_to IN ('DRAFT', 'CLOSED')) OR (v_from IN ('DRAFT', 'CLOSED') AND p_to = 'ARCHIVED')) THEN
    RAISE EXCEPTION 'A % drive cannot be moved to %.', lower(v_from), lower(p_to) USING ERRCODE = '22023';
  END IF;
  UPDATE drives SET status = p_to, updated_by = v_u, updated_at = now(), closed_at = CASE WHEN p_to = 'CLOSED' THEN now() ELSE closed_at END, archived_at = CASE WHEN p_to = 'ARCHIVED' THEN now() ELSE archived_at END WHERE id = p_id;
  PERFORM placement.drive_event(p_id, v_c, CASE p_to WHEN 'DRAFT' THEN 'UNPUBLISHED' ELSE p_to END, v_u, v_n);
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'DRIVE_' || CASE p_to WHEN 'DRAFT' THEN 'UNPUBLISHED' ELSE p_to END, 'drive', p_id::text, '{}'::jsonb, NULL);
END $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'placement' AND p.proname IN ('drive_event', 'save_drive', 'publish_drive', 'set_drive_status') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION placement.save_drive(uuid, uuid, text, text, text, text, numeric, text, text, text, int, timestamptz, text, text, uuid[], int[], text[], numeric, numeric, numeric, numeric, int, int),
                          placement.publish_drive(uuid), placement.set_drive_status(uuid, text) TO cc_app;
REVOKE CREATE ON SCHEMA placement FROM cc_auth;
