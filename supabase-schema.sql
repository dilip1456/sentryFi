-- ============================================================
-- SentriFi — Full Database Schema
-- Run this in Supabase SQL Editor on your new project
-- ============================================================

-- Enums
create type public.app_role as enum ('admin', 'user');
create type public.plan_tier as enum ('free', 'pro', 'premium');

-- Profiles
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  phone text,
  timezone text,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = user_id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = user_id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, new.raw_user_meta_data->>'display_name');
  insert into public.subscribers (user_id, email, plan, status)
  values (new.id, new.email, 'free', 'active');
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Subscribers (plan management)
create table public.subscribers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  plan public.plan_tier not null default 'free',
  status text not null default 'active',
  stripe_customer_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.subscribers enable row level security;
create policy "Users can view own subscription" on public.subscribers for select using (auth.uid() = user_id);

-- User roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now()
);
alter table public.user_roles enable row level security;
create policy "Users can view own roles" on public.user_roles for select using (auth.uid() = user_id);

-- Helper function for role checks
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

-- Plaid items (linked bank connections)
create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  access_token text not null,
  institution_id text,
  institution_name text,
  status text not null default 'active',
  cursor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.plaid_items enable row level security;
create policy "Users can manage own plaid items" on public.plaid_items for all using (auth.uid() = user_id);

-- Plaid accounts
create table public.plaid_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.plaid_items(id) on delete cascade,
  account_id text not null,
  name text,
  official_name text,
  mask text,
  type text,
  subtype text,
  current_balance numeric,
  available_balance numeric,
  iso_currency_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.plaid_accounts enable row level security;
create policy "Users can manage own accounts" on public.plaid_accounts for all using (auth.uid() = user_id);

-- Plaid transactions
create table public.plaid_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.plaid_items(id) on delete cascade,
  account_id text not null,
  transaction_id text not null unique,
  name text,
  merchant_name text,
  amount numeric not null,
  date date not null,
  authorized_date date,
  category text[],
  payment_channel text,
  pending boolean,
  iso_currency_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.plaid_transactions enable row level security;
create policy "Users can manage own transactions" on public.plaid_transactions for all using (auth.uid() = user_id);
