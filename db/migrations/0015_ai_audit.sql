-- 0015_ai_audit: the optional AI announcement helper is audited. Only counts are recorded — never the announcement text.
GRANT CREATE ON SCHEMA placement TO cc_auth;      -- temporary; revoked at the end
CREATE FUNCTION placement.log_ai_extraction(p_chars int, p_accepted int, p_ignored int) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_u uuid; v_c uuid; v_n text;
BEGIN
  SELECT * INTO v_u, v_c, v_n FROM placement.require_officer();
  IF p_chars IS NULL OR p_chars < 1 OR p_chars > 8000 OR p_accepted IS NULL OR p_accepted < 0 OR p_accepted > 30 OR p_ignored IS NULL OR p_ignored < 0 OR p_ignored > 30 THEN RAISE EXCEPTION 'invalid counts' USING ERRCODE = '22023'; END IF;
  PERFORM auth.write_audit('COLLEGE', v_c, v_u, 'PLACEMENT_OFFICER', 'AI_EXTRACTION_USED', 'drive', NULL, jsonb_build_object('chars', p_chars, 'accepted', p_accepted, 'ignored', p_ignored), NULL);
END $$;
ALTER FUNCTION placement.log_ai_extraction(int, int, int) OWNER TO cc_auth;
REVOKE ALL ON FUNCTION placement.log_ai_extraction(int, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION placement.log_ai_extraction(int, int, int) TO cc_app;
REVOKE CREATE ON SCHEMA placement FROM cc_auth;
