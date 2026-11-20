-- 0022_drive_intakes: AI-assisted drive creation. An "intake" keeps the company's ORIGINAL announcement, who submitted it, which extractor produced
-- what, and the officer's working copy of every extracted field (value, status, evidence). It links to an ordinary DRAFT drive. Nothing here can
-- publish a drive: publishing stays placement.publish_drive, called only by an officer's explicit action. Written only through audited functions.

GRANT CREATE ON SCHEMA placement TO cc_auth;     -- temporary; revoked at the end

CREATE TABLE drive_intakes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id         uuid NOT NULL,
  idempotency_key    uuid NOT NULL,                     -- a retried request (double click, network retry) finds the same intake instead of making another
  source_text        text NOT NULL CHECK (length(source_text) BETWEEN 20 AND 20000),
  source_hash        text NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  source_type        text NOT NULL DEFAULT 'PASTED' CHECK (source_type IN ('PASTED', 'EMAIL', 'WHATSAPP', 'OTHER')),
  submitted_by       uuid NOT NULL REFERENCES users (id),
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'READY', 'FAILED', 'DISCARDED')),
  error_note         text CHECK (error_note IS NULL OR length(error_note) <= 300),   -- a short, safe message; never an internal exception
  provider           text CHECK (provider IS NULL OR length(provider) <= 40),
  model_id           text CHECK (model_id IS NULL OR length(model_id) <= 120),
  extraction_version text CHECK (extraction_version IS NULL OR length(extraction_version) <= 40),
  extraction         jsonb,                              -- the latest VALIDATED machine result (never raw model output)
  fields             jsonb NOT NULL DEFAULT '{}'::jsonb, -- the officer's working copy: key -> {value, status, evidence, ...}
  pending            jsonb,                              -- a re-extraction waiting for the officer to choose which values to take
  drive_id           uuid,
  updated_by         uuid REFERENCES users (id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, id),
  UNIQUE (college_id, idempotency_key),
  FOREIGN KEY (college_id, drive_id) REFERENCES drives (college_id, id)
);
CREATE INDEX drive_intakes_hash_idx ON drive_intakes (college_id, source_hash);
CREATE INDEX drive_intakes_drive_idx ON drive_intakes (drive_id);

GRANT SELECT, INSERT, UPDATE ON drive_intakes TO cc_auth;
GRANT SELECT ON drive_intakes TO cc_app;
ALTER TABLE drive_intakes ENABLE ROW LEVEL SECURITY; ALTER TABLE drive_intakes FORCE ROW LEVEL SECURITY;
-- Only placement officers of the same college read intakes (the source text is the company's message; students, coordinators and admins never need it).
CREATE POLICY drive_intakes_select ON drive_intakes FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) = 'PLACEMENT_OFFICER');

-- Start (or find) an intake. The same idempotency key returns the same row; the same key with different text is refused.
CREATE FUNCTION placement.create_intake(p_key uuid, p_source text, p_hash text, p_type text) RETURNS TABLE (id uuid, status text, created boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; v_id uuid; v_status text; v_hash text;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  IF p_key IS NULL OR p_source IS NULL OR length(p_source) NOT BETWEEN 20 AND 20000 OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_type NOT IN ('PASTED', 'EMAIL', 'WHATSAPP', 'OTHER') THEN
    RAISE EXCEPTION 'invalid intake' USING ERRCODE = '22023';
  END IF;
  INSERT INTO drive_intakes (college_id, idempotency_key, source_text, source_hash, source_type, submitted_by, updated_by)
  VALUES (v_c, p_key, p_source, p_hash, p_type, v_u, v_u)
  ON CONFLICT (college_id, idempotency_key) DO NOTHING RETURNING drive_intakes.id INTO v_id;
  IF v_id IS NOT NULL THEN
    PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'AI_INTAKE_CREATED', 'drive_intake', v_id::text, jsonb_build_object('chars', length(p_source)), NULL);
    RETURN QUERY SELECT v_id, 'PENDING'::text, true; RETURN;
  END IF;
  SELECT i.id, i.status, i.source_hash INTO v_id, v_status, v_hash FROM drive_intakes i WHERE i.college_id = v_c AND i.idempotency_key = p_key;
  IF v_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'this request key was already used for a different announcement' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT v_id, v_status, false;
END $$;

-- Store the validated first extraction (or the failure). Allowed only while nothing has been extracted yet; later runs go through store_intake_pending.
CREATE FUNCTION placement.store_intake_result(p_id uuid, p_status text, p_provider text, p_model text, p_version text, p_extraction jsonb, p_fields jsonb, p_error text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; v_cur text;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  IF p_status NOT IN ('READY', 'FAILED') THEN RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_cur FROM drive_intakes WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF v_cur IS NULL THEN RAISE EXCEPTION 'intake not found' USING ERRCODE = '42501'; END IF;
  IF v_cur NOT IN ('PENDING', 'FAILED') THEN RAISE EXCEPTION 'this announcement was already extracted' USING ERRCODE = '23505'; END IF;
  UPDATE drive_intakes SET status = p_status, provider = p_provider, model_id = p_model, extraction_version = p_version, extraction = p_extraction,
    fields = CASE WHEN p_status = 'READY' THEN coalesce(p_fields, '{}'::jsonb) ELSE fields END, error_note = left(p_error, 300), updated_by = v_u, updated_at = now()
   WHERE id = p_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', CASE WHEN p_status = 'READY' THEN 'AI_INTAKE_EXTRACTED' ELSE 'AI_INTAKE_FAILED' END, 'drive_intake', p_id::text,
    jsonb_build_object('provider', p_provider, 'model', p_model, 'version', p_version), NULL);
END $$;

-- A re-extraction: kept aside as "pending" so it can never overwrite what the officer has already corrected.
CREATE FUNCTION placement.store_intake_pending(p_id uuid, p_provider text, p_model text, p_version text, p_pending jsonb) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; v_cur text;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  SELECT status INTO v_cur FROM drive_intakes WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF v_cur IS DISTINCT FROM 'READY' THEN RAISE EXCEPTION 'intake not found' USING ERRCODE = '42501'; END IF;
  UPDATE drive_intakes SET pending = p_pending, provider = p_provider, model_id = p_model, extraction_version = p_version, updated_by = v_u, updated_at = now() WHERE id = p_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'AI_INTAKE_REEXTRACTED', 'drive_intake', p_id::text, jsonb_build_object('provider', p_provider, 'model', p_model), NULL);
END $$;

-- Save the officer's working copy, optionally link the DRAFT drive made from it, optionally clear the pending re-extraction. It never touches drive status.
CREATE FUNCTION placement.save_intake_fields(p_id uuid, p_fields jsonb, p_drive uuid, p_clear_pending boolean) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text; v_cur text; v_dstatus text;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' OR pg_column_size(p_fields) > 400000 THEN RAISE EXCEPTION 'invalid fields' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_cur FROM drive_intakes WHERE id = p_id AND college_id = v_c FOR UPDATE;
  IF v_cur IS DISTINCT FROM 'READY' THEN RAISE EXCEPTION 'intake not found' USING ERRCODE = '42501'; END IF;
  IF p_drive IS NOT NULL THEN
    SELECT status INTO v_dstatus FROM drives WHERE id = p_drive AND college_id = v_c;
    IF v_dstatus IS NULL THEN RAISE EXCEPTION 'drive not found' USING ERRCODE = '42501'; END IF;
  END IF;
  UPDATE drive_intakes SET fields = p_fields, drive_id = coalesce(p_drive, drive_id), pending = CASE WHEN p_clear_pending THEN NULL ELSE pending END, updated_by = v_u, updated_at = now() WHERE id = p_id;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'AI_INTAKE_EDITED', 'drive_intake', p_id::text, '{}'::jsonb, NULL);
END $$;

CREATE FUNCTION placement.discard_intake(p_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  UPDATE drive_intakes SET status = 'DISCARDED', updated_by = v_u, updated_at = now() WHERE id = p_id AND college_id = v_c AND status IN ('PENDING', 'READY', 'FAILED') AND drive_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'intake not found or already linked to a drive' USING ERRCODE = '42501'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'AI_INTAKE_DISCARDED', 'drive_intake', p_id::text, '{}'::jsonb, NULL);
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['placement.create_intake(uuid, text, text, text)', 'placement.store_intake_result(uuid, text, text, text, text, jsonb, jsonb, text)',
    'placement.store_intake_pending(uuid, text, text, text, jsonb)', 'placement.save_intake_fields(uuid, jsonb, uuid, boolean)', 'placement.discard_intake(uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cc_auth', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO cc_app', f);
  END LOOP;
END $$;
REVOKE CREATE ON SCHEMA placement FROM cc_auth;
