-- 0016_least_privilege: remove the last two direct-write grants the runtime role still had. Nothing in the application uses them:
--  * audit entries are written only by the definer function auth.write_audit (actor, role and tenant come from the session, never from the caller);
--  * a user's display name is changed only through administrator workflows (it appears in history and audit views).
-- After this migration the runtime role cannot insert, update or delete any column of any table (enforced by db/tests/catalog-audit.test.ts).
REVOKE INSERT (scope, college_id, actor_user_id, actor_role, action, entity_type, entity_id, metadata, ip_hash) ON audit_log FROM cc_app;
DROP POLICY audit_insert ON audit_log;
REVOKE UPDATE (full_name, updated_at) ON users FROM cc_app;
DROP POLICY users_update_self ON users;
