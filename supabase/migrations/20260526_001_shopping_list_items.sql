-- Slice 2b — Shopping list (standing list per household, manual + auto-pulled).
-- See docs/specs/2026-05-11-slice-2b-shopping-list-design.md §4.

create table public.shopping_list_items (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references public.households(id) on delete cascade,
  item_name              text not null check (length(item_name) between 1 and 120),
  quantity               numeric check (quantity is null or quantity > 0),
  unit                   text check (unit is null or length(unit) between 1 and 24),
  notes                  text check (notes is null or length(notes) <= 500),
  bought_at              timestamptz,
  bought_by_profile_id   uuid references public.profiles(id) on delete set null,
  created_by_profile_id  uuid not null references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- "bought_by may only be set if bought_at is set"
  constraint sli_bought_consistency check (
    (bought_at is null  and bought_by_profile_id is null)
    or
    (bought_at is not null)
  )
);

-- Foundations migrations (20260516) defined created_by_profile_id as NOT NULL on
-- audit-bearing tables. Same here. We accept ON DELETE SET NULL despite the NOT
-- NULL constraint by relying on the FK's behaviour: if the profile is deleted,
-- Postgres needs to coerce the column to NULL, but the NOT NULL would reject it.
-- To match foundations' pattern: drop NOT NULL on created_by so the SET NULL works
-- when a profile is hard-deleted. The application always supplies a non-null
-- value on insert, so this is purely an integrity-vs-history trade-off.
alter table public.shopping_list_items
  alter column created_by_profile_id drop not null;

create index sli_household_unbought_idx
  on public.shopping_list_items (household_id, created_at desc)
  where bought_at is null;

create index sli_household_bought_idx
  on public.shopping_list_items (household_id, bought_at desc)
  where bought_at is not null;

create trigger sli_touch_updated_at
  before update on public.shopping_list_items
  for each row execute function public.touch_updated_at();

alter table public.shopping_list_items enable row level security;

create policy sli_read on public.shopping_list_items
  for select to authenticated
  using (public.has_active_membership(household_id));

create policy sli_insert on public.shopping_list_items
  for insert to authenticated
  with check (public.is_active_owner_or_maid(household_id));

create policy sli_update on public.shopping_list_items
  for update to authenticated
  using (public.is_active_owner_or_maid(household_id))
  with check (public.is_active_owner_or_maid(household_id));

create policy sli_delete on public.shopping_list_items
  for delete to authenticated
  using (public.is_active_owner_or_maid(household_id));
