-- 0049_contact_email: the college email is for signing in. Drive lists, reports and their downloads give the student's personal email.
-- The result column of these four functions keeps its old name (changing it would mean dropping them); the application reads it as contact_email.
-- A student who has not added a personal email yet shows none: the college email is deliberately not used instead.
GRANT CREATE ON SCHEMA registrations, reports TO cc_auth;
SET LOCAL ROLE cc_auth;
DO $$
DECLARE f regprocedure; v text; v_fixed text;
BEGIN
  FOREACH f IN ARRAY ARRAY['registrations.list_for_drive(uuid)', 'registrations.participation(uuid, uuid)',
                           'reports.student_pool(integer, uuid, text)', 'reports.placement_rows(integer, uuid, text, uuid, uuid, date, date)']::regprocedure[] LOOP
    v := pg_get_functiondef(f);
    v_fixed := replace(v, 'st.college_email::text', 'st.personal_email::text');
    IF v_fixed = v THEN RAISE EXCEPTION '% no longer selects the college email as expected', f; END IF;
    EXECUTE v_fixed;
  END LOOP;
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA registrations, reports FROM cc_auth;
