-- Production drift repair: UNIQUE (user_id, role) on user_roles, as in
-- 20260601172002 (the live table was created without it).
-- Any exact duplicates are moved to user_roles_dedupe_backup (service_role
-- only) first, keeping the oldest row (lowest ctid). Idempotent.
DO $$
DECLARE
  n bigint := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = 'public.user_roles'::regclass AND i.indisunique AND i.indnkeyatts = 2 AND i.indpred IS NULL
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
           WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::int2[])) = ARRAY['role', 'user_id']
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles GROUP BY user_id, role HAVING count(*) > 1) THEN
    CREATE TABLE IF NOT EXISTS public.user_roles_dedupe_backup (LIKE public.user_roles INCLUDING DEFAULTS);
    ALTER TABLE public.user_roles_dedupe_backup ENABLE ROW LEVEL SECURITY; -- no policies: service_role only
    REVOKE ALL ON public.user_roles_dedupe_backup FROM anon, authenticated;
    WITH ranked AS (
      SELECT ctid AS rid, row_number() OVER (PARTITION BY user_id, role ORDER BY ctid) AS rn FROM public.user_roles
    ), moved AS (
      INSERT INTO public.user_roles_dedupe_backup
      SELECT u.* FROM public.user_roles u JOIN ranked r ON r.rid = u.ctid WHERE r.rn > 1
      RETURNING 1
    )
    SELECT count(*) INTO n FROM moved;
    DELETE FROM public.user_roles u USING (
      SELECT ctid AS rid, row_number() OVER (PARTITION BY user_id, role ORDER BY ctid) AS rn FROM public.user_roles
    ) r WHERE r.rid = u.ctid AND r.rn > 1;
    RAISE NOTICE 'user_roles: moved % duplicate row(s) to user_roles_dedupe_backup', n;
  END IF;

  ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
END $$;
