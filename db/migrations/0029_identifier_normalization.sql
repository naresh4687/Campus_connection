-- 0029_identifier_normalization: one canonical form for institutional identifiers (register numbers), enforced by the database whatever wrote the row.
--   Canonical form = Unicode NFKC, trimmed, upper-cased. Names, emails, URLs and message text are NOT touched (emails are already case-insensitive citext).
--   New writes: a BEFORE trigger canonicalizes students.register_number and join_requests.register_number, so API, import, join and manual writes agree.
--   Existing rows: apply_identifier_normalization() rewrites them only when no two rows of the same college would collapse into one identifier.
--   If any would ("23ai000" and "23AI000" as two students), NOTHING is changed, nothing is merged or deleted, and identifier_conflicts() lists them for
--   reconciliation by an authorised person; run `npm run db:normalize` again afterwards. Decided join requests and audit history are never rewritten.

CREATE FUNCTION app.canon_identifier(p text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT upper(normalize(btrim(p), NFKC))
$$;
REVOKE ALL ON FUNCTION app.canon_identifier(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.canon_identifier(text) TO cc_app, cc_auth;

CREATE FUNCTION app.canonicalize_register() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.register_number := app.canon_identifier(NEW.register_number::text)::citext;
  RETURN NEW;
END $$;
-- Named so they fire before the join-request guard (alphabetical order).
CREATE TRIGGER students_a_canonical BEFORE INSERT OR UPDATE OF register_number ON students FOR EACH ROW EXECUTE FUNCTION app.canonicalize_register();
CREATE TRIGGER join_requests_a_canonical BEFORE INSERT OR UPDATE OF register_number ON join_requests FOR EACH ROW EXECUTE FUNCTION app.canonicalize_register();

-- Rows whose canonical identifier is shared by more than one record in the same college. Owner-only report; never granted to the runtime role.
CREATE FUNCTION app.identifier_conflicts() RETURNS TABLE (source_table text, college_id uuid, canonical text, record_ids uuid[], originals text[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT 'students'::text, s.college_id, app.canon_identifier(s.register_number::text), array_agg(s.id ORDER BY s.created_at, s.id), array_agg(s.register_number::text ORDER BY s.created_at, s.id)
    FROM students s GROUP BY s.college_id, app.canon_identifier(s.register_number::text) HAVING count(*) > 1
  UNION ALL
  SELECT 'join_requests (pending)', j.college_id, app.canon_identifier(j.register_number::text), array_agg(j.id ORDER BY j.created_at, j.id), array_agg(j.register_number::text ORDER BY j.created_at, j.id)
    FROM join_requests j WHERE j.status = 'PENDING' GROUP BY j.college_id, app.canon_identifier(j.register_number::text) HAVING count(*) > 1
$$;


-- Backfill + constraints. Refuses (raising) while conflicts exist; safe to run again.
CREATE FUNCTION app.apply_identifier_normalization() RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_n int; v_changed int := 0;
BEGIN
  SELECT count(*) INTO v_n FROM app.identifier_conflicts();
  IF v_n > 0 THEN RAISE EXCEPTION '% identifier conflict(s): two records of one college share one canonical identifier. Resolve them first (SELECT * FROM app.identifier_conflicts()).', v_n USING ERRCODE = '23505'; END IF;
  UPDATE students SET register_number = app.canon_identifier(register_number::text)::citext WHERE register_number::text <> app.canon_identifier(register_number::text);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_changed := v_changed + v_n;
  UPDATE join_requests SET register_number = app.canon_identifier(register_number::text)::citext WHERE status = 'PENDING' AND register_number::text <> app.canon_identifier(register_number::text);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_changed := v_changed + v_n;
  RETURN v_changed;
END $$;

-- Both run as cc_auth (BYPASSRLS): the migration owner is itself subject to row-level security and would see and change no rows. Neither is callable by the runtime role.
GRANT CREATE ON SCHEMA app TO cc_auth;
ALTER FUNCTION app.identifier_conflicts() OWNER TO cc_auth;
ALTER FUNCTION app.apply_identifier_normalization() OWNER TO cc_auth;
REVOKE CREATE ON SCHEMA app FROM cc_auth;
REVOKE ALL ON FUNCTION app.identifier_conflicts(), app.apply_identifier_normalization() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.identifier_conflicts(), app.apply_identifier_normalization() TO CURRENT_USER;

-- Try it now. Conflicts leave the data as it is (a notice says so); an empty or conflict-free database is normalised and constrained immediately.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM app.identifier_conflicts()) THEN
    RAISE WARNING 'Identifier normalisation skipped: conflicting records exist. Run SELECT * FROM app.identifier_conflicts(), reconcile them, then npm run db:normalize.';
  ELSE
    PERFORM app.apply_identifier_normalization();
    ALTER TABLE students ADD CONSTRAINT students_register_canonical CHECK (register_number::text = app.canon_identifier(register_number::text));
  END IF;
END $$;
