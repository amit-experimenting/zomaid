-- Profiles table — one row per Clerk user. RLS enforces self-read/self-write.
-- Admin reads via is_admin flag (set by app boot from ZOMAID_ADMIN_CLERK_USER_IDS).

create extension if not exists pgcrypto;

create table public.profiles (
  id            uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  email         text not null,
  display_name  text not null default '',
  locale        text not null default 'en-SG',
  timezone      text not null default 'Asia/Singapore',
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index profiles_clerk_user_id_idx on public.profiles (clerk_user_id);

alter table public.profiles enable row level security;

-- Helper: returns the caller's profiles.id from their JWT sub.
-- security definer so the function runs as owner (bypassing RLS) when called
-- from within profiles RLS policies — prevents infinite recursion.
create or replace function public.current_profile_id() returns uuid
  language sql stable security definer
  set search_path = public
  as $$
    select id from public.profiles
    where clerk_user_id = (auth.jwt() ->> 'sub');
  $$;

-- Helper: returns true if caller is admin.
-- security definer so the function runs as owner (bypassing RLS) when called
-- from within profiles RLS policies — prevents infinite recursion.
create or replace function public.current_is_admin() returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select coalesce(
      (select is_admin from public.profiles
       where clerk_user_id = (auth.jwt() ->> 'sub')),
      false
    );
  $$;

-- Self-read.
create policy profiles_self_read on public.profiles
  for select to authenticated
  using (clerk_user_id = (auth.jwt() ->> 'sub'));

-- Admin-read (cross-tenant).
create policy profiles_admin_read on public.profiles
  for select to authenticated
  using (public.current_is_admin());

-- Self-update of safe columns. Trigger below blocks is_admin and immutable cols.
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (clerk_user_id = (auth.jwt() ->> 'sub'))
  with check (clerk_user_id = (auth.jwt() ->> 'sub'));

create or replace function public.profiles_block_protected_columns()
  returns trigger language plpgsql as $$
  begin
    if new.id           is distinct from old.id           then raise exception 'id is immutable'; end if;
    if new.clerk_user_id is distinct from old.clerk_user_id then raise exception 'clerk_user_id is immutable'; end if;
    if new.email        is distinct from old.email        then new.email := old.email; end if;
    if new.is_admin     is distinct from old.is_admin     and not public.current_is_admin()
      then new.is_admin := old.is_admin;
    end if;
    new.updated_at := now();
    return new;
  end;
  $$;

create trigger profiles_block_protected_columns
  before update on public.profiles
  for each row execute function public.profiles_block_protected_columns();

-- Service role (used by webhooks + boot tasks) bypasses RLS entirely. No policy needed.
-- Anon users have no policy => zero visibility.
