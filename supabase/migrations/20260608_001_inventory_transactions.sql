-- Slice 2 inventory — audit ledger. Every change to inventory_items.quantity
-- writes a row here. Enables undo, "why is this so low" inspection,
-- and tests that assert deduction provenance.

create type public.inventory_txn_reason as enum
  ('onboarding', 'manual_adjust', 'cook_deduct', 'bill_ingest', 'undo');

create table public.inventory_transactions (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households(id) on delete cascade,
  inventory_item_id     uuid not null references public.inventory_items(id) on delete cascade,
  delta                 numeric not null,
  unit                  text not null,
  reason                public.inventory_txn_reason not null,
  meal_plan_id          uuid references public.meal_plans(id) on delete set null,
  bill_line_item_id     uuid references public.bill_line_items(id) on delete set null,
  actor_profile_id      uuid references public.profiles(id) on delete set null,
  notes                 text,
  created_at            timestamptz not null default now()
);

create index inventory_transactions_item_idx
  on public.inventory_transactions (inventory_item_id, created_at desc);
create index inventory_transactions_meal_idx
  on public.inventory_transactions (meal_plan_id)
  where meal_plan_id is not null;
create index inventory_transactions_bill_idx
  on public.inventory_transactions (bill_line_item_id)
  where bill_line_item_id is not null;

alter table public.inventory_transactions enable row level security;

-- Reads: any active household member.
create policy inventory_transactions_read on public.inventory_transactions
  for select to authenticated
  using (public.has_active_membership(household_id));

-- Writes are not allowed directly. All inserts happen through writer RPCs
-- (cook-deduct, bill-ingest, manual-adjust) which are security definer.
-- No insert/update/delete policy = denied for authenticated.
