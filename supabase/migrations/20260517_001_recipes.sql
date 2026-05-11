-- Slice 2a — Recipe catalog. Starter pack + per-household fork-on-edit.
-- See docs/specs/2026-05-11-slice-2a-recipes-meal-plan-design.md §4.

create type public.meal_slot as enum
  ('breakfast', 'lunch', 'snacks', 'dinner');

create table public.recipes (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid references public.households(id) on delete cascade,
  parent_recipe_id      uuid references public.recipes(id) on delete set null,
  name                  text not null check (length(name) between 1 and 120),
  slot                  public.meal_slot not null,
  photo_path            text,
  prep_time_minutes     int check (prep_time_minutes is null or prep_time_minutes > 0),
  notes                 text,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Invariants: starter / custom / fork must match exactly one shape.
  constraint recipes_invariant check (
    (household_id is null and parent_recipe_id is null and created_by_profile_id is null)
    or
    (household_id is not null and parent_recipe_id is null and created_by_profile_id is not null)
    or
    (household_id is not null and parent_recipe_id is not null and created_by_profile_id is not null)
  )
);

create unique index recipes_household_fork_unique
  on public.recipes (household_id, parent_recipe_id)
  where parent_recipe_id is not null;

create index recipes_household_id_idx        on public.recipes (household_id);
create index recipes_slot_idx                on public.recipes (slot);
create index recipes_archived_at_idx         on public.recipes (archived_at)
  where archived_at is not null;

alter table public.recipes enable row level security;

-- updated_at trigger (foundations pattern)
create or replace function public.touch_updated_at()
  returns trigger language plpgsql as $$
  begin new.updated_at := now(); return new; end;
  $$;
-- Note: foundations may already define touch_updated_at; create or replace handles that.

create trigger recipes_touch_updated_at
  before update on public.recipes
  for each row execute function public.touch_updated_at();

-- ── Helper used by recipes + meal_plans writes ─────────────────────────────
-- Defined before RLS policies so they compile in apply order.
-- Task 5's meal_plans migration references this existing function.
create or replace function public.is_active_owner_or_maid(p_household uuid)
  returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select exists (
      select 1 from public.household_memberships hm
      join public.profiles p on p.id = hm.profile_id
      where hm.household_id = p_household
        and hm.status = 'active'
        and hm.role in ('owner', 'maid')
        and p.clerk_user_id = (auth.jwt() ->> 'sub')
    );
  $$;

-- ── RLS ────────────────────────────────────────────────────────────────────

-- Starter rows readable to any authenticated user.
create policy recipes_read_starter on public.recipes
  for select to authenticated
  using (
    household_id is null
    and (auth.jwt() ->> 'sub') is not null
  );

-- Household-scoped read: any active member.
create policy recipes_read_household on public.recipes
  for select to authenticated
  using (
    household_id is not null
    and public.has_active_membership(household_id)
  );

-- Household-scoped writes: owner OR maid. Starter rows are written by the
-- seed migration as service_role and have no insert/update/delete policy.
create policy recipes_insert_household on public.recipes
  for insert to authenticated
  with check (
    household_id is not null
    and public.is_active_owner_or_maid(household_id)
  );

create policy recipes_update_household on public.recipes
  for update to authenticated
  using (
    household_id is not null
    and public.is_active_owner_or_maid(household_id)
  )
  with check (
    household_id is not null
    and public.is_active_owner_or_maid(household_id)
  );

create policy recipes_delete_household on public.recipes
  for delete to authenticated
  using (
    household_id is not null
    and public.is_active_owner_or_maid(household_id)
  );

