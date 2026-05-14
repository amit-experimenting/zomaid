-- Slice 2 inventory — additions to existing tables.
-- 1) meal_plans gains people_eating + cooked_at + deduction_status + warnings
-- 2) bill_line_items gains inventory-ingest tracking
-- 3) households gains inventory_card_dismissed_at

-- ── meal_plans ─────────────────────────────────────────────────────────
create type public.meal_deduction_status as enum
  ('pending', 'deducted', 'skipped', 'partial');

alter table public.meal_plans
  add column people_eating       int check (people_eating is null or people_eating between 1 and 50),
  add column cooked_at           timestamptz,
  add column deduction_status    public.meal_deduction_status not null default 'pending',
  add column deduction_warnings  jsonb;

create index meal_plans_pending_deduction_idx
  on public.meal_plans (household_id, plan_date)
  where deduction_status = 'pending';

-- ── bill_line_items ────────────────────────────────────────────────────
alter table public.bill_line_items
  add column inventory_ingested_at        timestamptz,
  add column inventory_ingestion_skipped  boolean not null default false,
  add column matched_inventory_item_id    uuid references public.inventory_items(id) on delete set null;

create index bill_line_items_pending_inventory_idx
  on public.bill_line_items (bill_id)
  where inventory_ingested_at is null and inventory_ingestion_skipped = false;

-- ── households ────────────────────────────────────────────────────────
alter table public.households
  add column inventory_card_dismissed_at  timestamptz;
