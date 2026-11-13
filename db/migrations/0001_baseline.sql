-- 0001_baseline: extensions, schema for security helpers, safe defaults.
-- Forward-only. Runs as cc_owner.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS app;

-- Request context helpers used by every RLS policy.
-- Values are set per transaction by the server (SET LOCAL semantics via set_config(..., true)).
-- When the context is unset or blank they return NULL, so policies like
--   college_id = app.current_college_id()
-- evaluate to NULL (not true) and therefore match NO rows (fail closed).
CREATE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app.current_college_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.college_id', true), '')::uuid $$;

CREATE FUNCTION app.current_role() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT NULLIF(current_setting('app.role', true), '') $$;

-- The runtime role may only use the schemas; it gets no CREATE anywhere and
-- receives explicit, per-table grants in later migrations.
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO cc_app;
GRANT USAGE ON SCHEMA public TO cc_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO cc_app;
