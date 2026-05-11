-- Slice 2a — Meal plan rows (one per household × date × slot).
-- The `is_active_owner_or_maid` helper used by these policies is defined in
-- 20260517_001_recipes.sql (shared with the recipes table writes).

create table public.meal_plans (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households(id) on delete cascade,
  plan_date          date not null,
  slot               public.meal_slot not null,
  recipe_id          uuid references public.recipes(id) on delete set null,
  set_by_profile_id  uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (household_id, plan_date, slot)
);

create index meal_plans_household_date_idx
  on public.meal_plans (household_id, plan_date desc);
create index meal_plans_household_slot_date_idx
  on public.meal_plans (household_id, slot, plan_date desc);

create trigger meal_plans_touch_updated_at
  before update on public.meal_plans
  for each row execute function public.touch_updated_at();

alter table public.meal_plans enable row level security;

create policy meal_plans_read on public.meal_plans
  for select to authenticated
  using (public.has_active_membership(household_id));

create policy meal_plans_insert on public.meal_plans
  for insert to authenticated
  with check (public.is_active_owner_or_maid(household_id));

create policy meal_plans_update on public.meal_plans
  for update to authenticated
  using (public.is_active_owner_or_maid(household_id))
  with check (public.is_active_owner_or_maid(household_id));

create policy meal_plans_delete on public.meal_plans
  for delete to authenticated
  using (public.is_active_owner_or_maid(household_id));
