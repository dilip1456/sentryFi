-- Security audit M2: the admin "disable user" flag (profiles.disabled) was
-- cosmetic, and the "Users update own profile" policy plus
-- GRANT UPDATE ON profiles let a disabled user set disabled = false on their
-- own row.
--
-- After this migration:
--   * Only privileged database roles (service_role, postgres, supabase_admin)
--     can set or change profiles.disabled. Any INSERT/UPDATE that comes in
--     through the API as anon/authenticated and touches the flag is rejected
--     (42501), including admins using the REST API directly. Admins now go
--     through the admin-set-user-disabled edge function, which checks the
--     admin role, bans/unbans the auth user (so sign-in and token refresh
--     fail) and then updates the flag with service_role. That keeps the flag
--     and the real enforcement (the auth ban) in sync.
--   * Profile saves from the app (display_name, phone, timezone, avatar_url
--     upserts) are unaffected: they never send `disabled`, so the value is
--     unchanged and the trigger lets them through.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.profiles_protect_disabled()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY INVOKER on purpose: current_user is then the API role that
-- PostgREST switched to (anon / authenticated / service_role).
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW; -- service_role, postgres, supabase_admin, auth triggers
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.disabled, false) THEN
      RAISE EXCEPTION 'profiles.disabled can only be set by an administrator'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.disabled IS DISTINCT FROM OLD.disabled THEN
    RAISE EXCEPTION 'profiles.disabled can only be changed by an administrator'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.profiles_protect_disabled() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_protect_disabled ON public.profiles;
CREATE TRIGGER trg_profiles_protect_disabled
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_disabled();
