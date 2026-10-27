-- Security audit L2: has_role(_user_id, _role) is SECURITY DEFINER and was
-- executable by every authenticated user, so anyone could call
-- rpc('has_role', { _user_id: <any uuid>, _role: 'admin' }) and enumerate
-- admins. Every policy calls it as has_role(auth.uid(), ...), so limiting it
-- to the caller's own id (or service_role) changes nothing for the app.
-- Admins can still list everyone's roles through the "Admins view all roles"
-- policy on user_roles.

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    _user_id = auth.uid()
    OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
  )
  AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
