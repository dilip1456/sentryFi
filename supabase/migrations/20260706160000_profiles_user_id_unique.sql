-- profiles.user_id needs a unique constraint for upsert(onConflict: user_id)
-- used by the profile save + avatar upload paths.
delete from public.profiles a
using public.profiles b
where a.user_id = b.user_id and a.ctid > b.ctid;

alter table public.profiles
  add constraint profiles_user_id_key unique (user_id);
