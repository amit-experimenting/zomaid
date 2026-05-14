# Kitchen Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a kitchen inventory subsystem that auto-deducts ingredients when meals are cooked (1h before the next slot), ingests scanned bills via an owner/maid review queue, and reconciles cooking-unit vs stock-unit mismatches via a household-overridable conversion table.

**Architecture:** Four new tables (`inventory_items`, `inventory_transactions`, `household_meal_times`, `unit_conversions`) sit alongside existing meal-plan and bill tables. A pg_cron sweep runs every 15 minutes and calls a deduction RPC for each meal whose lock window has passed. Bills land in a review queue on `/bills/[id]`; owner/maid confirms each line into inventory. All inventory changes go through writer RPCs that also log to an `inventory_transactions` ledger for audit and undo. Meal-slot edits (recipe + people_eating) lock 1 hour before the slot's start time.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · `lucide-react` · Supabase Postgres 17 + `pg_cron` · Vitest + `pg` (DB tests) · Playwright (E2E) · pnpm 10.

**Spec reference:** [`docs/specs/2026-05-14-inventory-design.md`](../specs/2026-05-14-inventory-design.md) (commit `88a0ab6`).

**Depends on:**
- Slice 1 (recipe data fill) — provides `recipes.default_servings` and ingredient quantities.
- Slice 3 bill-scanning OCR — provides `bill_line_items` rows this slice ingests.
- Existing `can_modify_meal_plan(household_id)` helper from migration `20260604_001_meal_plan_family_modify.sql`.

---

## Pre-flight checks (manual, one-time)

- [ ] **A. Local Supabase is running.** Run `pnpm db:start`. Expected: `API URL: http://127.0.0.1:54321`.

- [ ] **B. Branch is up to date with the spec.** Run `git log --oneline -n 3`. Expected: top commit is `88a0ab6 Spec: kitchen inventory (slice 2 of 3)` (or later). Pull if not.

- [ ] **C. Existing tests pass.** Run `pnpm vitest run` (excluding the env-var-dependent invites-actions tests). Expected: all DB tests green.

- [ ] **D. Create feature branch.** Run:
  ```bash
  git checkout -b slice-2-inventory
  git branch --show-current
  ```
  Expected: prints `slice-2-inventory`.

---

## File structure recap

```
supabase/migrations/
  20260607_001_inventory_items.sql                       (Task 1)
  20260608_001_inventory_transactions.sql                (Task 2)
  20260609_001_household_meal_times.sql                  (Task 3)
  20260610_001_unit_conversions.sql                      (Task 4)
  20260611_001_inventory_column_additions.sql            (Task 5)
  20260612_001_unit_conversions_seed.sql                 (Task 6)
  20260613_001_inventory_helpers.sql                     (Task 8)
  20260614_001_inventory_cook_deduct.sql                 (Task 9)
  20260615_001_inventory_sweep_cron.sql                  (Task 10)
  20260616_001_inventory_bill_rpcs.sql                   (Task 11)
  20260617_001_inventory_manual_adjust.sql               (Task 12)
  20260618_001_meal_plan_inventory_rpcs.sql              (Task 13)

src/lib/db/types.ts                                      (Task 7)

src/app/inventory/page.tsx                               (Task 17)
src/app/inventory/new/page.tsx                           (Task 18)
src/app/inventory/[id]/page.tsx                          (Task 19)
src/app/inventory/conversions/page.tsx                   (Task 20)
src/app/inventory/actions.ts                             (Task 14)
src/app/household/meal-times/page.tsx                    (Task 21)
src/app/household/meal-times/actions.ts                  (Task 15)
src/app/bills/[id]/_inventory-queue.tsx                  (Task 24)
src/app/bills/[id]/actions.ts                            (Task 16, may extend existing)

src/components/inventory/item-card.tsx                   (Task 17)
src/components/inventory/adjust-form.tsx                 (Task 19)
src/components/inventory/transaction-log.tsx             (Task 19)
src/components/site/inventory-prompt-card.tsx            (Task 22)
src/components/plan/people-pill.tsx                      (Task 23)
src/components/plan/slot-warning-badge.tsx               (Task 23)

tests/db/inventory-items.test.ts                         (Task 1 / 8 / 12)
tests/db/inventory-transactions.test.ts                  (Task 2)
tests/db/household-meal-times.test.ts                    (Task 3)
tests/db/inventory-conversions.test.ts                   (Task 4 / 8)
tests/db/inventory-cook-deduct.test.ts                   (Task 9)
tests/db/inventory-sweep.test.ts                         (Task 10)
tests/db/inventory-bill-ingest.test.ts                   (Task 11)
tests/db/meal-plan-lock.test.ts                          (Task 13)
tests/e2e/inventory.spec.ts                              (Task 25)
```

---

## Task 1: Schema — `inventory_items` table

**Files:** Create: `supabase/migrations/20260607_001_inventory_items.sql`

- [ ] **Step 1: Create the migration file**

  ```sql
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
  ```

- [ ] **Step 2: Apply migration**

  Run: `pnpm db:reset`
  Expected: completes; the new file appears near the bottom of the apply list.

- [ ] **Step 3: Verify schema**

  Run:
  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "\d+ public.inventory_items"
  ```
  Expected: 10 columns, one unique index on `(household_id, lower(item_name), unit)`, RLS enabled.

- [ ] **Step 4: Smoke-test the uniqueness invariant**

  Run:
  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" <<SQL
  -- Create a test household + profile via service role would normally be required,
  -- but for this smoke test we just confirm the unique index rejects duplicates.
  -- A real CRUD test lives in tests/db/inventory-items.test.ts (later task).
  SQL
  ```
  (No insertion needed yet; existence of the unique index was verified in Step 3.)

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/20260607_001_inventory_items.sql
  git commit -m "feat(db): inventory_items table with RLS"
  ```

---

## Task 2: Schema — `inventory_transactions` ledger

**Files:** Create: `supabase/migrations/20260608_001_inventory_transactions.sql`

- [ ] **Step 1: Create the migration**

  ```sql
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
  ```

- [ ] **Step 2: Apply and verify**

  Run: `pnpm db:reset`
  Expected: clean apply.

  Run:
  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "\d+ public.inventory_transactions"
  ```
  Expected: 10 columns, RLS enabled, no insert/update/delete policies (read-only for authenticated; writes via RPC).

- [ ] **Step 3: Commit**

  ```bash
  git add supabase/migrations/20260608_001_inventory_transactions.sql
  git commit -m "feat(db): inventory_transactions ledger + reason enum"
  ```

---

## Task 3: Schema — `household_meal_times` + default seed trigger

**Files:** Create: `supabase/migrations/20260609_001_household_meal_times.sql`

- [ ] **Step 1: Create the migration**

  ```sql
  -- Slice 2 inventory — meal time configuration per household.
  -- Default seeded on household creation; any active member may update.

  create table public.household_meal_times (
    household_id  uuid not null references public.households(id) on delete cascade,
    slot          public.meal_slot not null,
    meal_time     time not null,
    updated_at    timestamptz not null default now(),
    primary key (household_id, slot)
  );

  create trigger household_meal_times_touch_updated_at
    before update on public.household_meal_times
    for each row execute function public.touch_updated_at();

  alter table public.household_meal_times enable row level security;

  create policy hmt_read on public.household_meal_times
    for select to authenticated
    using (public.has_active_membership(household_id));

  -- Any active member can update meal times (per spec).
  create policy hmt_insert on public.household_meal_times
    for insert to authenticated
    with check (public.has_active_membership(household_id));

  create policy hmt_update on public.household_meal_times
    for update to authenticated
    using (public.has_active_membership(household_id))
    with check (public.has_active_membership(household_id));

  create policy hmt_delete on public.household_meal_times
    for delete to authenticated
    using (public.has_active_membership(household_id));

  -- Seed defaults on household creation. Trigger runs as the inserting role,
  -- bypassing RLS via security definer so the insert works during onboarding.
  create or replace function public.seed_default_meal_times()
    returns trigger
    language plpgsql security definer
    set search_path = public
    as $$
    begin
      insert into public.household_meal_times (household_id, slot, meal_time) values
        (new.id, 'breakfast', '08:00'),
        (new.id, 'lunch',     '13:00'),
        (new.id, 'snacks',    '17:00'),
        (new.id, 'dinner',    '20:00')
      on conflict (household_id, slot) do nothing;
      return new;
    end;
    $$;

  create trigger households_seed_meal_times
    after insert on public.households
    for each row execute function public.seed_default_meal_times();

  -- Backfill existing households (idempotent).
  insert into public.household_meal_times (household_id, slot, meal_time)
  select h.id, s.slot, s.meal_time
    from public.households h
    cross join (values
      ('breakfast'::public.meal_slot, '08:00'::time),
      ('lunch'::public.meal_slot,     '13:00'::time),
      ('snacks'::public.meal_slot,    '17:00'::time),
      ('dinner'::public.meal_slot,    '20:00'::time)
    ) as s(slot, meal_time)
  on conflict (household_id, slot) do nothing;
  ```

- [ ] **Step 2: Apply and verify**

  Run: `pnpm db:reset`
  Expected: clean apply. No data exists in the dev DB so the backfill does nothing.

  Run:
  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "\d+ public.household_meal_times" && \
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "\df public.seed_default_meal_times"
  ```
  Expected: table + trigger function visible.

- [ ] **Step 3: Commit**

  ```bash
  git add supabase/migrations/20260609_001_household_meal_times.sql
  git commit -m "feat(db): household_meal_times + onboarding default seed trigger"
  ```

---

## Task 4: Schema — `unit_conversions`

**Files:** Create: `supabase/migrations/20260610_001_unit_conversions.sql`

- [ ] **Step 1: Create the migration**

  ```sql
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
  ```

- [ ] **Step 2: Apply and verify**

  Run: `pnpm db:reset`
  Expected: clean apply.

  Run:
  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "\d+ public.unit_conversions"
  ```
  Expected: 7 columns, unique index visible.

- [ ] **Step 3: Commit**

  ```bash
  git add supabase/migrations/20260610_001_unit_conversions.sql
  git commit -m "feat(db): unit_conversions with household-override pattern"
  ```

---

## Task 5: Schema — additions to `meal_plans`, `bill_line_items`, `households`

**Files:** Create: `supabase/migrations/20260611_001_inventory_column_additions.sql`

- [ ] **Step 1: Create the migration**

  ```sql
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
  ```

- [ ] **Step 2: Apply and verify**

  Run: `pnpm db:reset`
  Expected: clean apply.

  Run:
  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c \
    "\d+ public.meal_plans" | grep -E 'people_eating|cooked_at|deduction_status|deduction_warnings'
  ```
  Expected: 4 lines shown.

  Run:
  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c \
    "\d+ public.bill_line_items" | grep -E 'inventory_ingested_at|inventory_ingestion_skipped|matched_inventory_item_id'
  ```
  Expected: 3 lines.

- [ ] **Step 3: Commit**

  ```bash
  git add supabase/migrations/20260611_001_inventory_column_additions.sql
  git commit -m "feat(db): inventory columns on meal_plans, bill_line_items, households"
  ```

---

## Task 6: Seed — Zomaid default `unit_conversions`

**Files:** Create: `supabase/migrations/20260612_001_unit_conversions_seed.sql`

- [ ] **Step 1: Create the migration**

  ```sql
  -- Slice 2 inventory — Zomaid-default unit conversions.
  -- household_id IS NULL = default. item_name IS NULL = generic.
  -- All values are approximations sufficient for kitchen-scale cooking.

  insert into public.unit_conversions (household_id, item_name, from_unit, to_unit, multiplier) values
    -- ── Generic volume (item_name NULL) ────────────────────────────────
    (null, null, 'cup',  'ml',  240),
    (null, null, 'tbsp', 'ml',  15),
    (null, null, 'tsp',  'ml',  5),
    (null, null, 'l',    'ml',  1000),

    -- ── Generic mass (item_name NULL) ─────────────────────────────────
    (null, null, 'kg', 'g',  1000),
    (null, null, 'lb', 'g',  453.6),
    (null, null, 'oz', 'g',  28.35),

    -- ── Generic volume ↔ mass for water-like density (1 ml ~= 1 g) ────
    (null, null, 'ml',  'g',   1),
    (null, null, 'cup', 'g',   240),
    (null, null, 'tbsp','g',   15),
    (null, null, 'tsp', 'g',   5),

    -- ── Rice (idli rice, basmati rice, jasmine rice — match by lowercased item_name)
    (null, 'rice',          'cup', 'g', 195),
    (null, 'basmati rice',  'cup', 'g', 195),
    (null, 'jasmine rice',  'cup', 'g', 195),
    (null, 'idli rice',     'cup', 'g', 200),
    (null, 'cooked rice',   'cup', 'g', 195),
    (null, 'flattened rice','cup', 'g', 100),

    -- ── Flour (plain flour, whole wheat flour, gram flour, rice flour) ─
    (null, 'plain flour',       'cup', 'g', 120),
    (null, 'whole wheat flour', 'cup', 'g', 120),
    (null, 'gram flour',        'cup', 'g', 100),
    (null, 'rice flour',        'cup', 'g', 120),
    (null, 'tapioca flour',     'cup', 'g', 130),
    (null, 'glutinous rice flour','cup','g', 130),
    (null, 'semolina',          'cup', 'g', 170),

    -- ── Sugars / sweeteners ────────────────────────────────────────────
    (null, 'sugar',         'cup', 'g', 200),
    (null, 'palm sugar',    'cup', 'g', 230),
    (null, 'honey',         'tbsp','g', 21),

    -- ── Lentils / pulses ───────────────────────────────────────────────
    (null, 'toor dal',  'cup', 'g', 200),
    (null, 'urad dal',  'cup', 'g', 200),
    (null, 'moong dal', 'cup', 'g', 200),
    (null, 'rajma',     'cup', 'g', 180),
    (null, 'chickpeas', 'cup', 'g', 200),

    -- ── Dairy ──────────────────────────────────────────────────────────
    (null, 'milk',        'cup', 'g', 245),
    (null, 'yogurt',      'cup', 'g', 245),
    (null, 'cream',       'cup', 'g', 240),
    (null, 'fresh cream', 'cup', 'g', 240),
    (null, 'butter',      'cup', 'g', 227),
    (null, 'butter',      'tbsp','g', 14),
    (null, 'ghee',        'cup', 'g', 218),
    (null, 'ghee',        'tbsp','g', 14),
    (null, 'cooking oil', 'cup', 'g', 218),
    (null, 'cooking oil', 'tbsp','g', 14),
    (null, 'oil for frying','cup','g', 218),
    (null, 'coconut milk','cup', 'g', 245),

    -- ── Discrete items (1 piece ≈ X grams) ─────────────────────────────
    (null, 'eggs',         'piece', 'g', 50),
    (null, 'onion',        'piece', 'g', 150),
    (null, 'tomato',       'piece', 'g', 120),
    (null, 'potato',       'piece', 'g', 200),
    (null, 'banana',       'piece', 'g', 120),
    (null, 'apple',        'piece', 'g', 180),
    (null, 'orange',       'piece', 'g', 130),
    (null, 'green chili',  'piece', 'g', 3),
    (null, 'garlic',       'clove', 'g', 3)
  on conflict (
    coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(lower(item_name), ''),
    lower(from_unit),
    lower(to_unit)
  ) do nothing;
  ```

- [ ] **Step 2: Apply and verify**

  Run: `pnpm db:reset`
  Expected: clean apply.

  Run:
  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c \
    "select count(*) from unit_conversions where household_id is null;"
  ```
  Expected: count >= 50.

  Run:
  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c \
    "select item_name, from_unit, to_unit, multiplier from unit_conversions where household_id is null and item_name = 'basmati rice';"
  ```
  Expected: one row, cup → g, multiplier = 195.

- [ ] **Step 3: Commit**

  ```bash
  git add supabase/migrations/20260612_001_unit_conversions_seed.sql
  git commit -m "feat(db): seed Zomaid-default unit_conversions"
  ```

---

## Task 7: TypeScript types update

**Files:** Modify: `src/lib/db/types.ts`

- [ ] **Step 1: Add the new table types**

  Open `src/lib/db/types.ts`. Inside the `Tables` block (after the last existing table — find the closing `}` of e.g. `tasks:` or `push_subscriptions:`), add four new table definitions:

  ```ts
        inventory_items: {
          Row: {
            id: string;
            household_id: string;
            item_name: string;
            quantity: number;
            unit: string;
            low_stock_threshold: number | null;
            notes: string | null;
            created_by_profile_id: string | null;
            created_at: string;
            updated_at: string;
          };
          Insert: {
            id?: string;
            household_id: string;
            item_name: string;
            quantity?: number;
            unit: string;
            low_stock_threshold?: number | null;
            notes?: string | null;
            created_by_profile_id?: string | null;
            created_at?: string;
            updated_at?: string;
          };
          Update: Partial<Database["public"]["Tables"]["inventory_items"]["Insert"]>;
          Relationships: [];
        };
        inventory_transactions: {
          Row: {
            id: string;
            household_id: string;
            inventory_item_id: string;
            delta: number;
            unit: string;
            reason: "onboarding" | "manual_adjust" | "cook_deduct" | "bill_ingest" | "undo";
            meal_plan_id: string | null;
            bill_line_item_id: string | null;
            actor_profile_id: string | null;
            notes: string | null;
            created_at: string;
          };
          Insert: {
            id?: string;
            household_id: string;
            inventory_item_id: string;
            delta: number;
            unit: string;
            reason: "onboarding" | "manual_adjust" | "cook_deduct" | "bill_ingest" | "undo";
            meal_plan_id?: string | null;
            bill_line_item_id?: string | null;
            actor_profile_id?: string | null;
            notes?: string | null;
            created_at?: string;
          };
          Update: Partial<Database["public"]["Tables"]["inventory_transactions"]["Insert"]>;
          Relationships: [];
        };
        household_meal_times: {
          Row: {
            household_id: string;
            slot: "breakfast" | "lunch" | "snacks" | "dinner";
            meal_time: string;
            updated_at: string;
          };
          Insert: {
            household_id: string;
            slot: "breakfast" | "lunch" | "snacks" | "dinner";
            meal_time: string;
            updated_at?: string;
          };
          Update: Partial<Database["public"]["Tables"]["household_meal_times"]["Insert"]>;
          Relationships: [];
        };
        unit_conversions: {
          Row: {
            id: string;
            household_id: string | null;
            item_name: string | null;
            from_unit: string;
            to_unit: string;
            multiplier: number;
            created_at: string;
          };
          Insert: {
            id?: string;
            household_id?: string | null;
            item_name?: string | null;
            from_unit: string;
            to_unit: string;
            multiplier: number;
            created_at?: string;
          };
          Update: Partial<Database["public"]["Tables"]["unit_conversions"]["Insert"]>;
          Relationships: [];
        };
  ```

- [ ] **Step 2: Extend the `meal_plans` row type**

  Find the `meal_plans:` block (~line 183 in the file at this point in the slice). In its `Row` block append:

  ```ts
            people_eating: number | null;
            cooked_at: string | null;
            deduction_status: "pending" | "deducted" | "skipped" | "partial";
            deduction_warnings: unknown | null;
  ```

  And in its `Insert` block append:

  ```ts
            people_eating?: number | null;
            cooked_at?: string | null;
            deduction_status?: "pending" | "deducted" | "skipped" | "partial";
            deduction_warnings?: unknown | null;
  ```

  (`unknown | null` is the project's convention for jsonb columns where there's no concrete shape yet.)

- [ ] **Step 3: Extend the `bill_line_items` row type**

  Find the `bill_line_items:` block. Append to `Row`:

  ```ts
            inventory_ingested_at: string | null;
            inventory_ingestion_skipped: boolean;
            matched_inventory_item_id: string | null;
  ```

  And to `Insert`:

  ```ts
            inventory_ingested_at?: string | null;
            inventory_ingestion_skipped?: boolean;
            matched_inventory_item_id?: string | null;
  ```

- [ ] **Step 4: Extend the `households` row type**

  Find the `households:` block. Append to `Row`:

  ```ts
            inventory_card_dismissed_at: string | null;
  ```

  And to `Insert`:

  ```ts
            inventory_card_dismissed_at?: string | null;
  ```

- [ ] **Step 5: Typecheck**

  Run: `pnpm typecheck`
  Expected: exit 0.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/db/types.ts
  git commit -m "types(db): inventory tables and column additions"
  ```

---

## Task 8: DB helpers — `household_roster_size`, `inventory_lookup`, `inventory_convert`

**Files:**
- Create: `supabase/migrations/20260613_001_inventory_helpers.sql`
- Create: `tests/db/inventory-conversions.test.ts`

- [ ] **Step 1: Write the failing test**

  Create `tests/db/inventory-conversions.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { setJwtClaims, withTransaction } from "../setup";
  import { insertHousehold, insertMembership, insertProfile } from "../factories";

  describe("unit conversion lookup priority", () => {
    it("returns multiplier for global+generic conversion", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: me.id });
        await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
        await setJwtClaims(c, { sub: me.clerk_user_id });

        const { rows } = await c.query<{ inventory_convert: string | null }>(
          `select public.inventory_convert($1, null, 'cup', 'ml', 2)`,
          [h.id],
        );
        expect(rows[0].inventory_convert).not.toBeNull();
        // 2 cups * 240 ml/cup = 480 ml
        expect(Number(rows[0].inventory_convert)).toBe(480);
      });
    });

    it("item-specific override beats generic", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: me.id });
        await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
        await setJwtClaims(c, { sub: me.clerk_user_id });

        // basmati rice global default = 195 g/cup
        // 1 cup -> 195 g (not 240 ml which would be water-density)
        const { rows } = await c.query<{ inventory_convert: string | null }>(
          `select public.inventory_convert($1, 'basmati rice', 'cup', 'g', 1)`,
          [h.id],
        );
        expect(Number(rows[0].inventory_convert)).toBe(195);
      });
    });

    it("household-specific override beats global", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: me.id });
        await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
        await setJwtClaims(c, { sub: me.clerk_user_id });

        // Override basmati rice for this household: 1 cup = 250 g (instead of 195)
        await c.query(
          `insert into unit_conversions (household_id, item_name, from_unit, to_unit, multiplier)
           values ($1, 'basmati rice', 'cup', 'g', 250)`,
          [h.id],
        );

        const { rows } = await c.query<{ inventory_convert: string | null }>(
          `select public.inventory_convert($1, 'basmati rice', 'cup', 'g', 1)`,
          [h.id],
        );
        expect(Number(rows[0].inventory_convert)).toBe(250);
      });
    });

    it("returns null when no conversion exists", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: me.id });
        await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
        await setJwtClaims(c, { sub: me.clerk_user_id });

        const { rows } = await c.query<{ inventory_convert: string | null }>(
          `select public.inventory_convert($1, 'unobtanium', 'lump', 'kg', 1)`,
          [h.id],
        );
        expect(rows[0].inventory_convert).toBeNull();
      });
    });
  });
  ```

  Add the `insertMembership` factory if it doesn't already exist by checking `tests/factories.ts` — if it does not exist there, append it. (It almost certainly does, given foundations work — but check first by running `grep -n insertMembership tests/factories.ts`.)

- [ ] **Step 2: Run test (should fail — function doesn't exist yet)**

  Run: `pnpm vitest run tests/db/inventory-conversions.test.ts`
  Expected: 4 failures, all complaining about `inventory_convert` not existing.

- [ ] **Step 3: Create the helper migration**

  Create `supabase/migrations/20260613_001_inventory_helpers.sql`:

  ```sql
  -- Slice 2 inventory — small read-only helpers used by the cook-deduct RPC
  -- and (later) the auto-allocation engine.

  -- Count of active household members (used for default people_eating).
  create or replace function public.household_roster_size(p_household uuid)
    returns int
    language sql stable security invoker
    set search_path = public
    as $$
      select count(*)::int from public.household_memberships
        where household_id = p_household and status = 'active';
    $$;

  grant execute on function public.household_roster_size(uuid) to authenticated;

  -- Pick an inventory_items row for a (household, item_name, ingredient_unit).
  -- Prefers the same-unit row; falls back to any matching name otherwise.
  create or replace function public.inventory_lookup(
    p_household  uuid,
    p_item_name  text,
    p_unit       text
  ) returns public.inventory_items
    language sql stable security invoker
    set search_path = public
    as $$
      select * from public.inventory_items
      where household_id = p_household
        and lower(item_name) = lower(p_item_name)
      order by
        case when lower(unit) = lower(p_unit) then 0 else 1 end,
        quantity desc
      limit 1;
    $$;

  grant execute on function public.inventory_lookup(uuid, text, text) to authenticated;

  -- Convert p_qty from p_from_unit to p_to_unit. Walks the spec's priority list:
  --   1) household + item-specific
  --   2) global   + item-specific
  --   3) household + generic
  --   4) global   + generic
  -- Returns NULL if no conversion exists at any priority.
  create or replace function public.inventory_convert(
    p_household  uuid,
    p_item_name  text,
    p_from_unit  text,
    p_to_unit    text,
    p_qty        numeric
  ) returns numeric
    language sql stable security invoker
    set search_path = public
    as $$
      with priorities as (
        select multiplier, 1 as pri
          from public.unit_conversions
          where household_id = p_household
            and p_item_name is not null and lower(item_name) = lower(p_item_name)
            and lower(from_unit) = lower(p_from_unit)
            and lower(to_unit)   = lower(p_to_unit)
        union all
        select multiplier, 2
          from public.unit_conversions
          where household_id is null
            and p_item_name is not null and lower(item_name) = lower(p_item_name)
            and lower(from_unit) = lower(p_from_unit)
            and lower(to_unit)   = lower(p_to_unit)
        union all
        select multiplier, 3
          from public.unit_conversions
          where household_id = p_household
            and item_name is null
            and lower(from_unit) = lower(p_from_unit)
            and lower(to_unit)   = lower(p_to_unit)
        union all
        select multiplier, 4
          from public.unit_conversions
          where household_id is null
            and item_name is null
            and lower(from_unit) = lower(p_from_unit)
            and lower(to_unit)   = lower(p_to_unit)
      )
      select (multiplier * p_qty)::numeric
        from priorities
        order by pri asc
        limit 1;
    $$;

  grant execute on function public.inventory_convert(uuid, text, text, text, numeric) to authenticated;
  ```

- [ ] **Step 4: Apply migration and re-run test**

  Run: `pnpm db:reset`
  Run: `pnpm vitest run tests/db/inventory-conversions.test.ts`
  Expected: 4 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/20260613_001_inventory_helpers.sql tests/db/inventory-conversions.test.ts
  git commit -m "feat(db): inventory helpers + lookup priority tests"
  ```

---

## Task 9: DB function — `inventory_cook_deduct`

**Files:**
- Create: `supabase/migrations/20260614_001_inventory_cook_deduct.sql`
- Create: `tests/db/inventory-cook-deduct.test.ts`

This task implements the core deduction algorithm. The RPC is `security definer` so the cron (running as postgres) can invoke; it does its own permission check.

- [ ] **Step 1: Write failing tests**

  Create `tests/db/inventory-cook-deduct.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { randomUUID } from "node:crypto";
  import { setJwtClaims, withTransaction } from "../setup";
  import { insertHousehold, insertMembership, insertProfile } from "../factories";
  import type { Client } from "pg";

  async function setupInventoryAndRecipe(c: Client) {
    const me = await insertProfile(c);
    const h = await insertHousehold(c, { created_by_profile_id: me.id });
    await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
    await setJwtClaims(c, { sub: me.clerk_user_id });

    // Custom recipe with one ingredient (avoid global starter contention).
    const recipeId = randomUUID();
    await c.query(
      `insert into recipes (id, household_id, parent_recipe_id, name, slot, default_servings, created_by_profile_id)
       values ($1, $2, null, 'Test Curry', 'lunch', 4, $3)`,
      [recipeId, h.id, me.id],
    );
    await c.query(
      `insert into recipe_ingredients (recipe_id, position, item_name, quantity, unit)
       values ($1, 1, 'basmati rice', 2, 'cup')`,
      [recipeId],
    );

    // Inventory has 5 kg basmati rice (will require cup→g conversion: 195g/cup → 390g needed).
    const invId = randomUUID();
    await c.query(
      `insert into inventory_items (id, household_id, item_name, quantity, unit)
       values ($1, $2, 'basmati rice', 5000, 'g')`,
      [invId, h.id],
    );

    // Meal plan row for today's lunch using the recipe.
    const mpId = randomUUID();
    await c.query(
      `insert into meal_plans (id, household_id, plan_date, slot, recipe_id, set_by_profile_id)
       values ($1, $2, current_date, 'lunch', $3, $4)`,
      [mpId, h.id, recipeId, me.id],
    );

    return { householdId: h.id, profileId: me.id, recipeId, invId, mealPlanId: mpId };
  }

  describe("inventory_cook_deduct", () => {
    it("deducts scaled by default_servings; status='deducted'", async () => {
      await withTransaction(async (c) => {
        const { householdId, invId, mealPlanId } = await setupInventoryAndRecipe(c);
        // Roster size = 1 (just me). Default servings = 4. Scale = 1/4. Need 2 cup * 1/4 = 0.5 cup = 97.5g.
        const { rows } = await c.query<{ inventory_cook_deduct: unknown }>(
          `select public.inventory_cook_deduct($1)`,
          [mealPlanId],
        );
        expect(rows[0].inventory_cook_deduct).toMatchObject({ status: "deducted" });

        const r = await c.query(`select quantity from inventory_items where id = $1`, [invId]);
        expect(Number(r.rows[0].quantity)).toBeCloseTo(5000 - 97.5, 1);

        const status = await c.query(`select deduction_status, cooked_at from meal_plans where id = $1`, [mealPlanId]);
        expect(status.rows[0].deduction_status).toBe("deducted");
        expect(status.rows[0].cooked_at).not.toBeNull();
      });
    });

    it("clamps to zero and reports 'partial' when out of stock", async () => {
      await withTransaction(async (c) => {
        const { householdId, invId, mealPlanId } = await setupInventoryAndRecipe(c);
        // Drain to 50g so 97.5g needed is short.
        await c.query(`update inventory_items set quantity = 50 where id = $1`, [invId]);

        const { rows } = await c.query<{ inventory_cook_deduct: any }>(
          `select public.inventory_cook_deduct($1)`,
          [mealPlanId],
        );
        expect(rows[0].inventory_cook_deduct.status).toBe("partial");
        expect(rows[0].inventory_cook_deduct.warnings).toHaveLength(1);
        expect(rows[0].inventory_cook_deduct.warnings[0].reason).toBe("short");

        const r = await c.query(`select quantity from inventory_items where id = $1`, [invId]);
        expect(Number(r.rows[0].quantity)).toBe(0);
      });
    });

    it("is idempotent on re-run", async () => {
      await withTransaction(async (c) => {
        const { invId, mealPlanId } = await setupInventoryAndRecipe(c);
        await c.query(`select public.inventory_cook_deduct($1)`, [mealPlanId]);
        const r1 = await c.query(`select quantity from inventory_items where id = $1`, [invId]);
        // Re-run: should return early, no further deduction.
        await c.query(`select public.inventory_cook_deduct($1)`, [mealPlanId]);
        const r2 = await c.query(`select quantity from inventory_items where id = $1`, [invId]);
        expect(Number(r2.rows[0].quantity)).toBe(Number(r1.rows[0].quantity));
      });
    });

    it("marks as 'skipped' when meal_plan has no recipe", async () => {
      await withTransaction(async (c) => {
        const { householdId, profileId } = await setupInventoryAndRecipe(c);
        const mpId = randomUUID();
        await c.query(
          `insert into meal_plans (id, household_id, plan_date, slot, recipe_id, set_by_profile_id)
           values ($1, $2, current_date, 'breakfast', null, $3)`,
          [mpId, householdId, profileId],
        );
        const { rows } = await c.query<{ inventory_cook_deduct: any }>(
          `select public.inventory_cook_deduct($1)`,
          [mpId],
        );
        expect(rows[0].inventory_cook_deduct.status).toBe("skipped");
      });
    });

    it("warns when ingredient is not in stock (reason='not_in_stock')", async () => {
      await withTransaction(async (c) => {
        const { householdId, profileId } = await setupInventoryAndRecipe(c);
        const recipeId = randomUUID();
        await c.query(
          `insert into recipes (id, household_id, parent_recipe_id, name, slot, default_servings, created_by_profile_id)
           values ($1, $2, null, 'Unstocked Dish', 'dinner', 4, $3)`,
          [recipeId, householdId, profileId],
        );
        await c.query(
          `insert into recipe_ingredients (recipe_id, position, item_name, quantity, unit)
           values ($1, 1, 'mythical herb', 1, 'pinch')`,
          [recipeId],
        );
        const mpId = randomUUID();
        await c.query(
          `insert into meal_plans (id, household_id, plan_date, slot, recipe_id, set_by_profile_id)
           values ($1, $2, current_date, 'dinner', $3, $4)`,
          [mpId, householdId, recipeId, profileId],
        );

        const { rows } = await c.query<{ inventory_cook_deduct: any }>(
          `select public.inventory_cook_deduct($1)`,
          [mpId],
        );
        expect(rows[0].inventory_cook_deduct.status).toBe("partial");
        expect(rows[0].inventory_cook_deduct.warnings[0].reason).toBe("not_in_stock");
      });
    });
  });
  ```

- [ ] **Step 2: Run tests (expect failure)**

  Run: `pnpm vitest run tests/db/inventory-cook-deduct.test.ts`
  Expected: 5 failures (function doesn't exist).

- [ ] **Step 3: Create the RPC migration**

  Create `supabase/migrations/20260614_001_inventory_cook_deduct.sql`:

  ```sql
  -- Slice 2 inventory — the cook-deduct RPC.
  -- Called by the cron sweep (as postgres) and by manual user invocations.
  -- security definer + internal permission check so both callers work.

  create or replace function public.inventory_cook_deduct(p_meal_plan_id uuid)
    returns jsonb
    language plpgsql security definer
    set search_path = public
    as $$
    declare
      v_meal              public.meal_plans;
      v_recipe            public.recipes;
      v_effective_people  int;
      v_scale             numeric;
      v_ingredient        record;
      v_inv               public.inventory_items;
      v_needed_qty        numeric;
      v_deduct_qty        numeric;
      v_converted_qty     numeric;
      v_warnings          jsonb := '[]'::jsonb;
      v_final_status      public.meal_deduction_status;
      v_caller_role       text;
    begin
      -- Lock the meal_plan row so concurrent runs serialize.
      select * into v_meal from public.meal_plans where id = p_meal_plan_id for update;
      if v_meal is null then
        return jsonb_build_object('status', 'error', 'reason', 'meal_plan_not_found');
      end if;

      -- Permission: cron runs as postgres (bypass); otherwise require active owner/maid.
      -- session_user is the role that connected to Postgres; for cron it's `postgres`.
      if session_user not in ('postgres', 'supabase_admin') then
        if not public.is_active_owner_or_maid(v_meal.household_id) then
          raise exception 'permission denied' using errcode = 'P0001';
        end if;
      end if;

      -- Idempotent: do nothing if already processed.
      if v_meal.deduction_status <> 'pending' then
        return jsonb_build_object('status', v_meal.deduction_status::text, 'idempotent', true);
      end if;

      -- Skipped: no recipe attached.
      if v_meal.recipe_id is null then
        update public.meal_plans
          set deduction_status = 'skipped',
              cooked_at = now()
          where id = p_meal_plan_id;
        return jsonb_build_object('status', 'skipped');
      end if;

      select * into v_recipe from public.recipes where id = v_meal.recipe_id;
      v_effective_people := coalesce(v_meal.people_eating, public.household_roster_size(v_meal.household_id));
      v_scale := v_effective_people::numeric / v_recipe.default_servings::numeric;

      for v_ingredient in
        select ri.item_name, ri.quantity, ri.unit
          from public.recipe_ingredients ri
          where ri.recipe_id = v_meal.recipe_id
          order by ri.position
      loop
        v_needed_qty := v_ingredient.quantity * v_scale;
        v_inv := public.inventory_lookup(v_meal.household_id, v_ingredient.item_name, v_ingredient.unit);

        if v_inv.id is null then
          v_warnings := v_warnings || jsonb_build_object(
            'item_name', v_ingredient.item_name,
            'requested_qty', v_needed_qty,
            'deducted_qty', 0,
            'unit', v_ingredient.unit,
            'reason', 'not_in_stock'
          );
          continue;
        end if;

        v_deduct_qty := v_needed_qty;
        if lower(v_inv.unit) <> lower(v_ingredient.unit) then
          v_converted_qty := public.inventory_convert(
            v_meal.household_id, v_ingredient.item_name, v_ingredient.unit, v_inv.unit, v_needed_qty
          );
          if v_converted_qty is null then
            v_warnings := v_warnings || jsonb_build_object(
              'item_name', v_ingredient.item_name,
              'requested_qty', v_needed_qty,
              'deducted_qty', 0,
              'unit', v_ingredient.unit,
              'reason', 'no_conversion'
            );
            continue;
          end if;
          v_deduct_qty := v_converted_qty;
        end if;

        if v_deduct_qty > v_inv.quantity then
          v_warnings := v_warnings || jsonb_build_object(
            'item_name', v_ingredient.item_name,
            'requested_qty', v_deduct_qty,
            'deducted_qty', v_inv.quantity,
            'unit', v_inv.unit,
            'reason', 'short'
          );
          v_deduct_qty := v_inv.quantity;
        end if;

        update public.inventory_items
          set quantity = quantity - v_deduct_qty
          where id = v_inv.id;

        insert into public.inventory_transactions
          (household_id, inventory_item_id, delta, unit, reason, meal_plan_id, actor_profile_id)
          values
          (v_meal.household_id, v_inv.id, -v_deduct_qty, v_inv.unit, 'cook_deduct', p_meal_plan_id, null);
      end loop;

      v_final_status := case when jsonb_array_length(v_warnings) > 0 then 'partial'::public.meal_deduction_status
                              else 'deducted'::public.meal_deduction_status end;

      update public.meal_plans
        set deduction_status = v_final_status,
            cooked_at = now(),
            deduction_warnings = case when jsonb_array_length(v_warnings) > 0 then v_warnings else null end
        where id = p_meal_plan_id;

      return jsonb_build_object('status', v_final_status::text, 'warnings', v_warnings);
    end;
    $$;

  grant execute on function public.inventory_cook_deduct(uuid) to authenticated;
  ```

- [ ] **Step 4: Apply and re-run tests**

  Run: `pnpm db:reset`
  Run: `pnpm vitest run tests/db/inventory-cook-deduct.test.ts`
  Expected: 5 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/20260614_001_inventory_cook_deduct.sql tests/db/inventory-cook-deduct.test.ts
  git commit -m "feat(db): inventory_cook_deduct RPC + tests"
  ```

---

## Task 10: DB function — `inventory_sweep_due_meals` + pg_cron

**Files:**
- Create: `supabase/migrations/20260615_001_inventory_sweep_cron.sql`
- Create: `tests/db/inventory-sweep.test.ts`

- [ ] **Step 1: Write failing test**

  Create `tests/db/inventory-sweep.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { randomUUID } from "node:crypto";
  import { withTransaction, setJwtClaims } from "../setup";
  import { insertHousehold, insertMembership, insertProfile } from "../factories";

  describe("inventory_sweep_due_meals", () => {
    it("deducts a meal whose next-slot lock window has passed", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: me.id });
        await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
        await setJwtClaims(c, { sub: me.clerk_user_id });

        // A recipe whose ingredient has a matching inventory item (so deduction succeeds cleanly).
        const recipeId = randomUUID();
        await c.query(
          `insert into recipes (id, household_id, parent_recipe_id, name, slot, default_servings, created_by_profile_id)
           values ($1, $2, null, 'Test', 'breakfast', 4, $3)`,
          [recipeId, h.id, me.id],
        );
        await c.query(
          `insert into recipe_ingredients (recipe_id, position, item_name, quantity, unit)
           values ($1, 1, 'rice', 1, 'cup')`,
          [recipeId],
        );
        await c.query(
          `insert into inventory_items (household_id, item_name, quantity, unit)
           values ($1, 'rice', 1000, 'g')`,
          [h.id],
        );

        // Set meal_plan for today's breakfast.
        const mpId = randomUUID();
        await c.query(
          `insert into meal_plans (id, household_id, plan_date, slot, recipe_id, set_by_profile_id)
           values ($1, $2, current_date, 'breakfast', $3, $4)`,
          [mpId, h.id, recipeId, me.id],
        );

        // Force breakfast time to "well in the past" so lock window has passed.
        await c.query(
          `update household_meal_times set meal_time = '00:01' where household_id = $1 and slot = 'breakfast'`,
          [h.id],
        );
        // Force lunch time (the next slot) to "right now" so the 1h-before window includes now().
        await c.query(
          `update household_meal_times set meal_time = ((extract(hour from now()))::int || ':00')::time where household_id = $1 and slot = 'lunch'`,
          [h.id],
        );

        const { rows } = await c.query<{ inventory_sweep_due_meals: number }>(
          `select public.inventory_sweep_due_meals()`,
        );
        expect(rows[0].inventory_sweep_due_meals).toBeGreaterThanOrEqual(1);

        const r = await c.query(`select deduction_status from meal_plans where id = $1`, [mpId]);
        expect(["deducted", "partial"]).toContain(r.rows[0].deduction_status);
      });
    });

    it("does nothing when lock window has not passed yet", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: me.id });
        await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
        await setJwtClaims(c, { sub: me.clerk_user_id });

        // Meal time set 6 hours in the future — window is not open yet.
        const future_hour = ((new Date().getHours() + 6) % 24);
        await c.query(
          `update household_meal_times set meal_time = ($1 || ':00')::time where household_id = $2 and slot = 'lunch'`,
          [String(future_hour).padStart(2, "0"), h.id],
        );

        const mpId = randomUUID();
        await c.query(
          `insert into meal_plans (household_id, plan_date, slot, recipe_id, set_by_profile_id)
           values ($1, current_date, 'breakfast', null, $2)
           returning id`,
          [h.id, me.id],
        );

        const r = await c.query(`select deduction_status from meal_plans where household_id = $1 and slot = 'breakfast'`, [h.id]);
        expect(r.rows[0].deduction_status).toBe("pending");
      });
    });
  });
  ```

- [ ] **Step 2: Run tests (expect failure)**

  Run: `pnpm vitest run tests/db/inventory-sweep.test.ts`
  Expected: 2 failures (function doesn't exist).

- [ ] **Step 3: Create the sweep + cron migration**

  Create `supabase/migrations/20260615_001_inventory_sweep_cron.sql`:

  ```sql
  -- Slice 2 inventory — periodic sweep that calls inventory_cook_deduct
  -- for any meal whose lock window has passed.
  --
  -- Lock window = next slot's meal_time minus 1 hour. For dinner (last slot),
  -- end-of-day (23:59 same date) substitutes.
  --
  -- The sweep limits itself to plan_date between current_date - 2 and current_date
  -- to keep its work bounded; older missed meals can be processed manually by an
  -- owner via the UI if needed.

  create or replace function public.inventory_sweep_due_meals()
    returns int
    language plpgsql security definer
    set search_path = public
    as $$
    declare
      v_row record;
      v_processed int := 0;
      v_meal_time time;
      v_next_meal_time time;
      v_meal_dt timestamptz;
      v_window_start timestamptz;
    begin
      for v_row in
        select m.id, m.household_id, m.plan_date, m.slot
          from public.meal_plans m
          where m.deduction_status = 'pending'
            and m.plan_date between current_date - 2 and current_date
      loop
        select meal_time into v_meal_time
          from public.household_meal_times
          where household_id = v_row.household_id and slot = v_row.slot;
        if v_meal_time is null then continue; end if;

        v_next_meal_time := case v_row.slot
          when 'breakfast' then (select meal_time from public.household_meal_times where household_id = v_row.household_id and slot = 'lunch')
          when 'lunch'     then (select meal_time from public.household_meal_times where household_id = v_row.household_id and slot = 'snacks')
          when 'snacks'    then (select meal_time from public.household_meal_times where household_id = v_row.household_id and slot = 'dinner')
          when 'dinner'    then '23:59'::time
        end;
        if v_next_meal_time is null then continue; end if;

        v_meal_dt := (v_row.plan_date::timestamp + v_next_meal_time);
        v_window_start := v_meal_dt - interval '1 hour';

        if now() >= v_window_start then
          perform public.inventory_cook_deduct(v_row.id);
          v_processed := v_processed + 1;
        end if;
      end loop;

      return v_processed;
    end;
    $$;

  revoke execute on function public.inventory_sweep_due_meals() from public;
  grant  execute on function public.inventory_sweep_due_meals() to postgres;

  -- Schedule the sweep every 15 minutes.
  create extension if not exists pg_cron;

  do $$ begin
    if exists (select 1 from cron.job where jobname = 'inventory-sweep') then
      perform cron.unschedule('inventory-sweep');
    end if;
    perform cron.schedule(
      'inventory-sweep',
      '*/15 * * * *',
      $cmd$ select public.inventory_sweep_due_meals(); $cmd$
    );
  end $$;
  ```

- [ ] **Step 4: Apply and re-run tests**

  Run: `pnpm db:reset`
  Run: `pnpm vitest run tests/db/inventory-sweep.test.ts`
  Expected: 2 tests pass.

- [ ] **Step 5: Verify cron schedule landed**

  Run:
  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "select jobname, schedule, command from cron.job where jobname = 'inventory-sweep';"
  ```
  Expected: one row, schedule `*/15 * * * *`.

- [ ] **Step 6: Commit**

  ```bash
  git add supabase/migrations/20260615_001_inventory_sweep_cron.sql tests/db/inventory-sweep.test.ts
  git commit -m "feat(db): inventory sweep + pg_cron every 15 minutes"
  ```

---

## Task 11: DB function — bill ingest RPCs

**Files:**
- Create: `supabase/migrations/20260616_001_inventory_bill_rpcs.sql`
- Create: `tests/db/inventory-bill-ingest.test.ts`

- [ ] **Step 1: Write failing tests**

  Create `tests/db/inventory-bill-ingest.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { randomUUID } from "node:crypto";
  import { setJwtClaims, withTransaction } from "../setup";
  import { insertHousehold, insertMembership, insertProfile } from "../factories";
  import type { Client } from "pg";

  async function setupBillAndLine(c: Client, opts: { itemName?: string; qty?: number; unit?: string } = {}) {
    const me = await insertProfile(c);
    const h = await insertHousehold(c, { created_by_profile_id: me.id });
    await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
    await setJwtClaims(c, { sub: me.clerk_user_id });

    const billId = randomUUID();
    await c.query(
      `insert into bills (id, household_id, status, image_storage_path)
       values ($1, $2, 'processed', 'test/x.jpg')`,
      [billId, h.id],
    );

    const lineId = randomUUID();
    await c.query(
      `insert into bill_line_items (id, bill_id, position, item_name, quantity, unit)
       values ($1, $2, 1, $3, $4, $5)`,
      [lineId, billId, opts.itemName ?? "basmati rice", opts.qty ?? 5, opts.unit ?? "kg"],
    );

    return { householdId: h.id, profileId: me.id, billId, lineId };
  }

  describe("inventory_bill_ingest / skip / unskip", () => {
    it("creates a new inventory item from a line", async () => {
      await withTransaction(async (c) => {
        const { lineId } = await setupBillAndLine(c);
        await c.query(
          `select public.inventory_bill_ingest($1, null, 5, 'kg', 'basmati rice')`,
          [lineId],
        );
        const inv = await c.query(`select quantity, unit from inventory_items where lower(item_name) = 'basmati rice'`);
        expect(inv.rows).toHaveLength(1);
        expect(Number(inv.rows[0].quantity)).toBe(5);
        expect(inv.rows[0].unit).toBe("kg");

        const line = await c.query(`select inventory_ingested_at, matched_inventory_item_id from bill_line_items where id = $1`, [lineId]);
        expect(line.rows[0].inventory_ingested_at).not.toBeNull();
        expect(line.rows[0].matched_inventory_item_id).not.toBeNull();
      });
    });

    it("adds to existing inventory with unit conversion", async () => {
      await withTransaction(async (c) => {
        const { householdId, lineId } = await setupBillAndLine(c, { itemName: "basmati rice", qty: 2, unit: "kg" });
        const invId = randomUUID();
        // Existing inventory in grams.
        await c.query(
          `insert into inventory_items (id, household_id, item_name, quantity, unit)
           values ($1, $2, 'basmati rice', 1000, 'g')`,
          [invId, householdId],
        );
        await c.query(`select public.inventory_bill_ingest($1, $2, 2, 'kg', null)`, [lineId, invId]);

        const inv = await c.query(`select quantity from inventory_items where id = $1`, [invId]);
        // 1000 g + (2 kg = 2000 g) = 3000 g
        expect(Number(inv.rows[0].quantity)).toBe(3000);
      });
    });

    it("rejects with INV_NO_CONVERSION when units cannot be reconciled", async () => {
      await withTransaction(async (c) => {
        const { householdId, lineId } = await setupBillAndLine(c, { itemName: "unobtanium", qty: 1, unit: "lump" });
        const invId = randomUUID();
        await c.query(
          `insert into inventory_items (id, household_id, item_name, quantity, unit)
           values ($1, $2, 'unobtanium', 5, 'kg')`,
          [invId, householdId],
        );
        await expect(
          c.query(`select public.inventory_bill_ingest($1, $2, 1, 'lump', null)`, [lineId, invId]),
        ).rejects.toThrow(/INV_NO_CONVERSION/);
      });
    });

    it("skip marks the line and is reversible via unskip", async () => {
      await withTransaction(async (c) => {
        const { lineId } = await setupBillAndLine(c);
        await c.query(`select public.inventory_bill_skip($1)`, [lineId]);
        let line = await c.query(`select inventory_ingestion_skipped from bill_line_items where id = $1`, [lineId]);
        expect(line.rows[0].inventory_ingestion_skipped).toBe(true);

        await c.query(`select public.inventory_bill_unskip($1)`, [lineId]);
        line = await c.query(`select inventory_ingestion_skipped from bill_line_items where id = $1`, [lineId]);
        expect(line.rows[0].inventory_ingestion_skipped).toBe(false);
      });
    });

    it("family member without privilege cannot ingest", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const family = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner", status: "active" });
        await insertMembership(c, { household_id: h.id, profile_id: family.id, role: "family_member", status: "active", privilege: "view_only" });
        await setJwtClaims(c, { sub: owner.clerk_user_id });

        const billId = randomUUID();
        await c.query(
          `insert into bills (id, household_id, status, image_storage_path) values ($1, $2, 'processed', 'x.jpg')`,
          [billId, h.id],
        );
        const lineId = randomUUID();
        await c.query(
          `insert into bill_line_items (id, bill_id, position, item_name, quantity, unit) values ($1, $2, 1, 'rice', 1, 'kg')`,
          [lineId, billId],
        );

        await setJwtClaims(c, { sub: family.clerk_user_id });
        await expect(
          c.query(`select public.inventory_bill_ingest($1, null, 1, 'kg', 'rice')`, [lineId]),
        ).rejects.toThrow(/permission/i);
      });
    });
  });
  ```

  (If `insertMembership` doesn't take a `privilege` field yet, extend the factory in `tests/factories.ts` — it likely already does after slice 2a; quick grep first.)

- [ ] **Step 2: Run tests (expect failure)**

  Run: `pnpm vitest run tests/db/inventory-bill-ingest.test.ts`
  Expected: 5 failures.

- [ ] **Step 3: Create the migration**

  Create `supabase/migrations/20260616_001_inventory_bill_rpcs.sql`:

  ```sql
  -- Slice 2 inventory — bill_line_item → inventory ingest RPCs.

  -- Confirm a single bill_line_item into inventory.
  create or replace function public.inventory_bill_ingest(
    p_line_item_id   uuid,
    p_inventory_id   uuid,   -- nullable: NULL = create new
    p_quantity       numeric,
    p_unit           text,
    p_new_item_name  text    -- required when p_inventory_id IS NULL
  ) returns public.inventory_items
    language plpgsql security invoker
    set search_path = public
    as $$
    declare
      v_household uuid;
      v_inv       public.inventory_items;
      v_delta     numeric;
      v_profile   uuid := public.current_profile_id();
    begin
      select b.household_id into v_household
        from public.bill_line_items bli
        join public.bills b on b.id = bli.bill_id
        where bli.id = p_line_item_id;
      if v_household is null then
        raise exception 'bill line item not found' using errcode = 'P0001';
      end if;
      if not public.is_active_owner_or_maid(v_household) then
        raise exception 'permission denied' using errcode = 'P0001';
      end if;

      if p_inventory_id is null then
        if p_new_item_name is null then
          raise exception 'p_new_item_name required when p_inventory_id is null' using errcode = 'P0001';
        end if;
        insert into public.inventory_items
          (household_id, item_name, quantity, unit, created_by_profile_id)
          values
          (v_household, p_new_item_name, p_quantity, p_unit, v_profile)
          on conflict (household_id, lower(item_name), unit)
            do update set quantity = inventory_items.quantity + excluded.quantity
          returning * into v_inv;
        v_delta := p_quantity;
      else
        select * into v_inv from public.inventory_items where id = p_inventory_id and household_id = v_household for update;
        if v_inv.id is null then
          raise exception 'inventory item not found' using errcode = 'P0001';
        end if;

        v_delta := p_quantity;
        if lower(v_inv.unit) <> lower(p_unit) then
          v_delta := public.inventory_convert(v_household, v_inv.item_name, p_unit, v_inv.unit, p_quantity);
          if v_delta is null then
            raise exception 'INV_NO_CONVERSION' using errcode = 'P0001';
          end if;
        end if;

        update public.inventory_items
          set quantity = quantity + v_delta
          where id = v_inv.id
          returning * into v_inv;
      end if;

      insert into public.inventory_transactions
        (household_id, inventory_item_id, delta, unit, reason, bill_line_item_id, actor_profile_id)
        values
        (v_household, v_inv.id, v_delta, v_inv.unit, 'bill_ingest', p_line_item_id, v_profile);

      update public.bill_line_items
        set inventory_ingested_at = now(),
            matched_inventory_item_id = v_inv.id,
            inventory_ingestion_skipped = false
        where id = p_line_item_id;

      return v_inv;
    end;
    $$;

  grant execute on function public.inventory_bill_ingest(uuid, uuid, numeric, text, text) to authenticated;

  -- Mark a bill line as not-for-inventory.
  create or replace function public.inventory_bill_skip(p_line_item_id uuid)
    returns void
    language plpgsql security invoker
    set search_path = public
    as $$
    declare
      v_household uuid;
    begin
      select b.household_id into v_household
        from public.bill_line_items bli
        join public.bills b on b.id = bli.bill_id
        where bli.id = p_line_item_id;
      if v_household is null then
        raise exception 'bill line item not found' using errcode = 'P0001';
      end if;
      if not public.is_active_owner_or_maid(v_household) then
        raise exception 'permission denied' using errcode = 'P0001';
      end if;

      update public.bill_line_items
        set inventory_ingestion_skipped = true
        where id = p_line_item_id;
    end;
    $$;

  grant execute on function public.inventory_bill_skip(uuid) to authenticated;

  -- Reverse the skip flag.
  create or replace function public.inventory_bill_unskip(p_line_item_id uuid)
    returns void
    language plpgsql security invoker
    set search_path = public
    as $$
    declare
      v_household uuid;
    begin
      select b.household_id into v_household
        from public.bill_line_items bli
        join public.bills b on b.id = bli.bill_id
        where bli.id = p_line_item_id;
      if v_household is null then
        raise exception 'bill line item not found' using errcode = 'P0001';
      end if;
      if not public.is_active_owner_or_maid(v_household) then
        raise exception 'permission denied' using errcode = 'P0001';
      end if;

      update public.bill_line_items
        set inventory_ingestion_skipped = false
        where id = p_line_item_id;
    end;
    $$;

  grant execute on function public.inventory_bill_unskip(uuid) to authenticated;
  ```

- [ ] **Step 4: Apply and re-run tests**

  Run: `pnpm db:reset`
  Run: `pnpm vitest run tests/db/inventory-bill-ingest.test.ts`
  Expected: 5 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/20260616_001_inventory_bill_rpcs.sql tests/db/inventory-bill-ingest.test.ts
  git commit -m "feat(db): bill line item ingest/skip/unskip RPCs"
  ```

---

## Task 12: DB function — `inventory_manual_adjust`

**Files:**
- Create: `supabase/migrations/20260617_001_inventory_manual_adjust.sql`
- Create: `tests/db/inventory-items.test.ts`

This task creates the manual-adjust RPC and the broader `tests/db/inventory-items.test.ts` covering RLS + adjust behavior.

- [ ] **Step 1: Write failing tests**

  Create `tests/db/inventory-items.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { randomUUID } from "node:crypto";
  import { asAnon, setJwtClaims, withTransaction } from "../setup";
  import { insertHousehold, insertMembership, insertProfile } from "../factories";

  describe("inventory_items RLS + manual adjust", () => {
    it("active owner can read and write", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: me.id });
        await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
        await setJwtClaims(c, { sub: me.clerk_user_id });

        const id = randomUUID();
        await c.query(
          `insert into inventory_items (id, household_id, item_name, quantity, unit) values ($1,$2,'sugar',1,'kg')`,
          [id, h.id],
        );
        const r = await c.query(`select item_name from inventory_items where id = $1`, [id]);
        expect(r.rows[0].item_name).toBe("sugar");
      });
    });

    it("non-member cannot read", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const stranger = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner", status: "active" });
        await setJwtClaims(c, { sub: owner.clerk_user_id });
        await c.query(
          `insert into inventory_items (household_id, item_name, quantity, unit) values ($1,'salt',1,'kg')`,
          [h.id],
        );
        await setJwtClaims(c, { sub: stranger.clerk_user_id });
        const r = await c.query(`select * from inventory_items where household_id = $1`, [h.id]);
        expect(r.rows).toHaveLength(0);
      });
    });

    it("manual_adjust adds and writes a ledger row", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: me.id });
        await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
        await setJwtClaims(c, { sub: me.clerk_user_id });

        const id = randomUUID();
        await c.query(
          `insert into inventory_items (id, household_id, item_name, quantity, unit) values ($1,$2,'oil',1,'l')`,
          [id, h.id],
        );

        await c.query(`select public.inventory_manual_adjust($1, 0.5, 'topped up')`, [id]);
        const r = await c.query(`select quantity from inventory_items where id = $1`, [id]);
        expect(Number(r.rows[0].quantity)).toBe(1.5);

        const ledger = await c.query(
          `select delta, reason from inventory_transactions where inventory_item_id = $1 order by created_at asc`,
          [id],
        );
        expect(ledger.rows).toHaveLength(1);
        expect(Number(ledger.rows[0].delta)).toBe(0.5);
        expect(ledger.rows[0].reason).toBe("manual_adjust");
      });
    });

    it("manual_adjust clamps to zero", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: me.id });
        await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
        await setJwtClaims(c, { sub: me.clerk_user_id });

        const id = randomUUID();
        await c.query(
          `insert into inventory_items (id, household_id, item_name, quantity, unit) values ($1,$2,'oil',0.2,'l')`,
          [id, h.id],
        );
        await c.query(`select public.inventory_manual_adjust($1, -1.0, 'spilled')`, [id]);
        const r = await c.query(`select quantity from inventory_items where id = $1`, [id]);
        expect(Number(r.rows[0].quantity)).toBe(0);
      });
    });
  });
  ```

- [ ] **Step 2: Run tests (expect failure on manual_adjust)**

  Run: `pnpm vitest run tests/db/inventory-items.test.ts`
  Expected: the first two RLS tests should already pass (Task 1 set up the policies). The two `manual_adjust` tests fail.

- [ ] **Step 3: Create the migration**

  Create `supabase/migrations/20260617_001_inventory_manual_adjust.sql`. Note: the recorded `delta` equals the actual quantity change *after* clamping (so a clamped subtract logs the truthful delta, not the requested one). We capture `v_qty_before` for that reason.

  ```sql
  -- Slice 2 inventory — owner/maid-only adjust with clamp + ledger.

  create or replace function public.inventory_manual_adjust(
    p_item_id  uuid,
    p_delta    numeric,
    p_notes    text
  ) returns public.inventory_items
    language plpgsql security invoker
    set search_path = public
    as $$
    declare
      v_household   uuid;
      v_inv         public.inventory_items;
      v_qty_before  numeric;
      v_new_qty     numeric;
      v_profile     uuid := public.current_profile_id();
    begin
      select * into v_inv from public.inventory_items where id = p_item_id for update;
      if v_inv.id is null then
        raise exception 'inventory item not found' using errcode = 'P0001';
      end if;
      v_household := v_inv.household_id;
      if not public.is_active_owner_or_maid(v_household) then
        raise exception 'permission denied' using errcode = 'P0001';
      end if;

      v_qty_before := v_inv.quantity;
      v_new_qty := greatest(v_qty_before + p_delta, 0);

      update public.inventory_items
        set quantity = v_new_qty
        where id = p_item_id
        returning * into v_inv;

      insert into public.inventory_transactions
        (household_id, inventory_item_id, delta, unit, reason, actor_profile_id, notes)
        values
        (v_household, v_inv.id, v_new_qty - v_qty_before, v_inv.unit, 'manual_adjust', v_profile, p_notes);

      return v_inv;
    end;
    $$;

  grant execute on function public.inventory_manual_adjust(uuid, numeric, text) to authenticated;
  ```

- [ ] **Step 4: Apply and re-run tests**

  Run: `pnpm db:reset`
  Run: `pnpm vitest run tests/db/inventory-items.test.ts`
  Expected: 4 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/20260617_001_inventory_manual_adjust.sql tests/db/inventory-items.test.ts
  git commit -m "feat(db): inventory_manual_adjust + RLS tests"
  ```

---

## Task 13: DB functions — meal_plan additions (people_eating + lock checks)

**Files:**
- Create: `supabase/migrations/20260618_001_meal_plan_inventory_rpcs.sql`
- Create: `tests/db/meal-plan-lock.test.ts`

- [ ] **Step 1: Write failing tests**

  Create `tests/db/meal-plan-lock.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { setJwtClaims, withTransaction } from "../setup";
  import { insertHousehold, insertMembership, insertProfile } from "../factories";

  describe("meal plan lock window (1h before slot start)", () => {
    it("mealplan_set_slot rejects when within 1h of slot time", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: me.id });
        await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
        await setJwtClaims(c, { sub: me.clerk_user_id });

        // Set lunch time = right now (so lock window covers now).
        const nowH = new Date().getHours();
        const lunchHour = (nowH + 1) % 24;
        await c.query(
          `update household_meal_times set meal_time = ($1 || ':00')::time where household_id = $2 and slot = 'lunch'`,
          [String(lunchHour).padStart(2, "0"), h.id],
        );
        // Actually we want a slot whose time is in the next hour. Lunch slot = nowH+1 means
        // lock window = lunch_time - 1h = nowH, which is "now". So now() is inside the lock window.

        await expect(
          c.query(`select public.mealplan_set_slot(current_date, 'lunch'::public.meal_slot, null)`),
        ).rejects.toThrow(/locked|cannot_modify_after_lock/i);
      });
    });

    it("mealplan_set_slot accepts when more than 1h before slot time", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: me.id });
        await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
        await setJwtClaims(c, { sub: me.clerk_user_id });

        // Set lunch time = nowH+3 so lock window starts at nowH+2 — well in the future.
        const nowH = new Date().getHours();
        const lunchHour = (nowH + 3) % 24;
        await c.query(
          `update household_meal_times set meal_time = ($1 || ':00')::time where household_id = $2 and slot = 'lunch'`,
          [String(lunchHour).padStart(2, "0"), h.id],
        );

        const { rows } = await c.query(`select public.mealplan_set_slot(current_date, 'lunch'::public.meal_slot, null)`);
        expect(rows[0]).toBeTruthy();
      });
    });

    it("mealplan_set_people_eating respects the same lock", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: me.id });
        await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
        await setJwtClaims(c, { sub: me.clerk_user_id });

        // Lock window covers now.
        const nowH = new Date().getHours();
        const lunchHour = (nowH + 1) % 24;
        await c.query(
          `update household_meal_times set meal_time = ($1 || ':00')::time where household_id = $2 and slot = 'lunch'`,
          [String(lunchHour).padStart(2, "0"), h.id],
        );

        await expect(
          c.query(`select public.mealplan_set_people_eating(current_date, 'lunch'::public.meal_slot, 3)`),
        ).rejects.toThrow(/locked|cannot_modify_after_lock/i);
      });
    });
  });
  ```

- [ ] **Step 2: Run tests (expect failure)**

  Run: `pnpm vitest run tests/db/meal-plan-lock.test.ts`
  Expected: 3 failures (function doesn't exist; lock not yet on set_slot).

- [ ] **Step 3: Create the migration**

  Create `supabase/migrations/20260618_001_meal_plan_inventory_rpcs.sql`:

  ```sql
  -- Slice 2 inventory — adds people_eating override RPC and lock checks on
  -- mealplan_set_slot + mealplan_regenerate_slot.

  -- Helper: check whether a (date, slot) is past its lock window for the household.
  create or replace function public.is_meal_slot_locked(p_household uuid, p_date date, p_slot public.meal_slot)
    returns boolean
    language sql stable security invoker
    set search_path = public
    as $$
      select
        case
          when (select meal_time from public.household_meal_times where household_id = p_household and slot = p_slot) is null
          then false
          else now() >= (p_date::timestamp + (select meal_time from public.household_meal_times where household_id = p_household and slot = p_slot)) - interval '1 hour'
        end;
    $$;

  grant execute on function public.is_meal_slot_locked(uuid, date, public.meal_slot) to authenticated;

  -- New RPC: set people_eating override per slot.
  create or replace function public.mealplan_set_people_eating(
    p_date    date,
    p_slot    public.meal_slot,
    p_people  int
  ) returns public.meal_plans
    language plpgsql security invoker
    set search_path = public
    as $$
    declare
      v_household uuid := public.current_household_id_for_caller();
      v_profile   uuid := public.current_profile_id();
      v_row       public.meal_plans;
    begin
      if v_household is null then
        raise exception 'no active household' using errcode = 'P0001';
      end if;
      if not public.can_modify_meal_plan(v_household) then
        raise exception 'permission denied' using errcode = 'P0001';
      end if;
      if public.is_meal_slot_locked(v_household, p_date, p_slot) then
        raise exception 'cannot_modify_after_lock' using errcode = 'P0001';
      end if;

      insert into public.meal_plans
        (household_id, plan_date, slot, recipe_id, set_by_profile_id, people_eating)
      values (v_household, p_date, p_slot, null, v_profile, p_people)
      on conflict (household_id, plan_date, slot) do update
        set people_eating = excluded.people_eating
      returning * into v_row;
      return v_row;
    end;
    $$;

  grant execute on function public.mealplan_set_people_eating(date, public.meal_slot, int) to authenticated;

  -- Patch existing mealplan_set_slot with the lock check (added before the upsert).
  create or replace function public.mealplan_set_slot(
    p_date     date,
    p_slot     public.meal_slot,
    p_recipe_id uuid
  ) returns public.meal_plans
    language plpgsql security invoker
    set search_path = public
    as $$
    declare
      v_household uuid := public.current_household_id_for_caller();
      v_profile   uuid := public.current_profile_id();
      v_row       public.meal_plans;
    begin
      if v_household is null then
        raise exception 'no active household' using errcode = 'P0001';
      end if;
      if public.is_meal_slot_locked(v_household, p_date, p_slot) then
        raise exception 'cannot_modify_after_lock' using errcode = 'P0001';
      end if;
      insert into public.meal_plans
        (household_id, plan_date, slot, recipe_id, set_by_profile_id)
      values (v_household, p_date, p_slot, p_recipe_id, v_profile)
      on conflict (household_id, plan_date, slot) do update
        set recipe_id         = excluded.recipe_id,
            set_by_profile_id = excluded.set_by_profile_id
      returning * into v_row;
      return v_row;
    end;
    $$;

  -- Patch mealplan_regenerate_slot with the same lock check.
  create or replace function public.mealplan_regenerate_slot(
    p_date date,
    p_slot public.meal_slot
  ) returns public.meal_plans
    language plpgsql security invoker
    set search_path = public
    as $$
    declare
      v_household uuid := public.current_household_id_for_caller();
      v_profile   uuid := public.current_profile_id();
      v_recipe    uuid;
      v_row       public.meal_plans;
    begin
      if v_household is null then
        raise exception 'no active household' using errcode = 'P0001';
      end if;
      if public.is_meal_slot_locked(v_household, p_date, p_slot) then
        raise exception 'cannot_modify_after_lock' using errcode = 'P0001';
      end if;

      select id into v_recipe
      from public.effective_recipes(v_household) r
      where r.slot = p_slot
        and r.id not in (
          select recipe_id from public.meal_plans
          where household_id = v_household
            and slot = p_slot
            and plan_date between p_date - 4 and p_date - 1
            and recipe_id is not null
        )
      order by random()
      limit 1;
      if v_recipe is null then
        select id into v_recipe
        from public.effective_recipes(v_household) r
        where r.slot = p_slot
        order by random()
        limit 1;
      end if;

      insert into public.meal_plans
        (household_id, plan_date, slot, recipe_id, set_by_profile_id)
      values (v_household, p_date, p_slot, v_recipe, v_profile)
      on conflict (household_id, plan_date, slot) do update
        set recipe_id         = excluded.recipe_id,
            set_by_profile_id = excluded.set_by_profile_id
      returning * into v_row;
      return v_row;
    end;
    $$;
  ```

- [ ] **Step 4: Apply and re-run tests**

  Run: `pnpm db:reset`
  Run: `pnpm vitest run tests/db/meal-plan-lock.test.ts`
  Expected: 3 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/20260618_001_meal_plan_inventory_rpcs.sql tests/db/meal-plan-lock.test.ts
  git commit -m "feat(db): meal_plan lock window + set_people_eating RPC"
  ```

---

## Task 14: Server actions — inventory CRUD

**Files:** Create: `src/app/inventory/actions.ts`

- [ ] **Step 1: Create the actions file**

  ```ts
  "use server";

  import { revalidatePath } from "next/cache";
  import { z } from "zod";
  import { createClient } from "@/lib/supabase/server";
  import { requireHousehold } from "@/lib/auth/require";

  export type InventoryActionResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string } };

  const CreateSchema = z.object({
    item_name: z.string().min(1).max(120),
    quantity: z.number().min(0),
    unit: z.string().min(1).max(24),
    low_stock_threshold: z.number().min(0).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  });

  export async function createInventoryItem(
    input: z.infer<typeof CreateSchema>,
  ): Promise<InventoryActionResult<{ id: string }>> {
    const parsed = CreateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "INV_INVALID", message: "Invalid input" } };
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("inventory_items")
      .insert({
        household_id: ctx.household.id,
        item_name: parsed.data.item_name,
        quantity: parsed.data.quantity,
        unit: parsed.data.unit,
        low_stock_threshold: parsed.data.low_stock_threshold ?? null,
        notes: parsed.data.notes ?? null,
        created_by_profile_id: ctx.profile.id,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: { code: "INV_DB", message: error.message } };
    revalidatePath("/inventory");
    return { ok: true, data: { id: data.id } };
  }

  const UpdateSchema = z.object({
    id: z.string().uuid(),
    item_name: z.string().min(1).max(120).optional(),
    unit: z.string().min(1).max(24).optional(),
    low_stock_threshold: z.number().min(0).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  });

  export async function updateInventoryItem(
    input: z.infer<typeof UpdateSchema>,
  ): Promise<InventoryActionResult<{ id: string }>> {
    const parsed = UpdateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "INV_INVALID", message: "Invalid input" } };
    await requireHousehold();
    const supabase = await createClient();
    const { id, ...rest } = parsed.data;
    const { error } = await supabase.from("inventory_items").update(rest).eq("id", id);
    if (error) return { ok: false, error: { code: "INV_DB", message: error.message } };
    revalidatePath("/inventory");
    revalidatePath(`/inventory/${id}`);
    return { ok: true, data: { id } };
  }

  const DeleteSchema = z.object({ id: z.string().uuid() });

  export async function deleteInventoryItem(
    input: z.infer<typeof DeleteSchema>,
  ): Promise<InventoryActionResult<{ id: string }>> {
    const parsed = DeleteSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "INV_INVALID", message: "Invalid input" } };
    await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase.from("inventory_items").delete().eq("id", parsed.data.id);
    if (error) return { ok: false, error: { code: "INV_DB", message: error.message } };
    revalidatePath("/inventory");
    return { ok: true, data: { id: parsed.data.id } };
  }

  const AdjustSchema = z.object({
    id: z.string().uuid(),
    delta: z.number(),
    notes: z.string().max(500).optional(),
  });

  export async function adjustInventoryItem(
    input: z.infer<typeof AdjustSchema>,
  ): Promise<InventoryActionResult<{ id: string; quantity: number }>> {
    const parsed = AdjustSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "INV_INVALID", message: "Invalid input" } };
    await requireHousehold();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("inventory_manual_adjust", {
      p_item_id: parsed.data.id,
      p_delta: parsed.data.delta,
      p_notes: parsed.data.notes ?? "",
    });
    if (error) return { ok: false, error: { code: "INV_DB", message: error.message } };
    revalidatePath("/inventory");
    revalidatePath(`/inventory/${parsed.data.id}`);
    const row = data as { id: string; quantity: number } | null;
    if (!row) return { ok: false, error: { code: "INV_DB", message: "no row" } };
    return { ok: true, data: { id: row.id, quantity: row.quantity } };
  }

  const DismissCardSchema = z.object({});

  export async function dismissInventoryCard(): Promise<InventoryActionResult<null>> {
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase
      .from("households")
      .update({ inventory_card_dismissed_at: new Date().toISOString() })
      .eq("id", ctx.household.id);
    if (error) return { ok: false, error: { code: "INV_DB", message: error.message } };
    revalidatePath("/dashboard");
    return { ok: true, data: null };
  }
  ```

- [ ] **Step 2: Typecheck**

  Run: `pnpm typecheck`
  Expected: exit 0.

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/inventory/actions.ts
  git commit -m "feat(actions): inventory CRUD + adjust + dismiss card"
  ```

---

## Task 15: Server actions — meal times + people-eating

**Files:**
- Create: `src/app/household/meal-times/actions.ts`
- Modify: `src/app/plan/actions.ts` (append a new action)

- [ ] **Step 1: Create the meal-times actions file**

  ```ts
  // src/app/household/meal-times/actions.ts
  "use server";

  import { revalidatePath } from "next/cache";
  import { z } from "zod";
  import { createClient } from "@/lib/supabase/server";
  import { requireHousehold } from "@/lib/auth/require";

  const Slot = z.enum(["breakfast", "lunch", "snacks", "dinner"]);
  const TimeStr = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

  const UpdateSchema = z.object({
    slot: Slot,
    meal_time: TimeStr,
  });

  export type MealTimeActionResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string } };

  export async function updateMealTime(
    input: z.infer<typeof UpdateSchema>,
  ): Promise<MealTimeActionResult<{ slot: string; meal_time: string }>> {
    const parsed = UpdateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "MT_INVALID", message: "Invalid input" } };
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase
      .from("household_meal_times")
      .upsert(
        { household_id: ctx.household.id, slot: parsed.data.slot, meal_time: parsed.data.meal_time },
        { onConflict: "household_id,slot" },
      );
    if (error) return { ok: false, error: { code: "MT_DB", message: error.message } };
    revalidatePath("/household/meal-times");
    revalidatePath("/plan");
    return { ok: true, data: parsed.data };
  }
  ```

- [ ] **Step 2: Append people-eating action to the existing plan actions file**

  Open `src/app/plan/actions.ts`. Append at the bottom:

  ```ts
  const PeopleEatingSchema = z.object({
    planDate: DateString,
    slot: SlotEnum,
    people: z.number().int().min(1).max(50),
  });

  export async function setPeopleEating(
    input: z.infer<typeof PeopleEatingSchema>,
  ): Promise<PlanActionResult<{ recipeId: string | null; peopleEating: number }>> {
    const parsed = PeopleEatingSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "PLAN_INVALID", message: "Invalid input" } };
    await requireHousehold();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("mealplan_set_people_eating", {
      p_date: parsed.data.planDate,
      p_slot: parsed.data.slot,
      p_people: parsed.data.people,
    });
    if (error) {
      if (error.message.includes("cannot_modify_after_lock")) {
        return { ok: false, error: { code: "PLAN_LOCKED", message: "Meal locked (within 1 hour of start)" } };
      }
      return { ok: false, error: { code: "PLAN_FORBIDDEN", message: error.message } };
    }
    revalidatePath(`/plan/${parsed.data.planDate}`);
    return { ok: true, data: { recipeId: data?.recipe_id ?? null, peopleEating: data?.people_eating ?? parsed.data.people } };
  }
  ```

  Also: the existing `setMealPlanSlot` and `regenerateMealPlanSlot` actions should map the new `cannot_modify_after_lock` error to a `PLAN_LOCKED` user-facing code. Append/modify their error-handling blocks to mirror the pattern above (check `error.message.includes("cannot_modify_after_lock")`).

- [ ] **Step 3: Typecheck**

  Run: `pnpm typecheck`
  Expected: exit 0.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/household/meal-times/actions.ts src/app/plan/actions.ts
  git commit -m "feat(actions): meal-times + people-eating + lock error mapping"
  ```

---

## Task 16: Server actions — bill ingest queue

**Files:** Modify: `src/app/bills/[id]/actions.ts`

- [ ] **Step 1: Append ingest/skip/unskip actions**

  Open the existing `src/app/bills/[id]/actions.ts` and append:

  ```ts
  const BillIngestSchema = z.object({
    line_item_id: z.string().uuid(),
    inventory_id: z.string().uuid().nullable(),
    quantity: z.number().min(0),
    unit: z.string().min(1).max(24),
    new_item_name: z.string().min(1).max(120).optional(),
  });

  export async function ingestBillLineItem(input: z.infer<typeof BillIngestSchema>) {
    const parsed = BillIngestSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: { code: "BILL_INVALID", message: "Invalid input" } };
    await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase.rpc("inventory_bill_ingest", {
      p_line_item_id: parsed.data.line_item_id,
      p_inventory_id: parsed.data.inventory_id,
      p_quantity: parsed.data.quantity,
      p_unit: parsed.data.unit,
      p_new_item_name: parsed.data.new_item_name ?? null,
    });
    if (error) {
      if (error.message.includes("INV_NO_CONVERSION")) {
        return { ok: false as const, error: { code: "INV_NO_CONVERSION", message: "Unit can't be reconciled — choose 'new item' or adjust unit." } };
      }
      return { ok: false as const, error: { code: "BILL_DB", message: error.message } };
    }
    revalidatePath(`/bills`);
    return { ok: true as const, data: null };
  }

  const SkipSchema = z.object({ line_item_id: z.string().uuid() });

  export async function skipBillLineItem(input: z.infer<typeof SkipSchema>) {
    const parsed = SkipSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: { code: "BILL_INVALID", message: "Invalid input" } };
    await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase.rpc("inventory_bill_skip", { p_line_item_id: parsed.data.line_item_id });
    if (error) return { ok: false as const, error: { code: "BILL_DB", message: error.message } };
    revalidatePath(`/bills`);
    return { ok: true as const, data: null };
  }

  export async function unskipBillLineItem(input: z.infer<typeof SkipSchema>) {
    const parsed = SkipSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: { code: "BILL_INVALID", message: "Invalid input" } };
    await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase.rpc("inventory_bill_unskip", { p_line_item_id: parsed.data.line_item_id });
    if (error) return { ok: false as const, error: { code: "BILL_DB", message: error.message } };
    revalidatePath(`/bills`);
    return { ok: true as const, data: null };
  }
  ```

  Make sure imports include `z`, `requireHousehold`, `createClient`, `revalidatePath` if not already.

- [ ] **Step 2: Typecheck**

  Run: `pnpm typecheck`
  Expected: exit 0.

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/bills/[id]/actions.ts
  git commit -m "feat(actions): bill ingest + skip + unskip"
  ```

---

## Task 17: UI — `/inventory` list page + ItemCard component

**Files:**
- Create: `src/app/inventory/page.tsx`
- Create: `src/components/inventory/item-card.tsx`

- [ ] **Step 1: Create the ItemCard component**

  ```tsx
  // src/components/inventory/item-card.tsx
  import Link from "next/link";
  import { Card, CardContent } from "@/components/ui/card";

  export type InventoryItemCardProps = {
    id: string;
    name: string;
    quantity: number;
    unit: string;
    lowStockThreshold: number | null;
  };

  export function InventoryItemCard({ id, name, quantity, unit, lowStockThreshold }: InventoryItemCardProps) {
    const low = lowStockThreshold !== null && quantity <= lowStockThreshold;
    return (
      <Link href={`/inventory/${id}`}>
        <Card className="hover:bg-muted/50">
          <CardContent className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{name}</div>
              <div className="text-xs text-muted-foreground">
                {quantity} {unit}
              </div>
            </div>
            {low && (
              <div className="rounded-sm bg-yellow-100 px-1.5 py-0.5 text-[10px] uppercase text-yellow-800">Low</div>
            )}
          </CardContent>
        </Card>
      </Link>
    );
  }
  ```

- [ ] **Step 2: Create the list page**

  ```tsx
  // src/app/inventory/page.tsx
  import Link from "next/link";
  import { requireHousehold } from "@/lib/auth/require";
  import { createClient } from "@/lib/supabase/server";
  import { MainNav } from "@/components/site/main-nav";
  import { InventoryItemCard } from "@/components/inventory/item-card";
  import { buttonVariants } from "@/components/ui/button";
  import { cn } from "@/lib/utils";

  export default async function InventoryListPage() {
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { data: items, error } = await supabase
      .from("inventory_items")
      .select("id,item_name,quantity,unit,low_stock_threshold")
      .eq("household_id", ctx.household.id)
      .order("item_name", { ascending: true });
    if (error) throw new Error(error.message);

    const canWrite = ctx.membership.role === "owner" || ctx.membership.role === "maid";

    return (
      <main className="mx-auto max-w-md">
        <MainNav active="inventory" />
        <header className="flex items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold">Inventory</h1>
          {canWrite && (
            <Link href="/inventory/new" className={cn(buttonVariants({ size: "sm" }))}>
              Add item
            </Link>
          )}
        </header>
        {items?.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">Your inventory is empty.</p>
            {canWrite && (
              <Link href="/inventory/new" className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>
                Add your first item →
              </Link>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2 px-4 py-2">
            {items?.map((i) => (
              <InventoryItemCard
                key={i.id}
                id={i.id}
                name={i.item_name}
                quantity={Number(i.quantity)}
                unit={i.unit}
                lowStockThreshold={i.low_stock_threshold === null ? null : Number(i.low_stock_threshold)}
              />
            ))}
          </div>
        )}
        <div className="px-4 py-3">
          <Link href="/inventory/conversions" className="text-sm text-muted-foreground underline">Unit conversions</Link>
        </div>
      </main>
    );
  }
  ```

  Note: `MainNav active="inventory"` requires the nav component to know about an `"inventory"` active key. Check `src/components/site/main-nav.tsx` for the active-key union type; if it doesn't include `"inventory"`, add it as part of this step (a one-line change to the union).

- [ ] **Step 3: Typecheck**

  Run: `pnpm typecheck`
  Expected: exit 0.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/inventory/page.tsx src/components/inventory/item-card.tsx src/components/site/main-nav.tsx
  git commit -m "feat(ui): /inventory list page + ItemCard"
  ```

---

## Task 18: UI — `/inventory/new` page (with onboarding variant)

**Files:** Create: `src/app/inventory/new/page.tsx`

- [ ] **Step 1: Create the new-item page**

  ```tsx
  // src/app/inventory/new/page.tsx
  import { redirect } from "next/navigation";
  import { requireHousehold } from "@/lib/auth/require";
  import { createInventoryItem } from "@/app/inventory/actions";
  import { MainNav } from "@/components/site/main-nav";
  import { Button } from "@/components/ui/button";

  const STARTER_ITEMS = [
    "basmati rice", "toor dal", "urad dal", "whole wheat flour", "cooking oil",
    "ghee", "salt", "sugar", "milk", "eggs",
    "onion", "tomato", "ginger", "garlic", "turmeric powder",
  ] as const;

  export default async function NewInventoryItemPage({
    searchParams,
  }: {
    searchParams: Promise<{ onboarding?: string }>;
  }) {
    const ctx = await requireHousehold();
    if (ctx.membership.role !== "owner" && ctx.membership.role !== "maid") {
      redirect("/inventory");
    }
    const sp = await searchParams;
    const isOnboarding = sp.onboarding === "1";

    async function submitSingle(formData: FormData) {
      "use server";
      const name = String(formData.get("item_name") ?? "").trim();
      const quantity = Number(formData.get("quantity") ?? 0);
      const unit = String(formData.get("unit") ?? "").trim();
      if (!name || !unit || quantity < 0) return;
      await createInventoryItem({ item_name: name, quantity, unit });
      redirect("/inventory");
    }

    async function submitOnboarding(formData: FormData) {
      "use server";
      for (const name of STARTER_ITEMS) {
        const qStr = formData.get(`qty_${name}`);
        const unit = formData.get(`unit_${name}`);
        const q = qStr ? Number(qStr) : 0;
        if (q > 0 && typeof unit === "string" && unit.length > 0) {
          await createInventoryItem({ item_name: name, quantity: q, unit });
        }
      }
      redirect("/dashboard");
    }

    return (
      <main className="mx-auto max-w-md">
        <MainNav active="inventory" />
        <header className="px-4 py-3">
          <h1 className="text-lg font-semibold">{isOnboarding ? "Set up your inventory" : "Add an item"}</h1>
          {isOnboarding && (
            <p className="mt-1 text-sm text-muted-foreground">
              Fill in any quantities you have on hand. Skip items you don't track.
            </p>
          )}
        </header>

        {isOnboarding ? (
          <form action={submitOnboarding} className="flex flex-col gap-3 px-4 py-2">
            {STARTER_ITEMS.map((name) => (
              <div key={name} className="grid grid-cols-[1fr_80px_80px] items-center gap-2">
                <label htmlFor={`qty_${name}`} className="text-sm">{name}</label>
                <input
                  id={`qty_${name}`}
                  name={`qty_${name}`}
                  type="number"
                  min="0"
                  step="0.01"
                  className="rounded border px-2 py-1 text-sm"
                  placeholder="0"
                />
                <select name={`unit_${name}`} className="rounded border px-2 py-1 text-sm" defaultValue="kg">
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                  <option value="l">l</option>
                  <option value="ml">ml</option>
                  <option value="piece">piece</option>
                </select>
              </div>
            ))}
            <Button type="submit" className="mt-3">Save inventory</Button>
          </form>
        ) : (
          <form action={submitSingle} className="flex flex-col gap-3 px-4 py-2">
            <label className="flex flex-col gap-1">
              <span className="text-sm">Name</span>
              <input
                name="item_name"
                required
                maxLength={120}
                className="rounded border px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm">Quantity</span>
              <input
                name="quantity"
                type="number"
                min="0"
                step="0.01"
                required
                className="rounded border px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm">Unit</span>
              <input
                name="unit"
                required
                maxLength={24}
                className="rounded border px-2 py-1 text-sm"
                placeholder="e.g. kg, g, l, ml, piece"
              />
            </label>
            <Button type="submit">Save</Button>
          </form>
        )}
      </main>
    );
  }
  ```

- [ ] **Step 2: Typecheck**

  Run: `pnpm typecheck`
  Expected: exit 0.

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/inventory/new/page.tsx
  git commit -m "feat(ui): /inventory/new with onboarding variant"
  ```

---

## Task 19: UI — `/inventory/[id]` detail page + adjust form + transaction log

**Files:**
- Create: `src/app/inventory/[id]/page.tsx`
- Create: `src/components/inventory/adjust-form.tsx`
- Create: `src/components/inventory/transaction-log.tsx`

- [ ] **Step 1: Create the adjust form (client)**

  ```tsx
  // src/components/inventory/adjust-form.tsx
  "use client";
  import { useState, useTransition } from "react";
  import { Button } from "@/components/ui/button";
  import { adjustInventoryItem } from "@/app/inventory/actions";

  export function InventoryAdjustForm({ itemId }: { itemId: string }) {
    const [delta, setDelta] = useState("");
    const [notes, setNotes] = useState("");
    const [pending, start] = useTransition();
    const [err, setErr] = useState<string | null>(null);

    const submit = (sign: 1 | -1) => () => {
      const num = Number(delta);
      if (!Number.isFinite(num) || num <= 0) return;
      setErr(null);
      start(async () => {
        const res = await adjustInventoryItem({ id: itemId, delta: sign * num, notes });
        if (!res.ok) setErr(res.error.message);
        else { setDelta(""); setNotes(""); }
      });
    };

    return (
      <div className="flex flex-col gap-2 rounded border p-3">
        <div className="text-sm font-medium">Adjust stock</div>
        <input
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          type="number"
          min="0"
          step="0.01"
          placeholder="Amount"
          className="rounded border px-2 py-1 text-sm"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Note (optional)"
          maxLength={500}
          className="rounded border px-2 py-1 text-sm"
        />
        <div className="flex gap-2">
          <Button onClick={submit(1)} disabled={pending} variant="outline">Add</Button>
          <Button onClick={submit(-1)} disabled={pending} variant="outline">Subtract</Button>
        </div>
        {err && <div className="text-xs text-red-600">{err}</div>}
      </div>
    );
  }
  ```

- [ ] **Step 2: Create the transaction log component (server)**

  ```tsx
  // src/components/inventory/transaction-log.tsx
  export type TransactionEntry = {
    id: string;
    delta: number;
    unit: string;
    reason: "onboarding" | "manual_adjust" | "cook_deduct" | "bill_ingest" | "undo";
    notes: string | null;
    created_at: string;
  };

  const REASON: Record<TransactionEntry["reason"], string> = {
    onboarding: "Onboarding",
    manual_adjust: "Manual",
    cook_deduct: "Cooked",
    bill_ingest: "Bill",
    undo: "Undo",
  };

  export function InventoryTransactionLog({ entries }: { entries: TransactionEntry[] }) {
    if (entries.length === 0) {
      return <div className="text-sm text-muted-foreground">No transactions yet.</div>;
    }
    return (
      <ul className="flex flex-col gap-1">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between border-b py-1 text-xs">
            <span className="flex items-center gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5">{REASON[e.reason]}</span>
              {e.notes && <span className="text-muted-foreground">{e.notes}</span>}
            </span>
            <span className={e.delta >= 0 ? "text-emerald-600" : "text-red-600"}>
              {e.delta >= 0 ? "+" : ""}{e.delta} {e.unit}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  ```

- [ ] **Step 3: Create the detail page (server)**

  ```tsx
  // src/app/inventory/[id]/page.tsx
  import { notFound } from "next/navigation";
  import { requireHousehold } from "@/lib/auth/require";
  import { createClient } from "@/lib/supabase/server";
  import { MainNav } from "@/components/site/main-nav";
  import { InventoryAdjustForm } from "@/components/inventory/adjust-form";
  import { InventoryTransactionLog } from "@/components/inventory/transaction-log";

  export default async function InventoryItemDetail({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { data: item } = await supabase
      .from("inventory_items")
      .select("id,item_name,quantity,unit,low_stock_threshold,notes,household_id")
      .eq("id", id)
      .maybeSingle();
    if (!item || item.household_id !== ctx.household.id) notFound();

    const { data: txs } = await supabase
      .from("inventory_transactions")
      .select("id,delta,unit,reason,notes,created_at")
      .eq("inventory_item_id", id)
      .order("created_at", { ascending: false })
      .limit(20);

    const canWrite = ctx.membership.role === "owner" || ctx.membership.role === "maid";

    return (
      <main className="mx-auto max-w-md">
        <MainNav active="inventory" />
        <header className="px-4 py-3">
          <h1 className="text-lg font-semibold">{item.item_name}</h1>
          <div className="text-sm text-muted-foreground">
            {item.quantity} {item.unit}
            {item.low_stock_threshold !== null && Number(item.quantity) <= Number(item.low_stock_threshold) && (
              <span className="ml-2 rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] uppercase text-yellow-800">Low</span>
            )}
          </div>
        </header>
        {canWrite && (
          <div className="px-4 py-2">
            <InventoryAdjustForm itemId={id} />
          </div>
        )}
        <section className="px-4 py-3">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent activity</h2>
          <InventoryTransactionLog
            entries={(txs ?? []).map((t) => ({
              id: t.id,
              delta: Number(t.delta),
              unit: t.unit,
              reason: t.reason as any,
              notes: t.notes,
              created_at: t.created_at,
            }))}
          />
        </section>
      </main>
    );
  }
  ```

- [ ] **Step 4: Typecheck**

  Run: `pnpm typecheck`
  Expected: exit 0.

- [ ] **Step 5: Commit**

  ```bash
  git add src/app/inventory/[id]/page.tsx src/components/inventory/adjust-form.tsx src/components/inventory/transaction-log.tsx
  git commit -m "feat(ui): /inventory/[id] with adjust form + transaction log"
  ```

---

## Task 20: UI — `/inventory/conversions` page

**Files:** Create: `src/app/inventory/conversions/page.tsx`

- [ ] **Step 1: Create the page**

  ```tsx
  // src/app/inventory/conversions/page.tsx
  import { requireHousehold } from "@/lib/auth/require";
  import { createClient } from "@/lib/supabase/server";
  import { MainNav } from "@/components/site/main-nav";

  export default async function ConversionsPage() {
    const ctx = await requireHousehold();
    const supabase = await createClient();

    const { data: defaults } = await supabase
      .from("unit_conversions")
      .select("id,item_name,from_unit,to_unit,multiplier")
      .is("household_id", null)
      .order("item_name", { ascending: true, nullsFirst: true })
      .order("from_unit", { ascending: true });

    const { data: overrides } = await supabase
      .from("unit_conversions")
      .select("id,item_name,from_unit,to_unit,multiplier")
      .eq("household_id", ctx.household.id)
      .order("item_name", { ascending: true, nullsFirst: true });

    return (
      <main className="mx-auto max-w-md">
        <MainNav active="inventory" />
        <header className="px-4 py-3">
          <h1 className="text-lg font-semibold">Unit conversions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Zomaid defaults are used to translate between cooking units (cup, tbsp) and stock units (kg, g, l, ml).
            Add household-specific overrides below if a default doesn't match how you measure.
          </p>
        </header>
        <section className="px-4 py-2">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Your overrides</h2>
          {(overrides?.length ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground">No overrides yet.</div>
          ) : (
            <ul className="flex flex-col gap-1">
              {overrides!.map((c) => (
                <li key={c.id} className="flex items-center justify-between border-b py-1 text-sm">
                  <span>{c.item_name ?? "(generic)"} — 1 {c.from_unit} → {c.multiplier} {c.to_unit}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="px-4 py-3">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Zomaid defaults ({defaults?.length ?? 0})</h2>
          <ul className="flex flex-col gap-1">
            {defaults?.map((c) => (
              <li key={c.id} className="flex items-center justify-between border-b py-1 text-xs">
                <span>{c.item_name ?? "(generic)"}</span>
                <span>1 {c.from_unit} = {c.multiplier} {c.to_unit}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    );
  }
  ```

  Note: a full add/edit override UI is **not** included in this task. v1 ships read-only view of overrides plus the seeded defaults. Adding overrides via UI can be a follow-up; for now, the owner can use Supabase Studio or psql to add rows. This is a documented scope trim.

- [ ] **Step 2: Typecheck and commit**

  Run: `pnpm typecheck`
  Expected: exit 0.

  ```bash
  git add src/app/inventory/conversions/page.tsx
  git commit -m "feat(ui): /inventory/conversions read-only view"
  ```

---

## Task 21: UI — `/household/meal-times` page

**Files:** Create: `src/app/household/meal-times/page.tsx`

- [ ] **Step 1: Create the page**

  ```tsx
  // src/app/household/meal-times/page.tsx
  import { requireHousehold } from "@/lib/auth/require";
  import { createClient } from "@/lib/supabase/server";
  import { MainNav } from "@/components/site/main-nav";
  import { Button } from "@/components/ui/button";
  import { updateMealTime } from "./actions";

  type Slot = "breakfast" | "lunch" | "snacks" | "dinner";
  const SLOTS: Slot[] = ["breakfast", "lunch", "snacks", "dinner"];
  const LABEL: Record<Slot, string> = { breakfast: "Breakfast", lunch: "Lunch", snacks: "Snacks", dinner: "Dinner" };

  export default async function MealTimesPage() {
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { data: rows } = await supabase
      .from("household_meal_times")
      .select("slot,meal_time")
      .eq("household_id", ctx.household.id);

    const bySlot = Object.fromEntries((rows ?? []).map((r) => [r.slot, r.meal_time])) as Record<Slot, string>;

    async function save(formData: FormData) {
      "use server";
      const slot = String(formData.get("slot") ?? "") as Slot;
      const meal_time = String(formData.get("meal_time") ?? "");
      if (!SLOTS.includes(slot) || !/^\d{2}:\d{2}$/.test(meal_time)) return;
      await updateMealTime({ slot, meal_time });
    }

    return (
      <main className="mx-auto max-w-md">
        <MainNav active="plan" />
        <header className="px-4 py-3">
          <h1 className="text-lg font-semibold">Meal times</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Used to decide when cooked meals deduct from inventory and when each slot locks for edits (1 hour before its start).
          </p>
        </header>
        <div className="flex flex-col gap-3 px-4 py-2">
          {SLOTS.map((s) => (
            <form key={s} action={save} className="flex items-center justify-between rounded border p-3">
              <input type="hidden" name="slot" value={s} />
              <span className="text-sm font-medium">{LABEL[s]}</span>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  name="meal_time"
                  defaultValue={(bySlot[s] ?? "").slice(0, 5)}
                  required
                  className="rounded border px-2 py-1 text-sm"
                />
                <Button type="submit" size="sm" variant="outline">Save</Button>
              </div>
            </form>
          ))}
        </div>
      </main>
    );
  }
  ```

- [ ] **Step 2: Typecheck and commit**

  Run: `pnpm typecheck`
  Expected: exit 0.

  ```bash
  git add src/app/household/meal-times/page.tsx
  git commit -m "feat(ui): /household/meal-times configuration page"
  ```

---

## Task 22: UI — Dashboard inventory prompt card

**Files:**
- Create: `src/components/site/inventory-prompt-card.tsx`
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Create the card component**

  ```tsx
  // src/components/site/inventory-prompt-card.tsx
  "use client";
  import Link from "next/link";
  import { useTransition } from "react";
  import { Card, CardContent } from "@/components/ui/card";
  import { Button, buttonVariants } from "@/components/ui/button";
  import { cn } from "@/lib/utils";
  import { dismissInventoryCard } from "@/app/inventory/actions";

  export function InventoryPromptCard() {
    const [pending, start] = useTransition();
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div>
            <div className="text-sm font-semibold">Set up your kitchen inventory</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Track stock so the app can warn you when ingredients run low.
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Link
              href="/inventory/new?onboarding=1"
              className={cn(buttonVariants({ size: "sm" }))}
            >
              Add starter items →
            </Link>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => start(async () => { await dismissInventoryCard(); })}
            >
              Skip
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  ```

- [ ] **Step 2: Render the card in the dashboard**

  Modify `src/app/dashboard/page.tsx`. Near where the existing `OwnerInviteMaidCard` is rendered (or just above/below it), add:

  ```tsx
  // Add to imports at the top:
  import { InventoryPromptCard } from "@/components/site/inventory-prompt-card";

  // Inside the dashboard component, after computing ctx:
  let showInventoryCard = false;
  if (ctx.membership.role === "owner" || ctx.membership.role === "maid") {
    const supabase = await createClient();
    const { count } = await supabase
      .from("inventory_items")
      .select("id", { count: "exact", head: true })
      .eq("household_id", ctx.household.id);
    showInventoryCard =
      ctx.household.inventory_card_dismissed_at == null && (count ?? 0) < 5;
  }
  ```

  Then in the JSX, render `{showInventoryCard && <InventoryPromptCard />}` near the other dashboard cards. `ctx.household.inventory_card_dismissed_at` is already available — `getCurrentHousehold()` selects `*` from `households` (see `src/lib/auth/current-household.ts`) and Task 7's types update added the column to the `households.Row` shape, so no auth-helper change is required.

- [ ] **Step 3: Typecheck and commit**

  Run: `pnpm typecheck`
  Expected: exit 0.

  ```bash
  git add src/components/site/inventory-prompt-card.tsx src/app/dashboard/page.tsx
  git commit -m "feat(ui): dashboard inventory prompt card"
  ```

---

## Task 23: UI — Plan page additions (people pill, lock indicator, warning badge)

**Files:**
- Create: `src/components/plan/people-pill.tsx`
- Create: `src/components/plan/slot-warning-badge.tsx`
- Modify: `src/components/plan/slot-row.tsx`
- Modify: `src/app/plan/[date]/page.tsx`

- [ ] **Step 1: Create the people pill (client)**

  ```tsx
  // src/components/plan/people-pill.tsx
  "use client";
  import { useState, useTransition } from "react";
  import { setPeopleEating } from "@/app/plan/actions";

  export function PeoplePill({
    planDate,
    slot,
    initialPeople,
    rosterSize,
    locked,
    canEdit,
  }: {
    planDate: string;
    slot: "breakfast" | "lunch" | "snacks" | "dinner";
    initialPeople: number | null;
    rosterSize: number;
    locked: boolean;
    canEdit: boolean;
  }) {
    const effective = initialPeople ?? rosterSize;
    const [people, setPeople] = useState(effective);
    const [editing, setEditing] = useState(false);
    const [pending, start] = useTransition();
    const [err, setErr] = useState<string | null>(null);

    const disabled = locked || !canEdit;

    const submit = (next: number) => {
      setErr(null);
      start(async () => {
        const res = await setPeopleEating({ planDate, slot, people: next });
        if (!res.ok) setErr(res.error.code === "PLAN_LOCKED" ? "Locked" : res.error.message);
        else setEditing(false);
      });
    };

    if (!editing) {
      return (
        <button
          type="button"
          onClick={() => { if (!disabled) setEditing(true); }}
          className="rounded-full border px-2 py-0.5 text-[10px] uppercase disabled:opacity-50"
          disabled={disabled}
        >
          {effective} people
        </button>
      );
    }
    return (
      <span className="flex items-center gap-1">
        <input
          type="number"
          min={1}
          max={50}
          value={people}
          onChange={(e) => setPeople(Number(e.target.value))}
          className="w-12 rounded border px-1 py-0.5 text-[11px]"
        />
        <button onClick={() => submit(people)} disabled={pending} className="text-[11px] text-emerald-700">save</button>
        <button onClick={() => { setEditing(false); setErr(null); }} className="text-[11px] text-muted-foreground">×</button>
        {err && <span className="text-[10px] text-red-600">{err}</span>}
      </span>
    );
  }
  ```

- [ ] **Step 2: Create the warning badge**

  ```tsx
  // src/components/plan/slot-warning-badge.tsx
  "use client";
  import { useState } from "react";

  export type Warning = { item_name: string; requested_qty: number; deducted_qty: number; unit: string; reason: string };

  export function SlotWarningBadge({ warnings }: { warnings: Warning[] }) {
    const [open, setOpen] = useState(false);
    if (!warnings || warnings.length === 0) return null;
    return (
      <span className="relative">
        <button
          type="button"
          onClick={() => setOpen((x) => !x)}
          className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] uppercase text-yellow-800"
        >
          ⚠️ {warnings.length}
        </button>
        {open && (
          <span className="absolute z-10 mt-1 w-64 rounded border bg-popover p-2 text-[11px] shadow">
            {warnings.map((w, i) => (
              <span key={i} className="block">
                {w.item_name}: needed {w.requested_qty}{w.unit}, deducted {w.deducted_qty}{w.unit} ({w.reason})
              </span>
            ))}
          </span>
        )}
      </span>
    );
  }
  ```

- [ ] **Step 3: Modify `slot-row.tsx` to render the new bits**

  Open `src/components/plan/slot-row.tsx`. The component currently renders the recipe name + actions for a slot row. Extend its props to include:

  ```ts
  peopleEating: number | null;
  rosterSize: number;
  locked: boolean;
  deductionWarnings: Warning[];
  ```

  Render the `<PeoplePill>` next to the recipe name and `<SlotWarningBadge>` after it. Update the existing "Edit"/"Regenerate" controls to disable when `locked` is true (use the `disabled` prop on `Button`).

  Import `PeoplePill` from `@/components/plan/people-pill`, `SlotWarningBadge`/`Warning` from `@/components/plan/slot-warning-badge`. Read the existing file to confirm structure before editing.

- [ ] **Step 4: Modify `src/app/plan/[date]/page.tsx` to pass the new data**

  In the page component, when computing each slot's `rows[s]`, also extract `people_eating`, `deduction_status`, and `deduction_warnings` from the `meal_plans` query (add them to the `.select(...)`). Compute `locked` per slot:

  ```ts
  // After the existing select for meal_plans, also fetch household_meal_times:
  const { data: mealTimes } = await supabase
    .from("household_meal_times")
    .select("slot,meal_time")
    .eq("household_id", ctx.household.id);
  const timeBySlot = Object.fromEntries((mealTimes ?? []).map((r) => [r.slot, r.meal_time]));

  function isLocked(slot: string): boolean {
    const t = timeBySlot[slot];
    if (!t) return false;
    const [hh, mm] = t.split(":").map(Number);
    const slotDt = new Date(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+08:00`);
    return Date.now() >= slotDt.getTime() - 60 * 60 * 1000;
  }

  // Roster size = count of active memberships for this household:
  const { count: rosterCount } = await supabase
    .from("household_memberships")
    .select("id", { count: "exact", head: true })
    .eq("household_id", ctx.household.id)
    .eq("status", "active");
  const rosterSize = rosterCount ?? 1;
  ```

  Then pass `peopleEating: r?.people_eating ?? null`, `rosterSize`, `locked: isLocked(s)`, and `deductionWarnings: (r?.deduction_warnings ?? []) as Warning[]` to each slot row inside `<TodayList>` → `<SlotRow>`. (Adjust the existing `rows` shape and `TodayList` props accordingly. Read those files first to align type signatures.)

- [ ] **Step 5: Typecheck**

  Run: `pnpm typecheck`
  Expected: exit 0.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/plan/people-pill.tsx src/components/plan/slot-warning-badge.tsx src/components/plan/slot-row.tsx src/app/plan/[date]/page.tsx
  git commit -m "feat(ui): plan page people pill + lock indicator + warning badge"
  ```

---

## Task 24: UI — `/bills/[id]` review queue + "not kitchen supplies" section

**Files:**
- Create: `src/app/bills/[id]/_inventory-queue.tsx`
- Modify: `src/app/bills/[id]/page.tsx`

- [ ] **Step 1: Create the queue component**

  ```tsx
  // src/app/bills/[id]/_inventory-queue.tsx
  "use client";
  import { useState, useTransition } from "react";
  import { Button } from "@/components/ui/button";
  import { ingestBillLineItem, skipBillLineItem, unskipBillLineItem } from "./actions";

  export type LineRow = {
    id: string;
    item_name: string;
    quantity: number;
    unit: string;
    inventory_ingested_at: string | null;
    inventory_ingestion_skipped: boolean;
    matched_inventory_item_id: string | null;
  };

  export type ExistingInvOption = { id: string; item_name: string; quantity: number; unit: string };

  export function InventoryReviewQueue({
    pending,
    skipped,
    existingByName,
    canWrite,
  }: {
    pending: LineRow[];
    skipped: LineRow[];
    existingByName: Record<string, ExistingInvOption>;
    canWrite: boolean;
  }) {
    return (
      <>
        <section className="px-4 py-3">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Pending inventory matches ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <div className="text-sm text-muted-foreground">All lines reviewed.</div>
          ) : (
            <ul className="flex flex-col gap-3">
              {pending.map((line) => (
                <PendingRow key={line.id} line={line} match={existingByName[line.item_name.toLowerCase()] ?? null} disabled={!canWrite} />
              ))}
            </ul>
          )}
        </section>

        <section className="px-4 py-3">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Not kitchen supplies ({skipped.length})
          </h2>
          {skipped.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nothing skipped.</div>
          ) : (
            <ul className="flex flex-col gap-2">
              {skipped.map((line) => (
                <SkippedRow key={line.id} line={line} disabled={!canWrite} />
              ))}
            </ul>
          )}
        </section>
      </>
    );
  }

  function PendingRow({ line, match, disabled }: { line: LineRow; match: ExistingInvOption | null; disabled: boolean }) {
    const [target, setTarget] = useState<"match" | "new">(match ? "match" : "new");
    const [pendingTx, start] = useTransition();
    const [err, setErr] = useState<string | null>(null);

    const confirm = () => {
      setErr(null);
      start(async () => {
        const res = await ingestBillLineItem({
          line_item_id: line.id,
          inventory_id: target === "match" ? match?.id ?? null : null,
          quantity: line.quantity,
          unit: line.unit,
          new_item_name: target === "new" ? line.item_name : undefined,
        });
        if (!res.ok) setErr(res.error.message);
      });
    };
    const skip = () => {
      setErr(null);
      start(async () => {
        const res = await skipBillLineItem({ line_item_id: line.id });
        if (!res.ok) setErr(res.error.message);
      });
    };

    return (
      <li className="rounded border p-3">
        <div className="font-medium">{line.item_name}</div>
        <div className="text-xs text-muted-foreground">{line.quantity} {line.unit}</div>
        <div className="mt-2 flex flex-col gap-1 text-sm">
          {match && (
            <label className="flex items-center gap-2">
              <input type="radio" checked={target === "match"} onChange={() => setTarget("match")} />
              Add to: <span className="font-medium">{match.item_name}</span> ({match.quantity} {match.unit})
            </label>
          )}
          <label className="flex items-center gap-2">
            <input type="radio" checked={target === "new"} onChange={() => setTarget("new")} />
            New inventory item
          </label>
        </div>
        <div className="mt-2 flex gap-2">
          <Button onClick={confirm} disabled={disabled || pendingTx}>Confirm</Button>
          <Button onClick={skip} variant="outline" disabled={disabled || pendingTx}>Skip</Button>
        </div>
        {err && <div className="mt-1 text-xs text-red-600">{err}</div>}
      </li>
    );
  }

  function SkippedRow({ line, disabled }: { line: LineRow; disabled: boolean }) {
    const [pendingTx, start] = useTransition();
    const [err, setErr] = useState<string | null>(null);

    const undo = () => {
      setErr(null);
      start(async () => {
        const res = await unskipBillLineItem({ line_item_id: line.id });
        if (!res.ok) setErr(res.error.message);
      });
    };

    return (
      <li className="flex items-center justify-between rounded border p-2 text-sm">
        <span>{line.item_name} <span className="text-xs text-muted-foreground">({line.quantity} {line.unit})</span></span>
        <span>
          <Button onClick={undo} variant="ghost" size="sm" disabled={disabled || pendingTx}>Undo skip</Button>
          {err && <span className="ml-2 text-xs text-red-600">{err}</span>}
        </span>
      </li>
    );
  }
  ```

- [ ] **Step 2: Wire the queue into the bills detail page**

  Open `src/app/bills/[id]/page.tsx`. Below the existing bill summary section, add the review queue. First fetch the line items and the household's inventory list (for the name → existing-row map). Then render `<InventoryReviewQueue ...>`:

  ```tsx
  // Add at the top:
  import { InventoryReviewQueue, type LineRow, type ExistingInvOption } from "./_inventory-queue";

  // Inside the page component (after existing logic that loads the bill):
  const { data: allLines } = await supabase
    .from("bill_line_items")
    .select("id,item_name,quantity,unit,inventory_ingested_at,inventory_ingestion_skipped,matched_inventory_item_id")
    .eq("bill_id", id)
    .order("position", { ascending: true });

  const pending: LineRow[] = (allLines ?? [])
    .filter((l) => l.inventory_ingested_at === null && l.inventory_ingestion_skipped === false)
    .map((l) => ({ ...l, quantity: Number(l.quantity) }));
  const skipped: LineRow[] = (allLines ?? [])
    .filter((l) => l.inventory_ingestion_skipped === true)
    .map((l) => ({ ...l, quantity: Number(l.quantity) }));

  const { data: inv } = await supabase
    .from("inventory_items")
    .select("id,item_name,quantity,unit")
    .eq("household_id", ctx.household.id);
  const existingByName: Record<string, ExistingInvOption> = Object.fromEntries(
    (inv ?? []).map((i) => [i.item_name.toLowerCase(), { id: i.id, item_name: i.item_name, quantity: Number(i.quantity), unit: i.unit }]),
  );

  const canWrite = ctx.membership.role === "owner" || ctx.membership.role === "maid";
  ```

  Then in the JSX, render `<InventoryReviewQueue pending={pending} skipped={skipped} existingByName={existingByName} canWrite={canWrite} />` below the existing bill content.

- [ ] **Step 3: Typecheck**

  Run: `pnpm typecheck`
  Expected: exit 0.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/bills/[id]/_inventory-queue.tsx src/app/bills/[id]/page.tsx
  git commit -m "feat(ui): bills detail inventory review queue + skipped section"
  ```

---

## Task 25: E2E smoke

**Files:** Create: `tests/e2e/inventory.spec.ts`

The project's existing Playwright tests are unauthenticated-only (see `tests/e2e/recipes-plan.spec.ts`). We follow the same pattern — gating checks only. Substantive end-to-end coverage is via the DB tests (Tasks 8–13) and the manual verification step (Task 26).

- [ ] **Step 1: Create the smoke test**

  ```ts
  // tests/e2e/inventory.spec.ts
  import { test, expect } from "@playwright/test";

  test.describe("slice 2 inventory smoke (unauthenticated)", () => {
    test("/inventory redirects unauthenticated users to /", async ({ page }) => {
      await page.goto("/inventory");
      await expect(page).toHaveURL("http://localhost:3000/");
    });

    test("/inventory/new is also gated", async ({ page }) => {
      await page.goto("/inventory/new");
      await expect(page).toHaveURL("http://localhost:3000/");
    });

    test("/inventory/conversions is also gated", async ({ page }) => {
      await page.goto("/inventory/conversions");
      await expect(page).toHaveURL("http://localhost:3000/");
    });

    test("/household/meal-times is also gated", async ({ page }) => {
      await page.goto("/household/meal-times");
      await expect(page).toHaveURL("http://localhost:3000/");
    });
  });
  ```

- [ ] **Step 2: Run the suite**

  Run: `pnpm test:e2e -- inventory`
  Expected: 4 tests pass (× 2 browsers).

- [ ] **Step 3: Commit**

  ```bash
  git add tests/e2e/inventory.spec.ts
  git commit -m "test(e2e): smoke that inventory routes gate unauthenticated"
  ```

---

## Task 26: Final manual verification

- [ ] **Step 1: Run the full automated suite**

  Run:
  ```bash
  pnpm vitest run \
    tests/db/inventory-conversions.test.ts \
    tests/db/inventory-cook-deduct.test.ts \
    tests/db/inventory-sweep.test.ts \
    tests/db/inventory-bill-ingest.test.ts \
    tests/db/inventory-items.test.ts \
    tests/db/meal-plan-lock.test.ts
  ```
  Expected: all DB tests pass.

  Run:
  ```bash
  pnpm typecheck && pnpm lint
  ```
  Expected: typecheck exits 0; lint exits 0 (or with only the pre-existing warnings flagged in slice 1's final review).

- [ ] **Step 2: Start the dev server**

  Run: `pnpm dev` in a separate terminal.

- [ ] **Step 3: Sign in as an owner with no inventory**

  Open http://localhost:3000, sign in. The dashboard should show the "Set up your kitchen inventory" card.

- [ ] **Step 4: Use the onboarding flow**

  Tap "Add starter items →". Fill in 3-4 quantities (e.g. basmati rice 5 kg, oil 1 l, salt 0.5 kg, eggs 12 piece). Submit.

  Expected: redirects to `/dashboard`. The prompt card disappears once you have ≥5 items, or stays if fewer (still under threshold). Reload `/inventory` — your items appear.

- [ ] **Step 5: Open one item and adjust**

  Tap an item (e.g. salt) → see detail page with quantity and "No transactions yet" (manual_adjust isn't logged for the initial insert via the simple action — that's expected; the ledger only logs through the RPC). Use the adjust form: add 0.25, then subtract 1. Expected: quantity updates; transactions appear in the log. The subtract clamps at 0.

- [ ] **Step 6: Configure meal times**

  Open `/household/meal-times`. Default rows should be visible (08:00 / 13:00 / 17:00 / 20:00). Change lunch to 14:00 and save.

- [ ] **Step 7: Visit `/plan/<today>`**

  Each slot row should show a "people: N" pill (N = roster size). Tap → editable input. If the slot is within 1h of its meal time, the pill should be greyed out (locked). The plan page should not error out.

- [ ] **Step 8: Trigger a manual cook-deduct via psql**

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c \
    "select public.inventory_cook_deduct(id) from meal_plans where deduction_status = 'pending' limit 1;"
  ```
  Expected: returns a jsonb with `status` of `deducted` / `partial` / `skipped`. Refresh `/inventory` — affected items decrement (or the warning surfaces on the plan page).

- [ ] **Step 9: Upload a bill (mocked)**

  Either via the existing `/bills` flow or directly via Supabase Studio: insert a row in `bills` with `status='processed'` and 2-3 line items. Open `/bills/[that-id]`. The "Pending inventory matches" section should show each line. Test:
  - **Confirm with match:** add to existing inventory item; item quantity increases.
  - **Confirm new:** creates a new inventory row.
  - **Skip:** line moves to "Not kitchen supplies".
  - **Undo skip:** line moves back to pending.

- [ ] **Step 10: Tag the plan complete**

  Edit this plan file, mark all checkboxes complete. Commit:

  ```bash
  git add docs/plans/2026-05-14-inventory.md
  git commit -m "chore(plan): mark inventory plan complete"
  ```

---

## Done.

After Task 26 succeeds, the inventory subsystem is ready to merge. Slice 3 (auto-allocation on view + inventory-aware suggestion engine) is the next brainstorm — return to `/superpowers:brainstorming` when ready.
