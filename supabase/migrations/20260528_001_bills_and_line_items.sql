-- Slice 3 — Bills + line items.
-- See docs/specs/2026-05-11-slice-3-bill-scanning-ocr-design.md §4 + §6.

create type public.bill_status as enum ('pending', 'processing', 'processed', 'failed');

create table public.bills (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references public.households(id) on delete cascade,
  uploaded_by_profile_id uuid references public.profiles(id) on delete set null,
  status                 public.bill_status not null default 'pending',
  status_reason          text,
  bill_date              date,
  store_name             text check (store_name is null or length(store_name) between 1 and 200),
  total_amount           numeric check (total_amount is null or total_amount >= 0),
  currency               text not null default 'SGD',
  image_storage_path     text not null,
  github_issue_number    int,
  github_issue_url       text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  processed_at           timestamptz
);

create index bills_household_created_idx
  on public.bills (household_id, created_at desc);

create index bills_status_idx
  on public.bills (status)
  where status in ('pending', 'processing');

create index bills_github_issue_idx
  on public.bills (github_issue_number)
  where github_issue_number is not null;

create trigger bills_touch_updated_at
  before update on public.bills
  for each row execute function public.touch_updated_at();

alter table public.bills enable row level security;

create policy bills_read on public.bills
  for select to authenticated
  using (public.has_active_membership(household_id));

create policy bills_insert on public.bills
  for insert to authenticated
  with check (public.is_active_owner_or_maid(household_id));

create policy bills_update on public.bills
  for update to authenticated
  using (public.is_active_owner_or_maid(household_id))
  with check (public.is_active_owner_or_maid(household_id));

create policy bills_delete on public.bills
  for delete to authenticated
  using (public.is_active_owner_or_maid(household_id));

-- Line items
create table public.bill_line_items (
  id                        uuid primary key default gen_random_uuid(),
  bill_id                   uuid not null references public.bills(id) on delete cascade,
  position                  int not null check (position >= 1),
  item_name                 text not null check (length(item_name) between 1 and 120),
  quantity                  numeric check (quantity is null or quantity > 0),
  unit                      text check (unit is null or length(unit) between 1 and 24),
  unit_price                numeric check (unit_price is null or unit_price >= 0),
  line_total                numeric check (line_total is null or line_total >= 0),
  matched_shopping_item_id  uuid references public.shopping_list_items(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (bill_id, position)
);

create index bill_line_items_bill_id_idx on public.bill_line_items (bill_id);

create trigger bill_line_items_touch_updated_at
  before update on public.bill_line_items
  for each row execute function public.touch_updated_at();

alter table public.bill_line_items enable row level security;

create policy bill_line_items_read on public.bill_line_items
  for select to authenticated
  using (
    exists (select 1 from public.bills b
            where b.id = bill_id
              and public.has_active_membership(b.household_id))
  );

create policy bill_line_items_write on public.bill_line_items
  for all to authenticated
  using (
    exists (select 1 from public.bills b
            where b.id = bill_id
              and public.is_active_owner_or_maid(b.household_id))
  )
  with check (
    exists (select 1 from public.bills b
            where b.id = bill_id
              and public.is_active_owner_or_maid(b.household_id))
  );
