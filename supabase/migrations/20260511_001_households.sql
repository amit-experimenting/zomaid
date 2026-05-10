create table public.households (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  address_line             text,
  postal_code              text,
  created_by_profile_id    uuid not null references public.profiles(id) on delete restrict,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index households_created_by_idx on public.households (created_by_profile_id);

alter table public.households enable row level security;

-- INSERT policy only here. READ/UPDATE policies depend on household_memberships
-- and are added in migration 003 (after that table exists). With RLS enabled and
-- no SELECT policy, all reads are denied — exactly what tests/db/households.test.ts
-- asserts.
create policy households_creator_insert on public.households
  for insert to authenticated
  with check (created_by_profile_id = public.current_profile_id());
