-- Slice 2 inventory — unit conversion table.
-- household_id IS NULL means Zomaid default. item_name IS NULL means generic.
-- Lookup priority at deduction time (most specific first):
--   household + item-specific  > global + item-specific
--   > household + generic     > global + generic > skip+warn.

create table public.unit_conversions (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references public.households(id) on delete cascade,
  item_name     text,
  from_unit     text not null check (length(from_unit) between 1 and 24),
  to_unit       text not null check (length(to_unit) between 1 and 24),
  multiplier    numeric not null check (multiplier > 0),
  created_at    timestamptz not null default now()
);

-- Uniqueness handles nulls explicitly via coalesce-to-sentinel.
-- The empty string for item_name and the zero-uuid for household_id are
-- never valid real values, so the coalesce is safe.
create unique index unit_conversions_unique_idx
  on public.unit_conversions
  (coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(lower(item_name), ''),
   lower(from_unit),
   lower(to_unit));

alter table public.unit_conversions enable row level security;

-- Reads: defaults (household_id IS NULL) visible to all authenticated users.
-- Household-specific rows visible to active members.
create policy uc_read on public.unit_conversions
  for select to authenticated
  using (
    household_id is null
    or public.has_active_membership(household_id)
  );

-- Writes: only household-specific rows, only by owner/maid.
-- Default rows (household_id IS NULL) are seeded by service_role only.
create policy uc_insert on public.unit_conversions
  for insert to authenticated
  with check (
    household_id is not null
    and public.is_active_owner_or_maid(household_id)
  );

create policy uc_update on public.unit_conversions
  for update to authenticated
  using (
    household_id is not null
    and public.is_active_owner_or_maid(household_id)
  )
  with check (
    household_id is not null
    and public.is_active_owner_or_maid(household_id)
  );

create policy uc_delete on public.unit_conversions
  for delete to authenticated
  using (
    household_id is not null
    and public.is_active_owner_or_maid(household_id)
  );
