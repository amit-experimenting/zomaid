-- Slice 2 inventory — table for each household's stock of an item.
-- Unique by (household_id, lowercased name, unit) so "5 kg rice" and
-- "200 g rice" are separate rows; deduction resolves them at runtime
-- via unit_conversions.

create table public.inventory_items (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households(id) on delete cascade,
  item_name             text not null check (length(item_name) between 1 and 120),
  quantity              numeric not null default 0 check (quantity >= 0),
  unit                  text not null check (length(unit) between 1 and 24),
  low_stock_threshold   numeric check (low_stock_threshold is null or low_stock_threshold >= 0),
  notes                 text check (notes is null or length(notes) <= 500),
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index inventory_items_household_lower_name_unit_idx
  on public.inventory_items (household_id, lower(item_name), unit);

create index inventory_items_household_idx
  on public.inventory_items (household_id);

create trigger inventory_items_touch_updated_at
  before update on public.inventory_items
  for each row execute function public.touch_updated_at();

alter table public.inventory_items enable row level security;

create policy inventory_items_read on public.inventory_items
  for select to authenticated
  using (public.has_active_membership(household_id));

create policy inventory_items_insert on public.inventory_items
  for insert to authenticated
  with check (public.is_active_owner_or_maid(household_id));

create policy inventory_items_update on public.inventory_items
  for update to authenticated
  using (public.is_active_owner_or_maid(household_id))
  with check (public.is_active_owner_or_maid(household_id));

create policy inventory_items_delete on public.inventory_items
  for delete to authenticated
  using (public.is_active_owner_or_maid(household_id));
