-- Production drift repair: admin RLS policies from 20260601172002.
--
-- 20260601172002 is recorded as applied on the live project, but its admin
-- policies never existed there (the owner-only policies exist under other
-- names, e.g. "Users can view own profile"), so admins could only ever see
-- their own rows. Restored exactly as defined in 20260601172002.
--
-- has_role(auth.uid(), 'admin') still works after 20261020170400
-- (has_role_self_only): that change only rejects _user_id <> auth.uid(),
-- and these policies always pass the caller's own id. has_role is
-- SECURITY DEFINER, so the policies on user_roles do not recurse.
-- Non-admins are unaffected: the admin policies are permissive and only add
-- rows when has_role(...) is true.
-- Idempotent: drop-if-exists then create.

DROP POLICY IF EXISTS "Admins view all roles" ON public.user_roles;
CREATE POLICY "Admins view all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins view all profiles" ON public.profiles;
CREATE POLICY "Admins view all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update any profile" ON public.profiles;
CREATE POLICY "Admins update any profile" ON public.profiles
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins view all subscriptions" ON public.subscribers;
CREATE POLICY "Admins view all subscriptions" ON public.subscribers
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
