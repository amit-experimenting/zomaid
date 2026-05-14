# Zomaid — Meal-Plan Auto-Allocation — Design

- **Date**: 2026-05-14
- **Status**: Approved (brainstorming) — pending implementation plan
- **Slice**: 3 of 3 in the recipes-and-allocation overhaul. Final piece that wires recipe data (slice 1) and inventory + meal-times (slice 2) into a friction-free meal-planning experience.
- **Owner**: dharni05@gmail.com
- **Depends on**:
  - [2026-05-14 Recipe Data Fill](./2026-05-14-recipe-data-fill-design.md) — supplies `recipes.default_servings` and ingredient quantities used by stock-fit scoring.
  - [2026-05-14 Kitchen Inventory](./2026-05-14-inventory-design.md) — supplies `inventory_items`, `unit_conversions`, `household_roster_size`, `is_meal_slot_locked`, and the existing `can_modify_meal_plan` helper.

## 1. Context

Today the `/plan/<date>` page shows a "Generate plan for this day" button (`MissingPlanCTA`) when a household's meal_plan rows are empty. The owner taps it; the existing `mealplan_regenerate_slot` RPC picks a random non-repeat recipe per slot. This is friction the user doesn't want — and now that slice 2 provides inventory, the picker has a much better signal than randomness.

This slice replaces the manual button with **on-view auto-fill** that scores eligible recipes by stock availability and picks the best one. The existing nightly cron is upgraded to use the same algorithm so cron-filled rows and on-view-filled rows are consistent. The `WeekStrip` navigation is capped to today + the next 3 days (4 days total) — past dates aren't reachable from the strip, and the auto-fill horizon is implicitly limited too.

## 2. Decomposition (this brainstorm cycle)

| # | Slice | Status |
|---|---|---|
| 1 | Recipe data fill + YouTube + default_servings | Done |
| 2 | Inventory: tables, onboarding card, cook-deduct, bill ingest, meal times, locks | Done |
| 3 | Auto-allocation on view, inventory-aware suggestion engine (this doc) | Designing |

## 3. Decisions log (from brainstorming, 2026-05-14)

| Q | Decision |
|---|---|
| Trigger model | **On-view, today + future only.** When `/plan/<date>` renders for `date >= current_date` and the caller has write permission, the server calls `mealplan_autofill_date(date)` before reading rows. Past dates stay empty if never filled — no fabrication of history. |
| Cron upgrade | **Yes — upgrade the existing nightly cron to use the same algorithm.** One source of truth for both pre-warm and on-view paths. `mealplan_suggest_for_date` becomes a thin wrapper that loops households and calls `mealplan_autofill_date`. |
| Inventory scoring model | **Soft preference, binary per ingredient.** Score = (ingredients in stock with enough qty) / (total ingredients). Threshold 0.5: if any candidate scores ≥ 0.5, pick the highest (random among ties); else fall back to random non-repeat eligible. Always suggests something when eligible candidates exist. |
| Recency rule | **Unchanged — 4-day same-slot non-repeat as hard eligibility filter.** Inventory score ranks the eligible set. Random tie-break. |
| Permission for on-view fill | **`can_modify_meal_plan(household)`.** Owner, maid, and family-with-`meal_modify`-privilege trigger fill. View-only family members see empty rows until someone with write permission visits, or until the cron runs. |
| Plan navigation horizon | **`WeekStrip` capped at 4 days** (today + 3 forward). Past dates and dates >3 ahead are not reachable from the strip. URL-based navigation is not blocked. |
| Per-slot regenerate UX | **Keep the "Regenerate" action.** Updated to use the new scoring algorithm via `mealplan_regenerate_slot`. Same lock + permission rules. |
| Null-recipe row cleanup | **One-time DELETE of orphan rows.** Rows where `recipe_id IS NULL` AND `people_eating IS NULL` AND `cooked_at IS NULL` AND `deduction_status = 'pending'` are deleted. Rows with a real `people_eating` override are preserved. |
| Lock window | **Auto-fill respects `is_meal_slot_locked`.** A locked slot is skipped (left empty). |
| Showing the score in UI | **Out of scope.** Score is internal-only in v1. No "89% in stock" indicator. |
| Multi-day batch fill | **Out of scope.** Auto-fill only fires for the viewed date. Cron handles tomorrow; further days fill on view. |

## 4. Schema

No new tables. No new columns. The slice is functions + data cleanup + UI.

## 5. Functions / RPCs

### 5.1 `mealplan_recipe_stock_score` (new helper)

```sql
function public.mealplan_recipe_stock_score(
  p_household uuid,
  p_recipe_id uuid,
  p_people    int
) returns numeric  -- 0..1
  language plpgsql stable security definer
  set search_path = public
```

Per ingredient, compute the needed quantity at the given people-count using `(p_people / recipe.default_servings) * ingredient.quantity`. Look up the household's inventory for that lowercased item name via `inventory_lookup`. If found and units differ, convert via `inventory_convert`; if no conversion, treat the ingredient as unstocked. Count an ingredient as "in stock" when `inventory.quantity >= needed_qty`. Score is `in_stock_count / total_ingredient_count`. Returns 0 for a recipe with no ingredients.

`security definer` because it reads `inventory_items` and the caller may not have an owner/maid role (e.g. family member visiting the plan page).

### 5.2 `mealplan_autofill_date` (new RPC)

```sql
function public.mealplan_autofill_date(p_date date) returns int
  language plpgsql security definer
  set search_path = public
```

Returns the number of slots actually filled.

Algorithm (per the four meal slots, in order):

1. **Skip locked slots.** If `is_meal_slot_locked(household, p_date, slot)` returns true, continue.
2. **Skip non-empty rows.** If a meal_plans row exists for `(household, p_date, slot)` with `recipe_id IS NOT NULL`, continue. If it exists with `cooked_at IS NOT NULL`, also continue (the cron sweep already processed it as skipped — don't backfill).
3. **Build eligible candidate set.** From `effective_recipes(household)` where `slot = current_slot`, exclude any recipe used in the same slot in `p_date - 4 .. p_date - 1` (4-day non-repeat rule).
4. **Score eligible candidates.** For each, call `mealplan_recipe_stock_score(household, recipe_id, household_roster_size(household))`. Note: at fill time the row doesn't exist (or has `recipe_id IS NULL`), so `meal_plans.people_eating` may exist as an override — if so, use that; else use roster size.
5. **Pick.** Let `max_score = max(score)`. If `max_score >= 0.5`, pick at random among `{r : score(r) = max_score}`. Else if any eligible candidate exists, pick one at random regardless of score. Else, leave the slot empty.
6. **Insert with upsert-on-empty.**
   ```sql
   insert into meal_plans (household_id, plan_date, slot, recipe_id, set_by_profile_id)
   values (v_household, p_date, slot, v_chosen, null)
   on conflict (household_id, plan_date, slot) do update
     set recipe_id = excluded.recipe_id
     where meal_plans.recipe_id is null
       and meal_plans.cooked_at is null;
   ```
   The conditional WHERE on DO UPDATE ensures we only fill empty unprocessed rows. `set_by_profile_id = null` flags the fill as system-set (matches the existing convention).

Permission: the RPC is `security definer` so it bypasses `meal_plans` RLS. Internal check rejects callers who are neither `postgres` / `supabase_admin` (the cron) nor pass `can_modify_meal_plan(v_household)`.

Concurrency: two concurrent calls for the same date are safe — the `on conflict do nothing`-style guard means the second caller's INSERT either becomes an UPDATE that no-ops (recipe_id already non-null) or is harmlessly redundant (same recipe).

### 5.3 `mealplan_regenerate_slot` (upgrade existing)

The current implementation in `supabase/migrations/20260618_001_meal_plan_inventory_rpcs.sql` (added in slice 2) preserves a "non-repeat eligible random pick, fallback to any random" logic. This slice replaces that inner logic with the new scoring path: build eligible candidates, score, pick top-≥0.5, else random eligible, else null. The lock check, permission check, and upsert behavior are unchanged.

### 5.4 `mealplan_suggest_for_date` (upgrade existing cron entrypoint)

The current implementation iterates households and per-slot picks a random eligible recipe. This slice replaces the per-slot logic with a single call to `mealplan_autofill_date(p_date)` per household:

```sql
function public.mealplan_suggest_for_date(p_date date)
  returns void
  ...
  begin
    for v_household in
      select distinct household_id from household_memberships where status = 'active'
    loop
      perform public.mealplan_autofill_date_for_household(v_household, p_date);
    end loop;
  end;
```

(Note: the cron-callable variant `mealplan_autofill_date_for_household(p_household, p_date)` is the internal worker that `mealplan_autofill_date(p_date)` wraps for the on-view caller. The two share the body via a private helper, or `mealplan_autofill_date` resolves the household via `current_household_id_for_caller()` and delegates to the worker.)

The pg_cron schedule (`0 22 * * *` SGT) is unchanged.

## 6. UI changes

### 6.1 `src/app/plan/[date]/page.tsx`

Before the existing `meal_plans` select, when:
- `date >= current_date_in_sgt`, AND
- caller has write permission (existing `readOnly` logic — owner/maid OR family-with-meal_modify), AND
- (optional pre-check) at least one slot is empty,

call `supabase.rpc("mealplan_autofill_date", { p_date: date })`. Then run the existing select to read freshly-filled rows. The pre-check is an optimization that avoids a no-op RPC on already-filled days; safe to omit.

Remove the `MissingPlanCTA` import and the conditional render block. The "empty library" branch (when `effective_recipes` returns nothing) stays — that's still a valid empty state.

### 6.2 `src/components/plan/week-strip.tsx`

Cap the rendered range to today + the next 3 days. The exact implementation depends on the current `WeekStrip` shape — likely a slice/filter of the existing 7-day array. The active-date highlight logic is unchanged. URL-based navigation outside the 4-day window still works; the strip just doesn't expose it.

### 6.3 Delete

- `src/components/plan/missing-plan-cta.tsx` — removed.
- `generatePlanForDate` from `src/app/plan/actions.ts` — removed (nothing else calls it).

## 7. Data migration

A one-time cleanup of orphan null-recipe rows that predate slice 3:

```sql
delete from public.meal_plans
where recipe_id is null
  and people_eating is null
  and cooked_at is null
  and deduction_status = 'pending';
```

Rationale: post-slice-2, the `mealplan_set_people_eating` RPC creates rows with `recipe_id = null` to store a people-eating override before a recipe is chosen. We preserve those rows. We also preserve rows with `cooked_at` set (legitimate skipped meals) and rows that have advanced past `pending` status. Everything else is residue from the manual-CTA era and can go.

The DELETE is idempotent and runs once. After it, the `mealplan_autofill_date` upsert (with its conditional DO UPDATE) handles new flow correctly.

## 8. Testing

| File | Coverage |
|---|---|
| `tests/db/inventory-stock-score.test.ts` | `mealplan_recipe_stock_score`: 1.0 when fully stocked; correct fraction when partial; 0 for recipe with no ingredients; unit conversion path; missing inventory item → 0 |
| `tests/db/mealplan-autofill.test.ts` | `mealplan_autofill_date`: fills only empty slots; idempotent on re-run; picks highest score ≥ 0.5; falls back to random when no score ≥ 0.5; leaves slot empty when zero eligible; respects 4-day non-repeat; preserves people_eating overrides on null-recipe rows; respects lock window |
| `tests/db/mealplan-regenerate-scoring.test.ts` | Updated `mealplan_regenerate_slot`: now uses scoring; lock check still applies |
| `tests/db/mealplan-null-recipe-cleanup.test.ts` | The DELETE migration: removes orphan rows; preserves people_eating overrides; preserves cooked rows |
| `tests/e2e/plan-autofill.spec.ts` | Unauthenticated `/plan/<today>` redirects to `/` (smoke gating, consistent with sibling e2e files) |

The cron path is covered implicitly: the wrapper just loops and calls the per-household worker, which is what `mealplan-autofill.test.ts` exercises directly.

## 9. Risks & non-features

- **Score computation cost.** ~65 recipes × ~10 ingredients each = ~650 inventory lookups per page render. Single-millisecond range in Postgres; acceptable. Cache only if observed slowness — premature otherwise.
- **Empty inventory → identical to today.** Households who haven't set up inventory see slice 3 behave the same as today's random non-repeat. No regression, no surprise.
- **Lock-window interaction.** Auto-fill skips locked slots. Edge: a slot existing with `recipe_id = null` from slice 2's `mealplan_set_people_eating`, with the lock window passed — auto-fill won't backfill it. The user sees a slot with people-count set but no recipe. Acceptable; they can manually fill via the regenerate action before lock.
- **Tie-break randomness.** Two consecutive calls for the same date might pick different recipes when scores tie. Once the first commits, the conditional DO UPDATE prevents the second from changing it.
- **`mealplan_regenerate_slot` semantics change.** Existing users may notice a behavioral shift: the per-slot regenerate now favors stocked recipes instead of pure random. This is intentional and matches the slice's purpose.
- **Family member's first view doesn't fill.** A view-only family member loading the page before any owner/maid (or the cron) sees empty rows. Acceptable — documented permission model.

## 10. Out of scope (explicit)

- Showing the inventory-fit score in the UI ("89% in stock").
- Explaining *why* a recipe was chosen ("you have all the rice and onions").
- Per-household tuning of the scoring weights or threshold.
- Auto-filling past dates that were never filled (those stay empty).
- Auto-filling more than today + 3 days ahead (the `WeekStrip` cap bounds it).
- Multi-day batch fill on view.
- Score caching, materialized views, or background score recomputation.
- Push notifications for "slot filled" or "low score, restock recommended."
