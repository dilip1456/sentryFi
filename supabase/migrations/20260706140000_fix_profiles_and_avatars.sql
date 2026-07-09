-- Fix profile saves (missing INSERT policy meant update on a non-existent row
-- silently no-oped) + auto-create profile rows + avatars storage bucket.

-- 1. INSERT policy so users can create their own profile row.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='profiles' and cmd='INSERT'
  ) then
    create policy "Users can insert own profile"
      on public.profiles for insert
      with check (auth.uid() = user_id);
  end if;
end $$;

-- 2. Auto-create a profile row when a new auth user signs up.
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name'))
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- 3. Backfill existing users missing a profile.
insert into public.profiles (user_id, display_name)
select u.id, coalesce(u.raw_user_meta_data->>'display_name', u.raw_user_meta_data->>'full_name')
from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null;

-- 4. Public avatars bucket + policies (public read, users manage own folder).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Avatar public read') then
    create policy "Avatar public read" on storage.objects
      for select using (bucket_id = 'avatars');
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Avatar user upload') then
    create policy "Avatar user upload" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Avatar user update') then
    create policy "Avatar user update" on storage.objects
      for update to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Avatar user delete') then
    create policy "Avatar user delete" on storage.objects
      for delete to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;
