-- 0031_announcement_extractions: what the reader found in a pasted announcement (each value with the sentence it came from, and what was missing,
-- ambiguous or contradictory), kept beside the draft so the review page can show it after the fact. Staff only: students never read it.
-- Written only by announcements.save_extraction(); the stored text is the extraction result, never the model's raw output.

CREATE TABLE announcement_extractions (
  announcement_id uuid PRIMARY KEY,
  college_id      uuid NOT NULL,
  extraction      jsonb NOT NULL CHECK (jsonb_typeof(extraction) = 'object' AND pg_column_size(extraction) <= 200000),
  method          text NOT NULL CHECK (length(method) BETWEEN 1 AND 60),
  version         text NOT NULL CHECK (length(version) BETWEEN 1 AND 40),
  created_by      uuid NOT NULL REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (college_id, announcement_id) REFERENCES announcements (college_id, id)
);
GRANT SELECT, INSERT, UPDATE ON announcement_extractions TO cc_auth;
GRANT SELECT ON announcement_extractions TO cc_app;
ALTER TABLE announcement_extractions ENABLE ROW LEVEL SECURITY; ALTER TABLE announcement_extractions FORCE ROW LEVEL SECURITY;
-- Whoever can see the announcement as staff (an officer and the administrator: all; a coordinator: their own). Never a student.
CREATE POLICY announcement_extractions_select ON announcement_extractions FOR SELECT TO cc_app
  USING (college_id = (SELECT app.current_college_id()) AND (SELECT app.current_role()) IN ('PLACEMENT_OFFICER', 'COORDINATOR', 'COLLEGE_ADMIN') AND announcement_id IN (SELECT a.id FROM announcements a));

CREATE FUNCTION announcements.save_extraction(p_id uuid, p_extraction jsonb, p_method text, p_version text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_user uuid := app.current_user_id(); v_c uuid := app.current_college_id(); v_role text := app.current_role(); a announcements%ROWTYPE;
BEGIN
  IF v_user IS NULL OR v_c IS NULL OR v_role NOT IN ('PLACEMENT_OFFICER', 'COORDINATOR') THEN RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501'; END IF;
  IF p_extraction IS NULL OR jsonb_typeof(p_extraction) <> 'object' OR pg_column_size(p_extraction) > 200000 THEN RAISE EXCEPTION 'invalid extraction' USING ERRCODE = '22023'; END IF;
  SELECT * INTO a FROM announcements WHERE id = p_id AND college_id = v_c;
  IF NOT FOUND THEN RAISE EXCEPTION 'Announcement not found.' USING ERRCODE = '22023'; END IF;
  IF v_role = 'COORDINATOR' AND a.created_by <> v_user THEN RAISE EXCEPTION 'You can only change announcements you created.' USING ERRCODE = '42501'; END IF;
  IF a.status <> 'DRAFT' THEN RAISE EXCEPTION 'Only a draft can be re-read.' USING ERRCODE = '22023'; END IF;
  INSERT INTO announcement_extractions (announcement_id, college_id, extraction, method, version, created_by) VALUES (p_id, v_c, p_extraction, p_method, p_version, v_user)
  ON CONFLICT (announcement_id) DO UPDATE SET extraction = EXCLUDED.extraction, method = EXCLUDED.method, version = EXCLUDED.version, created_by = EXCLUDED.created_by, created_at = now();
  PERFORM auth.write_audit('COLLEGE', v_c, v_user, v_role, 'ANNOUNCEMENT_EXTRACTED', 'announcement', p_id::text, jsonb_build_object('method', p_method, 'version', p_version), NULL);
END $$;
GRANT CREATE ON SCHEMA announcements TO cc_auth;
ALTER FUNCTION announcements.save_extraction(uuid, jsonb, text, text) OWNER TO cc_auth;
REVOKE CREATE ON SCHEMA announcements FROM cc_auth;
REVOKE ALL ON FUNCTION announcements.save_extraction(uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION announcements.save_extraction(uuid, jsonb, text, text) TO cc_app;
