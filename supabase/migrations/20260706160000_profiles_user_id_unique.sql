-- profiles.user_id needs a unique constraint for upsert(onConflict: user_id)
-- used by the profile save + avatar upload paths.
delete from public.profiles a
using public.profiles b
where a.user_id = b.user_id and a.ctid > b.ctid;

-- Guarded: on a fresh project 20260601172002 already created this constraint
-- (inline UNIQUE, same auto-generated name), which made `supabase db reset`
-- fail here. Already applied on production, where it is never re-run.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_user_id_key'
  ) then
    alter table public.profiles add constraint profiles_user_id_key unique (user_id);
  end if;
end $$;
