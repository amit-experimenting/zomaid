# Zomaid — Slice 2b: Shopping List — Design

- **Date**: 2026-05-11
- **Status**: Approved (brainstorming) — pending implementation plan
- **Slice**: 2b of 7 — see _Decomposition_ in the foundations spec
- **Owner**: amit@instigence.com
- **Depends on**: [2026-05-10 Foundations Design](./2026-05-10-foundations-design.md), [2026-05-11 Slice 2a Design](./2026-05-11-slice-2a-recipes-meal-plan-design.md)

## 1. Context

A standing per-household shopping list. Items can be added manually or auto-pulled from the next 7 days of meal plans (slice 2a). Bought items move to a history view rather than disappearing. Owner + maid edit; family is read-only — same permission model as slice 2a.

This slice is small: one table, one Postgres function, five server actions, one route, three components. Estimated 10–12 tasks.

## 2. Decomposition (relative to the full project)

| # | Slice | Status |
|---|---|---|
| 1 | Foundations | Done |
| 2a | Recipes + meal plan + suggestion engine | Done |
| 2b | Shopping list (this doc) | Designing |
| 3 | Inventory + bill scanning (OCR) | Pending |
| 4 | Fridge with expiry recommendations | Pending |
| 5 | Tasks + reminders + Web Push | Pending |
| 6 | Billing + subscription tiers | Pending |
| 7 | Admin tools | Pending |

## 3. Decisions log (from brainstorming, 2026-05-11)

| Q | Decision |
|---|---|
| List lifetime | **Standing list per household**, long-lived |
| Bought lifecycle | **`bought_at` timestamp**; default view hides bought items; toggle to show the last 7 days |
| Auto-add behavior | **Pull next 7 days of plans**; dedupe by `(lower(item_name), unit)`; sum quantities for matching pairs; skip pairs already unbought in the list |
| Organization | **Flat list**, newest at top (insertion order) |
| Edit permissions | **Owner + maid edit; family read-only** (matches slice 2a; `meal_modify` privilege still parked) |
| Source tracking | **None** — auto-added and manual items are indistinguishable rows; no recipe back-link |
| Manual item shape | **Name (required) + optional quantity + optional unit + optional notes** |
| UI route | **`/shopping`** (new) |
| Dashboard | **No new card in v1**; discovery via a 3-link header nav (Plan · Recipes · Shopping) added in this slice |

## 4. Domain model — one table

```
shopping_list_items
  id                     (uuid, pk, default gen_random_uuid())
  household_id           (uuid fk → households.id, ON DELETE CASCADE, not null)
  item_name              (text, not null, CHECK length between 1 and 120)
  quantity               (numeric, NULL ok, CHECK > 0)
  unit                   (text, NULL ok, CHECK length between 1 and 24)
  notes                  (text, NULL ok, CHECK length <= 500)
  bought_at              (timestamptz, NULL ok)          ← null = still on list
  bought_by_profile_id   (uuid fk → profiles.id, ON DELETE SET NULL)
  created_by_profile_id  (uuid fk → profiles.id, ON DELETE SET NULL, not null)
  created_at, updated_at (timestamptz, defaults; updated_at maintained by trigger)

  CHECK (
    (bought_at IS NULL  AND bought_by_profile_id IS NULL)
    OR
    (bought_at IS NOT NULL)
  )

  index sli_household_unbought_idx
    on (household_id, created_at desc)
    where bought_at is null;

  index sli_household_bought_idx
    on (household_id, bought_at desc)
    where bought_at is not null;
```

The CHECK ensures consistency: if `bought_at` is unset, `bought_by_profile_id` must also be unset. The reverse — keeping `bought_by` after `bought_at` clears it — is also blocked, so unmark properly resets both.

The two partial indexes split the table's two access patterns (unbought list, bought history) so each is a fast index scan.

There is no `status` enum and no source-tracking; `bought_at IS NULL` is the only state.

## 5. Auto-add from plans — one SQL function

```sql
shopping_auto_add_from_plans()
  RETURNS setof shopping_list_items
  -- security invoker; caller's household derived from current_household_id_for_caller()
  -- (the helper added in slice 2a's 20260522_001_meal_plan_rpcs.sql).
  -- RLS on meal_plans + recipe_ingredients + shopping_list_items gates everything;
  -- there is no privilege escalation in this function.

  -- For p_household := caller's household, target window [current_date, current_date + 6]:
  --
  --   1. Aggregated_plan_ingredients :=
  --        SELECT lower(ri.item_name) AS key_name, ri.unit AS unit,
  --               SUM(ri.quantity) FILTER (WHERE ri.quantity IS NOT NULL) AS qty_sum,
  --               BOOL_OR(ri.quantity IS NULL) AS has_null,
  --               MIN(ri.item_name) AS display_name
  --        FROM meal_plans mp
  --        JOIN recipe_ingredients ri ON ri.recipe_id = mp.recipe_id
  --        WHERE mp.household_id = p_household
  --          AND mp.plan_date BETWEEN current_date AND current_date + 6
  --          AND mp.recipe_id IS NOT NULL
  --        GROUP BY lower(ri.item_name), ri.unit;
  --
  --   2. Filter out existing unbought matches:
  --        Remove rows where there exists an unbought shopping_list_items row
  --        with lower(item_name) = key_name AND coalesce(unit, '') = coalesce(unit, '').
  --
  --   3. Insert the remaining rows. For quantity:
  --        - If has_null is true (any ingredient had NULL quantity), insert quantity = NULL.
  --        - Else insert quantity = qty_sum.
  --      item_name on the new row uses display_name (the MIN — gives deterministic casing).
  --      created_by_profile_id = current_profile_id(); bought_at = NULL.
  --
  --   4. RETURN the inserted rows.
```

**Behavioral notes:**

- The MIN/lower pair handles "Chicken" vs "chicken" — they merge by `lower()` for the dedupe key, but the visible name is deterministic across runs.
- A planned recipe with NULL quantity for an ingredient ("salt to taste") produces a NULL-quantity row in the shopping list — surfacing the need without claiming a count.
- Cleared meal_plans rows (`recipe_id IS NULL`) contribute nothing because the inner JOIN excludes them.
- The function is `security invoker`. Because `meal_plans` and `recipe_ingredients` are RLS-gated and the caller must be an active member of the household to read them, no privilege escalation is possible. The downstream `INSERT INTO shopping_list_items` is also RLS-gated (`is_active_owner_or_maid`).

## 6. Authorization (RLS)

Reuses slice 2a's helpers (`has_active_membership`, `is_active_owner_or_maid`) — no new helper functions.

```
shopping_list_items
  read:    has_active_membership(household_id)        ← any active member, incl. family
  insert:  is_active_owner_or_maid(household_id)
  update:  is_active_owner_or_maid(household_id)
  delete:  is_active_owner_or_maid(household_id)
```

Family members see everything but cannot mutate anything — matches slice 2a's plan-edit model.

Function execute permission:

```
shopping_auto_add_from_plans()
  GRANT EXECUTE TO authenticated;     -- security invoker; RLS does the rest
```

## 7. API surface

`src/app/shopping/actions.ts`, Zod-validated, returns the foundations discriminated-union shape `{ ok: true, data } | { ok: false, error: { code, message, fieldErrors? } }`.

| Action | Inputs | Effect |
|---|---|---|
| `addShoppingItem` | `{ name, quantity?, unit?, notes? }` | Insert one row; `created_by = caller`; `bought_at = NULL`. |
| `updateShoppingItem` | `{ itemId, name?, quantity?, unit?, notes? }` | Patch an unbought row. Returns `SHOPPING_ITEM_BOUGHT_IMMUTABLE` if the row is already bought (history is read-only). |
| `markShoppingItemBought` | `{ itemId }` | Set `bought_at = now()`, `bought_by_profile_id = caller`. No-op if already bought. |
| `unmarkShoppingItemBought` | `{ itemId }` | Clear `bought_at` + `bought_by_profile_id`. (Undo path for accidental check-offs.) |
| `deleteShoppingItem` | `{ itemId }` | Hard delete. Allowed for both unbought and bought rows (clean up history). |
| `autoAddFromPlans` | `{}` | Wraps `shopping_auto_add_from_plans()`. Returns `{ insertedCount, insertedNames[] }` for a toast like "Added 8 items from this week's plans." |

Reads use direct Supabase queries with RLS:

| Surface | Query |
|---|---|
| Unbought list | `select * from shopping_list_items where household_id = $1 and bought_at is null order by created_at desc` |
| Bought history (last 7d) | same, with `bought_at >= now() - interval '7 days'`, ordered `bought_at desc` |

### Error codes added by this slice

```
SHOPPING_NOT_FOUND
SHOPPING_FORBIDDEN
SHOPPING_INVALID
SHOPPING_ITEM_BOUGHT_IMMUTABLE   -- patch attempted on a bought row
```

## 8. UI surfaces

### 8.1 Routes added

```
/shopping    Standing list + quick-add + auto-add + bought history toggle
```

The header nav becomes a 3-link nav (Plan · Recipes · Shopping) added alongside this slice. Currently the dashboard routes to `/plan` and `/recipes`; this adds a third entry.

### 8.2 `/shopping` layout

Mobile-first; per the approved mockup. Vertical stack:

1. **Header**: title "Shopping" + **+ Auto-add 7d** button (owner/maid only). Shows "Pulling…" spinner during the call; toast on result.
2. **Quick-add row**: text input + "+" button (owner/maid only). Pressing Enter or "+" calls `addShoppingItem` with `name = input.trim()`; clears the input. For quantity/unit/notes, the user clicks the row after add to edit (deferred — see Risks). v1 quick-add is name-only; full edit form is a tap on a row.
3. **Unbought items list**: checkbox + name + meta line ("500 g · added 2h ago" or "2 kg · NTUC only"). Tap the checkbox → optimistic mark-bought via `markShoppingItemBought`. Long-press / kebab → **Edit** or **Delete** menu (owner/maid only).
4. **Show bought** expandable section at the bottom: "Show bought (last 7d) · 12 items ▾". Tap → reveals the bought-history list (read-only display; each row has an **Undo** button that calls `unmarkShoppingItemBought` and the row jumps back into the unbought list above).
5. **Empty state**: when both unbought and bought are empty — "Nothing on the list. Add an item or auto-pull from this week's plans →".

### 8.3 Family view

Same page renders. Quick-add row, **+ Auto-add 7d** button, checkboxes (interaction), and edit/delete affordances are hidden. Family sees the list as a static view.

### 8.4 Edit row

Tapping a row opens a sheet (mobile) / dialog (desktop) with name + quantity + unit + notes fields, **Save**, **Delete**, **Cancel**. Calls `updateShoppingItem` / `deleteShoppingItem`.

### 8.5 Header nav

A new `src/components/site/main-nav.tsx` component renders `Plan · Recipes · Shopping` as text links, with the current route's link bolded. Rendered inline at the top of each of the three landing pages — `/plan` (which redirects to `/plan/[date]`, so the actual placement is `/plan/[date]/page.tsx`), `/recipes`, `/shopping`. Not added to recipe-detail / recipe-form / dashboard pages — those have their own headers.

(Considered using a Next 16 route group `(app)/layout.tsx` shared layout, but the existing foundations + slice 2a pages each manage their own header. Staying inline matches the established pattern.)

## 9. Edge cases

- **Auto-add on a household with no plans in the next 7 days**: returns 0 inserted rows; toast "Plans for the next 7 days have no recipes set."
- **Auto-add called twice without changes**: second call finds everything already unbought; inserts 0; toast "Nothing new from plans."
- **User manually adds "milk", then auto-add tries to add "milk" from a planned recipe**: case-insensitive dedupe skips the auto-add. The manual row stands.
- **Recipe contributing to an unbought item is deleted**: shopping item is unaffected (no FK from shopping to recipes).
- **Recipe contributing to a planned slot has an ingredient added later, after auto-add ran**: re-running auto-add picks up the new ingredient (it wasn't yet in the unbought list). Quantity refresh for an existing item is **not** done — the user must edit the row manually if they want to bump the quantity.
- **Family member tries to mark bought via DevTools**: RLS rejects; action returns `SHOPPING_FORBIDDEN`. UI hides the affordance anyway.
- **`updateShoppingItem` on a bought row**: rejected with `SHOPPING_ITEM_BOUGHT_IMMUTABLE`. Bought rows are immutable history; the path to "fix" is **Undo** then re-edit.
- **`deleteShoppingItem` on a bought row**: allowed. Cleans up history rows the user no longer wants to see.
- **Concurrent edits**: last-write-wins. Optimistic UI may briefly show stale state; server-action response reconciles.
- **Very large quantities** (`5_000_000` kg): no special cap. Numeric supports it. Display in the UI uses `Intl.NumberFormat` to avoid scientific notation.
- **Notes containing emoji / unicode**: `text` column; passes through unchanged. Max length 500 chars enforced both client and server side.

## 10. Testing strategy

Same shape as slice 2a — DB tests + action tests + a Playwright route-gating smoke. Per the user's "skip tests" instruction, the implementation plan ships these as separate steps that can be deferred at execution time.

- **DB-level**: RLS coverage on `shopping_list_items` (read by family, write blocked for family, household isolation). The `shopping_auto_add_from_plans` function's invariants (7-day window, dedupe, sum behavior, NULL handling, skip-existing).
- **Server actions**: `addShoppingItem`, `markShoppingItemBought`, `unmarkShoppingItemBought`, `updateShoppingItem` (incl. `SHOPPING_ITEM_BOUGHT_IMMUTABLE`), `deleteShoppingItem`, `autoAddFromPlans` happy paths + RLS rejections.
- **E2E (Playwright)**: `/shopping` route gating (unauthenticated → `/`). Authenticated walkthroughs are part of the manual checklist.

## 11. Out of scope (deferred)

- **Inventory awareness** ("you already have milk; don't auto-add") → slice 3.
- **Bill scanning to auto-mark bought** → slice 3.
- **Categories / aisles / store grouping** → punted in decision 4.
- **Source recipe back-links** → punted in decision 6.
- **Reorder / drag-to-sort rows** → out of scope.
- **Item autocomplete while typing** → out of scope.
- **Multiple separate lists** (different stores, different households member shares) → one list per household.
- **Push notifications / "shopping reminder"** → slice 5.
- **Family `meal_modify` privilege wiring** → still parked.
- **Quantity-refresh on second auto-add** (if a new recipe lands and you already had the ingredient unbought, the quantity won't auto-grow) → manual edit only in v1.

## 12. Risks & open questions

- **Dedupe granularity**: `(lower(item_name), unit)` may incorrectly merge variants ("chicken whole" vs "chicken cut"). Users can disambiguate by renaming. If this becomes a friction in v1, a free-text `variant` column could be added without migration drama.
- **Quick-add v1 is name-only**: filling quantity/unit/notes requires the row's edit sheet. Acceptable; the inline alternative would be a four-input row that bloats the mobile UI.
- **Bought history scale**: a household with 10 items/day × 365 days = 3,650 bought rows/year. Partial indexes keep queries fast. No archival/eviction in v1; revisit only if a household crosses a meaningful threshold (e.g., 50k rows).
- **No auto-archive of bought items**: a 90-day bought item still shows in history if you slide the date range — but the default 7-day filter on the UI hides it. Acceptable.
- **No risks-only items remain.** All earlier "open" questions were resolved during the brainstorming pass; if anything surfaces during implementation, the implementer flags it in the per-task review loop.
