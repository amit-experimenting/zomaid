create table public.invites (
  id                       uuid primary key default gen_random_uuid(),
  household_id             uuid not null references public.households(id) on delete cascade,
  invited_by_profile_id    uuid not null references public.profiles(id)   on delete restrict,
  intended_role            public.household_role      not null,
  intended_privilege       public.household_privilege,
  code                     text not null,
  token                    text not null unique,
  expires_at               timestamptz not null default (now() + interval '7 days'),
  consumed_at              timestamptz,
  consumed_by_profile_id   uuid references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now()
);

create unique index invites_active_code_idx
  on public.invites (code)
  where consumed_at is null;

create index invites_household_idx on public.invites (household_id);

alter table public.invites enable row level security;

-- READ + INSERT + UPDATE policies use the security-definer helpers from migration 003
-- to avoid RLS recursion through household_memberships.

create policy invites_household_eligible_read on public.invites
  for select to authenticated
  using (public.has_active_membership(invites.household_id));

create policy invites_household_eligible_insert on public.invites
  for insert to authenticated
  with check (
    invited_by_profile_id = public.current_profile_id()
    and public.has_active_membership(invites.household_id)
  );

create policy invites_revoke_update on public.invites
  for update to authenticated
  using (
    invited_by_profile_id = public.current_profile_id()
    or public.is_active_owner(invites.household_id)
  )
  with check (true);
