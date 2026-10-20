-- Admin role management (Make / Revoke admin) goes through the
-- admin-set-user-role edge function (service role). Authenticated users keep
-- SELECT-only on user_roles: this migration grants nothing to clients.
--
-- Last-admin guard: deleting (or re-roling) an admin row must never leave
-- zero admins. The edge function checks this too, but two admins revoking
-- each other at the same moment could both pass that check; this trigger
-- serializes admin removals with a transaction-scoped advisory lock and
-- re-counts, so the second one fails. Applies to every role (service_role
-- included). Use TRUNCATE (not covered) for a deliberate full wipe.
-- Idempotent.

CREATE OR REPLACE FUNCTION public.user_roles_keep_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining bigint;
BEGIN
  IF OLD.role <> 'admin' OR (TG_OP = 'UPDATE' AND NEW.role = 'admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- Serialize concurrent admin removals; READ COMMITTED gives the count
  -- below a fresh snapshot taken after the lock.
  PERFORM pg_advisory_xact_lock(hashtext('public.user_roles:last_admin'));
  SELECT count(*) INTO remaining
  FROM public.user_roles
  WHERE role = 'admin' AND NOT (user_id = OLD.user_id AND role = OLD.role);
  IF remaining = 0 AND EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
    RAISE EXCEPTION 'cannot remove the last admin' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.user_roles_keep_last_admin() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_roles_keep_last_admin ON public.user_roles;
CREATE TRIGGER user_roles_keep_last_admin
  BEFORE DELETE OR UPDATE OF role ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.user_roles_keep_last_admin();
