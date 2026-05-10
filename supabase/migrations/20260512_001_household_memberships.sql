create type public.household_role     as enum ('owner', 'family_member', 'maid');
create type public.household_privilege as enum ('full', 'meal_modify', 'view_only');
create type public.membership_status   as enum ('active', 'pending', 'removed');

create table public.household_memberships (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id)        on delete cascade,
  profile_id    uuid not null references public.profiles(id)          on delete cascade,
  role          public.household_role     not null,
  privilege     public.household_privilege not null default 'full',
  status        public.membership_status   not null default 'active',
  joined_at     timestamptz not null default now(),
  removed_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One active membership per (household, profile)
create unique index hm_unique_active_pair
  on public.household_memberships (household_id, profile_id)
  where status <> 'removed';

-- At most one active maid per household
create unique index hm_unique_active_maid
  on public.household_memberships (household_id)
  where role = 'maid' and status = 'active';

-- At most one active owner per household
create unique index hm_unique_active_owner
  on public.household_memberships (household_id)
  where role = 'owner' and status = 'active';

alter table public.household_memberships enable row level security;

-- Security-definer helper: returns true if caller has an active membership in a household.
-- security definer so the subquery runs as owner (bypassing RLS) — prevents
-- infinite recursion when called from within household_memberships policies.
create or replace function public.has_active_membership(p_household uuid)
  returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select exists (
      select 1 from public.household_memberships
      where household_id = p_household
        and profile_id   = public.current_profile_id()
        and status       = 'active'
    );
  $$;

-- Security-definer helper: returns true if caller is an active owner of a household.
create or replace function public.is_active_owner(p_household uuid)
  returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select exists (
      select 1 from public.household_memberships
      where household_id = p_household
        and profile_id   = public.current_profile_id()
        and role         = 'owner'
        and status       = 'active'
    );
  $$;

-- A user can always read their own membership rows (any status)
create policy hm_self_read on public.household_memberships
  for select to authenticated
  using (profile_id = public.current_profile_id());

-- Members of the same household can read each other
create policy hm_household_read on public.household_memberships
  for select to authenticated
  using (public.has_active_membership(household_id));

-- Active owner can manage all memberships in their household
create policy hm_owner_update on public.household_memberships
  for update to authenticated
  using (public.is_active_owner(household_id))
  with check (public.is_active_owner(household_id));

-- A user can self-leave: update own row to status='removed'
create policy hm_self_leave on public.household_memberships
  for update to authenticated
  using (profile_id = public.current_profile_id())
  with check (
    profile_id = public.current_profile_id()
    and status = 'removed'
  );

-- Owner can also insert new memberships in their household
create policy hm_owner_insert on public.household_memberships
  for insert to authenticated
  with check (public.is_active_owner(household_id));

-- Touch updated_at on every UPDATE
create or replace function public.touch_updated_at()
  returns trigger language plpgsql as $$
  begin new.updated_at := now(); return new; end;
  $$;
create trigger hm_touch_updated_at before update on public.household_memberships
  for each row execute function public.touch_updated_at();

-- ----- Households read/update policies (now that memberships exists) -----

create policy households_member_read on public.households
  for select to authenticated
  using (public.has_active_membership(id));

create policy households_owner_update on public.households
  for update to authenticated
  using (public.is_active_owner(id))
  with check (true);
