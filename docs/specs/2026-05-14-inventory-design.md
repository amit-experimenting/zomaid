# Zomaid — Kitchen Inventory — Design

> **Superseded as the living architecture doc for the meal-plan area by [`features/meal-plan.md`](features/meal-plan.md).** This dated spec is retained for historical context.
> **Superseded as the living architecture doc for the inventory area by [`features/inventory.md`](features/inventory.md).** This dated spec is retained for historical context.
> **Superseded as the living architecture doc for the bills area by [`features/bills.md`](features/bills.md).** This dated spec is retained for historical context.

- **Date**: 2026-05-14
- **Status**: Approved (brainstorming) — pending implementation plan
- **Slice**: 2 of 3 in the recipes-and-allocation overhaul. Also fills the long-deferred slice 3 of the original 7-slice foundations plan (the "Inventory" half of "Inventory + bill scanning"; the OCR half already shipped).
- **Owner**: dharni05@gmail.com
- **Depends on**:
  - [2026-05-14 Recipe Data Fill + YouTube + default_servings](./2026-05-14-recipe-data-fill-design.md) (slice 1) — supplies `recipes.default_servings` and ingredient quantities, both required for cook-deduct math.
  - [2026-05-11 Slice 3 Bill Scanning OCR](./2026-05-11-slice-3-bill-scanning-ocr-design.md) — supplies `bill_line_items` rows that this slice ingests.

## 1. Context

Today the app records meal plans, recipes, shopping lists, and OCR'd bills, but has no notion of what a household physically has in the kitchen. This slice introduces an inventory model that:

1. **Falls** automatically when a meal is cooked (1 hour before the next meal slot, or end-of-day for dinner).
2. **Rises** when a bill is OCR-processed, after the owner or maid confirms each line item is a real kitchen supply.
3. **Persists** all changes in a transaction ledger so the owner can audit every movement and undo mistakes.
4. **Reconciles units** between recipe-side cooking units ("2 cup rice") and inventory-side stock units ("5 kg rice") via a built-in conversion table that households can override.

This is also a hard dependency for slice 3 (auto-allocation on view), which will pick recipes whose ingredients are currently in stock.

## 2. Decomposition (this brainstorm cycle)

| # | Slice | Status |
|---|---|---|
| 1 | Recipe data fill + YouTube + default_servings | Done |
| 2 | Inventory: tables, onboarding card, cook-deduct, bill ingest, meal times, locks (this doc) | Designing |
| 3 | Auto-allocation on view, inventory-aware suggestion engine | Pending — separate brainstorm |

## 3. Decisions log (from brainstorming, 2026-05-14)

| Q | Decision |
|---|---|
| Cook-deduct trigger | **Automatic, time-based.** A pg_cron sweep every 15 minutes deducts ingredients for any meal whose lock window has passed. Lock window = 1 hour before the *next* slot's start time (so breakfast deducts ~1h before lunch). Dinner deducts at end of day (23:59 in `Asia/Singapore`). |
| People-eating count | **Static default with per-meal override.** Default = count of active household_memberships (`household_roster_size`). Per-meal override stored on `meal_plans.people_eating` and edited via a new RPC. Same permission + lock rules as recipe-slot changes. |
| Unit mismatch on deduction | **Built-in conversion table with household overrides.** Zomaid seeds ~50 entries (`unit_conversions` rows with `household_id IS NULL`). Households can add overrides (same fork-on-edit pattern as `recipes`). Lookup priority: household+item-specific → global+item-specific → household+generic → global+generic → skip + warn. |
| Bill OCR → inventory | **Review queue.** Owner or maid confirms each line item on `/bills/[id]`. Confirmed lines add to inventory (with conversion if needed). Skipped lines are preserved as "not kitchen supplies" on the same page — never deleted. |
| Out-of-stock on cook | **Clamp to zero + warn.** Deduct what's available, set quantity to 0, record a warning on the meal_plan row's `deduction_warnings` jsonb. Owner sees the warning on `/plan` and on the dashboard. Meal status becomes `partial`. |
| Onboarding entry | **Dismissible dashboard card.** Onboarding finishes normally. Dashboard shows a card with "Set up your kitchen inventory" until the household has ≥5 items or the owner dismisses. Tapping the card opens `/inventory/new?onboarding=1` with a prefilled list of staples (rice, oil, salt, sugar, dal, atta, etc.). |
| Meal-time configuration | **Per household, four columns in a new `household_meal_times` table.** Any active member can edit (owner + maid + family). Editing meal times is config, not a per-day action; no lock applies. Defaults: 08:00 / 13:00 / 17:00 / 20:00. |
| Lock window | **1 hour before the slot's meal time.** Once `now() >= meal_dt - interval '1 hour'`, the recipe and `people_eating` for that slot can no longer be changed. Permission errors return `cannot_modify_after_lock` hint. |
| Skipped bill line items | **Preserved on the same page, sectioned separately.** A "Not kitchen supplies" section on `/bills/[id]` lists every skipped line with an "Undo skip" button. Skipped lines persist for the life of the bill. |
| Audit ledger | **`inventory_transactions` table.** Every change to `inventory_items.quantity` writes a row. Enables undo, "why is this so low?" inspection, and future tests that assert deduction provenance. |
| Out of scope for slice 2 | Auto-allocation on view (slice 3); fridge / expiry (foundations slice 4); low-stock push notifications; spending analytics; multi-location inventory; fuzzy line-item matching. |

## 4. Schema

### 4.1 `inventory_items` (new)

```sql
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

create index inventory_items_household_idx on public.inventory_items (household_id);
```

- **Uniqueness:** `(household_id, lower(item_name), unit)`. "5 kg rice" and "200 g rice" are separate rows; deduction resolves them via the conversion table at runtime.
- **`quantity >= 0`** enforces the clamp-to-zero rule at the column level. The cook-deduct RPC tolerates the clamp and writes the warning.
- **`low_stock_threshold`** is set per item; UI shows a badge when `quantity <= threshold`. No notifications fire in v1.

### 4.2 `inventory_transactions` (new)

```sql
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
  on public.inventory_transactions (meal_plan_id) where meal_plan_id is not null;
create index inventory_transactions_bill_idx
  on public.inventory_transactions (bill_line_item_id) where bill_line_item_id is not null;
```

`delta` is signed: positive for add, negative for deduct. Every `inventory_items.quantity` update has a matching `inventory_transactions` row inserted in the same transaction (enforced by the writer RPCs; no DB trigger needed since all writes go through RPCs).

### 4.3 `household_meal_times` (new)

```sql
create table public.household_meal_times (
  household_id  uuid not null references public.households(id) on delete cascade,
  slot          public.meal_slot not null,
  meal_time     time not null,
  updated_at    timestamptz not null default now(),
  primary key (household_id, slot)
);
```

Defaults seeded on household creation via the same trigger that creates initial memberships:
- breakfast: 08:00
- lunch: 13:00
- snacks: 17:00
- dinner: 20:00

All times in `Asia/Singapore` (matches the existing DB tz convention).

### 4.4 `unit_conversions` (new)

```sql
create table public.unit_conversions (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid references public.households(id) on delete cascade,
  item_name             text,
  from_unit             text not null check (length(from_unit) between 1 and 24),
  to_unit               text not null check (length(to_unit) between 1 and 24),
  multiplier            numeric not null check (multiplier > 0),
  created_at            timestamptz not null default now()
);

create unique index unit_conversions_unique_idx
  on public.unit_conversions
  (coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(lower(item_name), ''),
   lower(from_unit),
   lower(to_unit));
```

Lookup priority at deduction time (most specific first):

1. `household_id = X AND lower(item_name) = lower(ingredient.item_name)`
2. `household_id IS NULL AND lower(item_name) = lower(ingredient.item_name)`
3. `household_id = X AND item_name IS NULL`
4. `household_id IS NULL AND item_name IS NULL`
5. No row found — skip + warn.

`(from_unit, to_unit)` matched case-insensitively.

### 4.5 `meal_plans` additions

```sql
create type public.meal_deduction_status as enum
  ('pending', 'deducted', 'skipped', 'partial');

alter table public.meal_plans
  add column people_eating       int check (people_eating is null or people_eating between 1 and 50),
  add column cooked_at           timestamptz,
  add column deduction_status    public.meal_deduction_status not null default 'pending',
  add column deduction_warnings  jsonb;
```

- `people_eating` NULL = use roster size at deduct time.
- `cooked_at` set by the cook-deduct RPC when status moves to `deducted` or `partial`.
- `deduction_status` lifecycle:
  - `pending` (default) → `deducted` (full success) | `partial` (some warnings) | `skipped` (recipe_id was null)
  - Re-runs return early on any non-`pending` state. The RPC is idempotent.
- `deduction_warnings` is a jsonb array of `{ item_name, requested_qty, deducted_qty, unit, reason }` where `reason` ∈ `not_in_stock | no_conversion | short`.

### 4.6 `bill_line_items` additions

```sql
alter table public.bill_line_items
  add column inventory_ingested_at        timestamptz,
  add column inventory_ingestion_skipped  boolean not null default false,
  add column matched_inventory_item_id    uuid references public.inventory_items(id) on delete set null;
```

State of each line item:
- **Pending:** `inventory_ingested_at IS NULL AND inventory_ingestion_skipped = false`
- **Ingested:** `inventory_ingested_at` set, `matched_inventory_item_id` set
- **Skipped:** `inventory_ingestion_skipped = true`

### 4.7 `households` addition

```sql
alter table public.households
  add column inventory_card_dismissed_at  timestamptz;
```

Used by the dashboard card to determine visibility. The card is shown when `inventory_card_dismissed_at IS NULL AND (count of inventory_items < 5)`.

## 5. Functions / RPCs

### 5.1 `household_roster_size(p_household uuid) returns int`

```sql
select count(*)::int from public.household_memberships
  where household_id = p_household and status = 'active'
```

Used by the deduction algorithm when `meal_plans.people_eating` is null.

### 5.2 `inventory_lookup(p_household uuid, p_item_name text, p_unit text) returns public.inventory_items`

Picks the inventory row matching by lowercased name. If multiple rows exist with different units, prefer the one whose unit matches the recipe ingredient (no conversion needed). Used by the deduction algorithm.

### 5.3 `inventory_convert(p_household uuid, p_item_name text, p_from text, p_to text, p_qty numeric) returns numeric`

Walks the priority list (Section 4.4). Returns the converted quantity or NULL if no conversion is possible.

### 5.4 `inventory_cook_deduct(p_meal_plan_id uuid) returns jsonb`

The core RPC. See Section 3.1 of the brainstorm for the algorithm. Returns `{ status, warnings }` jsonb.

- **Security:** `security definer` so the cron (running as postgres) can invoke; also callable directly by the meal_plans household via `is_active_owner_or_maid` for manual re-trigger / undo flows.
- **Idempotent:** Returns early when `deduction_status != 'pending'`.

### 5.5 `inventory_sweep_due_meals() returns int`

Loops over `meal_plans` rows where `deduction_status = 'pending' AND plan_date BETWEEN current_date - 2 AND current_date`. For each, computes the lock window and calls `inventory_cook_deduct` when overdue. Returns the count processed.

Scheduled via pg_cron:
```sql
select cron.schedule('inventory-sweep', '*/15 * * * *',
  $$select public.inventory_sweep_due_meals();$$);
```

### 5.6 `inventory_bill_ingest(p_line_item_id uuid, p_inventory_id uuid, p_quantity numeric, p_unit text, p_new_item_name text) returns public.inventory_items`

Confirms a single bill line item into inventory. See Section 4.3 of the brainstorm for behavior.

- If `p_inventory_id IS NULL`: creates a new inventory row (`p_new_item_name` required).
- Else: converts `p_quantity p_unit` into the matched row's unit; rejects with `INV_NO_CONVERSION` if no conversion exists.
- Always inserts an `inventory_transactions` row (`reason = 'bill_ingest'`).
- Sets `bill_line_items.inventory_ingested_at = now()`, `matched_inventory_item_id`.

### 5.7 `inventory_bill_skip(p_line_item_id uuid) returns void`

Sets `inventory_ingestion_skipped = true`. No transaction row.

### 5.8 `inventory_bill_unskip(p_line_item_id uuid) returns void`

Sets `inventory_ingestion_skipped = false`. No transaction row. Restores the line to pending.

### 5.9 `inventory_manual_adjust(p_item_id uuid, p_delta numeric, p_notes text) returns public.inventory_items`

Owner-or-maid only. Updates `quantity` by `delta` (signed). Clamps to zero. Inserts an `inventory_transactions` row (`reason = 'manual_adjust'`).

### 5.10 `mealplan_set_people_eating(p_date date, p_slot public.meal_slot, p_people int) returns public.meal_plans`

Per-meal people-eating override. Permission + lock rules match `mealplan_set_slot`:
- Owner/maid always; family with `meal_modify` privilege.
- Rejected if `now() >= (p_date + meal_time) - interval '1 hour'`.

### 5.11 Lock check added to `mealplan_set_slot` and `mealplan_regenerate_slot`

Both existing RPCs gain the lock check from Section 3.4 of the brainstorm.

## 6. UI

### 6.1 New routes

| Route | Purpose | Roles |
|---|---|---|
| `/inventory` | List view. Search by name. Add/edit/delete. | read: any member; write: owner/maid |
| `/inventory/[id]` | Item detail + transaction history + adjust form | read: any; write: owner/maid |
| `/inventory/new` | Add form (modal or full page). Supports `?onboarding=1`. | owner/maid only |
| `/inventory/conversions` | Conversion table: defaults + household overrides | read: any; write: owner/maid |
| `/household/meal-times` | Configure the four meal times | edit: any member |

### 6.2 Modifications to existing surfaces

- **`/dashboard`** — new dismissible card "Set up your kitchen inventory" (mirrors the owner-invite-maid card pattern). Visibility: `households.inventory_card_dismissed_at IS NULL AND (inventory_items count < 5)`.
- **`/plan/[date]`** — slot rows show:
  - A "people: N" pill (effective count). Tap → bottom sheet to override per-meal. Hidden when slot is locked or row is read-only.
  - Lock indicator + disabled controls when `now() >= meal_dt - 1h`.
  - Warning badge ("⚠️ short on rice") when `deduction_status = 'partial'`. Tap → expand to show all `deduction_warnings`.
- **`/bills/[id]`** — two new sections:
  - **Pending inventory matches** — one card per pending line item with proposed match radio buttons + Confirm/Skip.
  - **Not kitchen supplies** — skipped line items with "Undo skip" button.

### 6.3 Inventory onboarding card

```
┌────────────────────────────────────────────────┐
│ 📦 Set up your kitchen inventory               │
│ Track stock so the app can warn you when       │
│ ingredients run low.                           │
│                                                │
│ [ Add starter items → ]              [ Skip ]  │
└────────────────────────────────────────────────┘
```

The "Add starter items" link goes to `/inventory/new?onboarding=1`. That page prefills ~15 common staples (rice, dal, atta, oil, salt, sugar, milk, eggs, onions, tomatoes, ginger, garlic, turmeric, chili powder, ghee) with empty quantity inputs and a submit-all button. "Skip" sets `inventory_card_dismissed_at = now()`.

## 7. Seed data

### 7.1 Unit conversion defaults (~50 rows)

Generic conversions (item_name NULL):
- Volume: 1 cup = 240 ml, 1 tbsp = 15 ml, 1 tsp = 5 ml, 1 ml = 1 g (water proxy)
- Mass: 1 kg = 1000 g, 1 lb = 453.6 g, 1 oz = 28.35 g

Item-specific:
- Rice (basmati, jasmine, idli rice): 1 cup = 195 g
- Flour (plain, wheat, gram, rice flour): 1 cup = 120 g
- Sugar: 1 cup = 200 g
- Salt: 1 tsp = 5 g
- Cooking oil (generic, ghee): 1 cup = 218 g, 1 tbsp = 14 g
- Milk: 1 cup = 245 g
- Yogurt: 1 cup = 245 g
- Butter: 1 tbsp = 14 g, 1 cup = 227 g
- Lentils/dal (toor, urad, moong, chana): 1 cup = 200 g
- Eggs: 1 piece = 50 g
- Onion: 1 piece = 150 g
- Tomato: 1 piece = 120 g
- Potato: 1 piece = 200 g
- Garlic clove: 1 clove = 3 g
- Ginger: 1 piece (inch) = 15 g

All seeded with `household_id IS NULL`. Migration is idempotent via `on conflict do nothing`.

### 7.2 Onboarding starter list (~15 names)

Hard-coded in the `/inventory/new?onboarding=1` page (not stored in DB). The owner enters quantities; rows are inserted as `inventory_items` only if a quantity > 0 is entered.

## 8. Testing

| Test file | Coverage |
|---|---|
| `tests/db/inventory-items.test.ts` | RLS read/write per role; uniqueness on (household, name, unit); clamp at 0 |
| `tests/db/inventory-transactions.test.ts` | Ledger insert on each writer RPC; signed delta semantics |
| `tests/db/inventory-cook-deduct.test.ts` | Simple deduct; scale by `people_eating`; partial (clamp); no-conversion warning; idempotent re-run |
| `tests/db/inventory-bill-ingest.test.ts` | Confirm + skip + new-item paths; unit conversion; INV_NO_CONVERSION; permission denial for family |
| `tests/db/inventory-conversions.test.ts` | Lookup priority order (household+item-specific → global → generic) |
| `tests/db/household-meal-times.test.ts` | Defaults seeded on household creation; updates; rejecting bad times |
| `tests/db/meal-plan-lock.test.ts` | `mealplan_set_slot` and `mealplan_set_people_eating` reject after lock; succeed before |
| `tests/db/inventory-sweep.test.ts` | Sweep picks the right rows (window arithmetic); idempotent across runs |
| `tests/e2e/inventory.spec.ts` | Dashboard card visibility; /inventory list; manual adjust; /bills review queue (skip + confirm + undo); people-eating pill on plan page |

## 9. Risks & non-features

- **Cron precision (~15 min):** deductions land within 15 min of the lock window. Tolerated.
- **Conversion accuracy:** generic values for "1 cup rice = 195 g" are reasonable averages, not exact for every variety. Households can override per-item. The spec is explicit: this is approximate.
- **No expiry tracking:** deferred to slice 4 (fridge). `inventory_items` has no `expiry_date` or `purchased_at`.
- **No low-stock push:** the badge appears in the UI; no notification fires.
- **No multi-location:** one bucket per item per household.
- **Cross-tz households:** v1 assumes `Asia/Singapore`. Out of scope.
- **Idempotency of seed migration:** Zomaid-default `unit_conversions` use `on conflict do nothing` keyed by the unique index. Re-applying the migration is safe.
- **Audit ledger growth:** unbounded over time. Acceptable for years of usage (back-of-envelope: ~30 inserts/day per household → ~10k/year). A future pruning job is out of scope.
- **Concurrency:** the cook-deduct RPC uses `for update` on the meal_plan row to serialize repeated runs. Concurrent runs on different meal_plan rows are safe.

## 10. Out of scope (explicit)

- Auto-allocation on view (slice 3 of this overhaul) — uses inventory data this slice ships, but lives in its own brainstorm.
- Fridge / expiry tracking (foundations slice 4) — separate table, separate slice.
- Push notifications for low-stock — the badge ships; the notification does not.
- Spending analytics on "not kitchen supplies" — the data is preserved per bill; a cross-bill view is a follow-up.
- Fuzzy matching of bill line items to inventory (typo tolerance, abbreviations) — v1 is lowercase-exact only.
- Editing recipe ingredients to match inventory canonical names — assumes slice 1's lowercase canonical convention.
- Multi-location inventory (pantry vs fridge vs freezer).
- Multi-timezone households.
- Pruning old `inventory_transactions` rows.
