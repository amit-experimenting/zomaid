# Zomaid — Slice 2a: Recipes & Meal Plan — Design

> **Superseded as the living architecture doc for the recipes area by [`features/recipes.md`](features/recipes.md).** This dated spec is retained for historical context.

> **Superseded as the living architecture doc for the meal-plan area by [`features/meal-plan.md`](features/meal-plan.md).** This dated spec is retained for historical context.

- **Date**: 2026-05-11
- **Status**: Approved (brainstorming) — pending implementation plan
- **Slice**: 2a of 7 — see _Decomposition_ in the foundations spec; slice 2 (Recipes + daily meal plan) is split into 2a (this doc — recipes + plan + suggestion) and 2b (shopping list, separate brainstorm later)
- **Owner**: amit@instigence.com
- **Depends on**: [2026-05-10 Foundations Design](./2026-05-10-foundations-design.md)

## 1. Context

This slice delivers the first feature module on top of the foundations slice: a recipe catalog and a daily meal plan with an automatic suggestion engine. After this slice, a household can browse a curated Singapore starter pack, add custom recipes, see today's four meals pre-suggested, override any slot, and view a rolling week of plans. The shopping list — which uses this slice's structured ingredients as input — is deferred to slice 2b.

## 2. Decomposition (relative to the full project)

| # | Slice | Status |
|---|---|---|
| 1 | Foundations | Done |
| 2a | Recipes + meal plan + suggestion engine (this doc) | Designing |
| 2b | Shopping list (auto-generated + manual + check-off) | Pending |
| 3 | Inventory + bill scanning (OCR) | Pending |
| 4 | Fridge with expiry recommendations | Pending |
| 5 | Tasks + reminders + Web Push | Pending |
| 6 | Billing + subscription tiers | Pending |
| 7 | Admin tools | Pending |

## 3. Decisions log (from brainstorming, 2026-05-11)

| Q | Decision |
|---|---|
| Planning model | **Auto-suggest a day in advance, excluding recipes used in the same slot in the last 4 days; maid/owner can override** |
| Recipe source | **Curated SG starter pack + household additions** |
| Recipe content | **Full cookbook**: name, slot, photo, structured ingredients, structured steps, prep time, notes |
| Meal slots | **Breakfast, lunch, snacks, dinner** (4 fixed slots, chronological order) |
| Suggestion algorithm | **Simple non-repeat (random eligible)** — no weighting, no dietary filter |
| Dietary restrictions | **Not modeled in v1** |
| Suggestion firing | **Nightly pg_cron batch at 22:00 SGT** for tomorrow's date |
| History tracking | **Planned = cooked unless modified** — no separate `cooked` flag |
| Edit scope | **Owner + maid edit any date; family read-only in v1** (foundations `meal_modify` privilege parked until slice 6) |
| Shopping list | **Deferred to slice 2b** (recipes carry structured ingredients so 2b can aggregate) |
| Recipe creators | **Maid + owner** can both add custom recipes |
| Starter handling | **Full edit via per-household override** — implemented as fork-on-edit; hide-only also supported |
| Default UI layout | **Today-first vertical list** with a week strip for navigation |
| Scope split | **Slice 2 split into 2a (this doc) and 2b (shopping list)** — each gets its own spec → plan → ship cycle |

## 4. Domain model

### 4.1 Tables

```
recipes
  id (uuid, pk)
  household_id      (uuid fk → households.id, NULL = starter pack)
  parent_recipe_id  (uuid fk → recipes.id, NULL unless this is a household fork of a starter)
  name              (text, max 120, not null)
  slot              (enum: 'breakfast' | 'lunch' | 'snacks' | 'dinner', not null; declaration order = UI display order)
  photo_path        (text, NULL ok)                ← Supabase Storage path (no bucket prefix)
  prep_time_minutes (int, NULL ok, CHECK > 0)
  notes             (text, NULL ok)
  created_by_profile_id (uuid fk → profiles.id, NULL ok for starter)
  archived_at       (timestamptz, NULL ok)         ← soft delete; existing plan rows still resolve
  created_at, updated_at (timestamptz, defaults now())

  CHECK invariants (enforced via a trigger or CHECK constraint):
    Starter row:   household_id IS NULL AND parent_recipe_id IS NULL
    Custom row:    household_id IS NOT NULL AND parent_recipe_id IS NULL
    Fork row:      household_id IS NOT NULL AND parent_recipe_id IS NOT NULL

  UNIQUE (household_id, parent_recipe_id) WHERE parent_recipe_id IS NOT NULL
    -- one fork per household per parent

recipe_ingredients
  id (uuid, pk)
  recipe_id  (uuid fk → recipes.id, ON DELETE CASCADE, not null)
  position   (int, not null)
  item_name  (text, not null)
  quantity   (numeric, NULL ok)
  unit       (text, NULL ok)
  UNIQUE (recipe_id, position)

recipe_steps
  id (uuid, pk)
  recipe_id    (uuid fk → recipes.id, ON DELETE CASCADE, not null)
  position     (int, not null)
  instruction  (text, not null)
  UNIQUE (recipe_id, position)

household_recipe_hides
  household_id  (uuid fk → households.id, not null)
  recipe_id     (uuid fk → recipes.id, not null)
  hidden_at     (timestamptz, default now())
  hidden_by_profile_id (uuid fk → profiles.id, not null)
  PRIMARY KEY (household_id, recipe_id)
  -- Only starter rows may be hidden; enforced by a CHECK trigger reading recipes.household_id IS NULL

meal_plans
  id            (uuid, pk)
  household_id  (uuid fk → households.id, not null)
  plan_date     (date, not null)
  slot          (enum: 'breakfast' | 'lunch' | 'snacks' | 'dinner', not null)
  recipe_id     (uuid fk → recipes.id, NULL ok, ON DELETE SET NULL)
                  -- NULL = "no meal planned / cleared"
  set_by_profile_id (uuid fk → profiles.id, NULL ok)
                  -- NULL = system suggestion; non-NULL = human override
  created_at, updated_at (timestamptz, defaults; updated_at maintained by trigger per foundations pattern)
  UNIQUE (household_id, plan_date, slot)
```

### 4.2 The fork-on-edit model

When a household edits a starter recipe, the action handler deep-copies the starter row + its ingredients + its steps into a new household-owned recipe with `parent_recipe_id = original.id`. The starter is untouched. From the household's perspective, the fork replaces the starter wherever the effective library is queried. The original id is replaced by the fork id in API responses, so the UI redirects to the fork's detail page.

**Trade-off accepted:** Starter pack updates pushed by admin (a future slice-7 migration) do not propagate to households that have forked. A complex three-way merge UI is not justified for v1.

### 4.3 Effective library function

```sql
effective_recipes(p_household uuid) returns setof recipes
  -- security invoker; relies on caller's RLS for row visibility
  -- Returns:
  --   starter recipes (household_id IS NULL) NOT in household_recipe_hides for p_household
  --                                          AND NOT a parent of any (p_household, parent_recipe_id) fork
  --   UNION ALL
  --   household-owned recipes (household_id = p_household) where archived_at IS NULL
```

This function is the single point of truth for "what recipes does this household see." Both the library browse query and the suggestion engine call it.

### 4.4 History-window query (for the suggestion engine)

```sql
-- For a given (household, slot, target_date), recipes used in the same slot
-- across the 4 days immediately preceding target_date:
SELECT recipe_id
FROM meal_plans
WHERE household_id = $1
  AND slot         = $2
  AND plan_date    BETWEEN $3::date - 4 AND $3::date - 1
  AND recipe_id    IS NOT NULL;
```

NULL-recipe rows (skipped/cleared slots) do not contribute to the history window — they mean "no meal that day," not "any meal can repeat."

## 5. Suggestion engine

### 5.1 Nightly batch — `mealplan_suggest_for_date(date)`

A pg_cron job runs **daily at 22:00 Asia/Singapore** and calls a Postgres function that, for each household with any active membership, ensures `meal_plans` rows exist for the four slots on the target date.

```sql
-- pg_cron entry (created via migration)
SELECT cron.schedule(
  'mealplan-suggest-tomorrow',
  '0 22 * * *',                             -- DB timezone is Asia/Singapore
  $$ SELECT mealplan_suggest_for_date(current_date + 1); $$
);

mealplan_suggest_for_date(p_date date) RETURNS void
  -- LANGUAGE plpgsql
  -- Not security definer (pg_cron runs as postgres → RLS doesn't apply for that role)
  -- EXECUTE permission REVOKEd from public; GRANT only to postgres.

  -- For each household with any active membership:
  --   For each slot in (breakfast, lunch, dinner, snacks):
  --     If a meal_plans row already exists for (household, p_date, slot): skip.
  --     Else:
  --       1. Build excluded_set: recipe_ids used in same slot in [p_date-4, p_date-1].
  --       2. eligible := SELECT id FROM effective_recipes(household)
  --                       WHERE slot = $slot AND id NOT IN (excluded_set).
  --       3. If eligible is non-empty: pick a random row, insert meal_plans
  --          with set_by_profile_id = NULL.
  --       4. Else (library smaller than the window): pick from effective_recipes
  --          for that slot regardless of history (fallback — silent; the UI
  --          detects "library < window" separately at read time and warns).
  --       5. Else (library empty for slot): insert meal_plans with recipe_id = NULL.
  --     Always use ON CONFLICT (household_id, plan_date, slot) DO NOTHING.
```

### 5.2 On-demand regenerate — `mealplan_regenerate_slot(...)`

```sql
mealplan_regenerate_slot(p_date date, p_slot meal_slot)
  RETURNS meal_plans
  -- security invoker; RLS on meal_plans + effective_recipes enforces owner-or-maid + household scope.
  -- Same algorithm as the batch for one (household, date, slot).
  -- Household is derived from auth.jwt() ->> 'sub' via a helper (no client-passed id).
  -- Upserts the meal_plans row, set_by_profile_id = caller (updated_at refreshed by trigger).
  -- Returns the upserted row.
  -- The 4-day exclusion window is anchored to p_date (i.e., [p_date-4, p_date-1]) — regenerating
  -- a date doesn't include that date's own (about-to-be-replaced) recipe in the exclusion set.
```

### 5.3 Manual override — `mealplan_set_slot(...)`

```sql
mealplan_set_slot(p_date date, p_slot meal_slot, p_recipe_id uuid)
  RETURNS meal_plans
  -- security invoker. p_recipe_id NULL means "clear / skipped."
  -- RLS gates owner-or-maid on the household.
  -- RLS also gates the recipe_id (must be readable to the caller).
  -- Upserts; set_by_profile_id = caller.
```

### 5.4 Engine guarantees and limits

- **Idempotent.** Re-running `mealplan_suggest_for_date(d)` is a no-op because of the `UNIQUE (household_id, plan_date, slot)` + `ON CONFLICT DO NOTHING` pattern.
- **No race.** Two concurrent calls cannot create duplicate rows.
- **No regression on manual overrides.** If a row already exists (set_by_profile_id = anyone), the batch skips it.
- **Fallback on small libraries.** Households with fewer recipes than the exclusion window get repeats with a UI hint, not empty slots.
- **No retroactive backfill.** If the cron skipped a night (outage), historical dates are not auto-filled. The UI surfaces a "Generate plan for this day" CTA the user can hit per-slot.

## 6. Authorization

### 6.1 New SQL helper

```sql
is_active_owner_or_maid(p_household uuid) returns boolean
  -- security definer, search_path = public
  -- True iff caller has an active household_memberships row in p_household with role in ('owner', 'maid').
```

This is the new write-gate for the slice and the only addition to the foundations auth helpers (`has_active_membership`, `is_active_owner`).

### 6.2 RLS policies

```
recipes
  read_starter:    auth.jwt() ->> 'sub' IS NOT NULL AND household_id IS NULL
  read_household:  has_active_membership(household_id)
  insert:          is_active_owner_or_maid(household_id) AND household_id IS NOT NULL
                   -- starter rows are inserted by the seed migration as service_role
  update:          is_active_owner_or_maid(household_id) AND household_id IS NOT NULL
  delete:          is_active_owner_or_maid(household_id) AND household_id IS NOT NULL

recipe_ingredients, recipe_steps
  read:            EXISTS (recipe r WHERE r.id = recipe_id AND <recipe.read policy resolves to true>)
  insert/update/delete:
                   EXISTS (recipe r WHERE r.id = recipe_id AND <recipe.write policy resolves to true>)
  -- Implemented as a single policy expression per CRUD per table, piggybacking on recipes via subquery.

household_recipe_hides
  read:            has_active_membership(household_id)
  insert:          is_active_owner_or_maid(household_id)
                   AND EXISTS (SELECT 1 FROM recipes WHERE id = recipe_id AND household_id IS NULL)
  delete:          is_active_owner_or_maid(household_id)

meal_plans
  read:            has_active_membership(household_id)
  insert:          is_active_owner_or_maid(household_id)
  update:          is_active_owner_or_maid(household_id)
  delete:          is_active_owner_or_maid(household_id)
```

### 6.3 Function execute permissions

```
mealplan_suggest_for_date(date)
  REVOKE EXECUTE FROM public;
  GRANT EXECUTE TO postgres;     -- pg_cron only; not app-callable

mealplan_regenerate_slot(...)
mealplan_set_slot(...)
  GRANT EXECUTE TO authenticated; -- security invoker; RLS handles row-level gating

effective_recipes(uuid)
is_active_owner_or_maid(uuid)
  GRANT EXECUTE TO authenticated; -- read-side helpers; RLS on underlying tables still applies
```

### 6.4 Storage RLS

Two buckets, both created via migration:

```
recipe-images-public
  read:  true                                       -- public; signed URLs not needed
  write: auth.role() = 'service_role'               -- only seed migration writes here
  -- Used for starter pack photos.

recipe-images-household
  read:           bucket_id = 'recipe-images-household'
                  AND has_active_membership((split_part(name, '/', 1))::uuid)
  insert/update/delete:
                  bucket_id = 'recipe-images-household'
                  AND is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
  -- Path convention: <household_id>/<recipe_id>.<ext>
  -- App accesses via createSignedUrl; RLS gates issuance.
```

### 6.5 What does NOT bypass RLS

Slice 2a has **zero RLS-bypassing app paths**. Unlike foundations' `redeem_invite`, every app-callable function is `security invoker`. The cron's batch function runs as `postgres` and bypasses RLS for that role only — it is not exposed to end users.

## 7. API surface

All server actions live under `src/app/*/actions.ts`, Zod-validated, returning the foundations discriminated-union shape: `{ ok: true, data } | { ok: false, error: { code, message, fieldErrors? } }`.

### 7.1 Recipe actions — `src/app/recipes/actions.ts`

| Action | Inputs (Zod-validated) | Effect |
|---|---|---|
| `createRecipe` | `{ name, slot, prepTimeMinutes?, notes?, ingredients[], steps[], photoFile? }` (FormData) | Inserts a `recipes` row with `household_id = caller's household`, plus ingredient and step rows, plus a photo upload if present — all in one transaction. Returns the new recipe id. |
| `updateRecipe` | `{ recipeId, name?, slot?, prepTimeMinutes?, notes?, ingredients?, steps?, photoFile? }` | If target is a starter (`household_id IS NULL`) and caller is owner/maid: deep-copies into a household fork, applies the patch. If target is already household-owned: applies patch directly. Ingredients and steps arrays, when present, fully replace existing rows. Returns the effective recipe id (may differ from input when fork-on-edit fires). |
| `archiveRecipe` | `{ recipeId }` | Household-owned only. Sets `archived_at = now()`. |
| `unarchiveRecipe` | `{ recipeId }` | Clears `archived_at`. |
| `hideStarterRecipe` | `{ recipeId }` | Inserts into `household_recipe_hides`. |
| `unhideStarterRecipe` | `{ recipeId }` | Deletes from `household_recipe_hides`. |

### 7.2 Meal plan actions — `src/app/plan/actions.ts`

| Action | Inputs | Effect |
|---|---|---|
| `setMealPlanSlot` | `{ planDate, slot, recipeId or null }` | Wraps `mealplan_set_slot` RPC. |
| `regenerateMealPlanSlot` | `{ planDate, slot }` | Wraps `mealplan_regenerate_slot` RPC. |

(No action to invoke the batch — the cron owns nightly creation. Missing-date repair is handled by looping `regenerateMealPlanSlot` over the four slots client-side.)

### 7.3 Postgres functions

```
mealplan_suggest_for_date(p_date date)           -- §5.1
mealplan_regenerate_slot(p_date date, p_slot meal_slot)  -- §5.2; returns meal_plans
mealplan_set_slot(p_date date, p_slot meal_slot, p_recipe_id uuid)  -- §5.3; returns meal_plans
effective_recipes(p_household uuid)              -- §4.3
is_active_owner_or_maid(p_household uuid)        -- §6.1
```

### 7.4 Photo upload mechanics

- Server action receives `File` via FormData.
- Client-side compression to ≤ 1 MB at ≤ 1920 px on the long edge (`browser-image-compression` library). EXIF stripped.
- Server validates ≤ 5 MB and MIME type (`image/jpeg`, `image/png`, `image/webp`) as a backstop.
- Uses the authenticated Supabase client (`accessToken` callback from foundations).
- Upload path: `recipe-images-household/<household_id>/<recipe_id>.<ext>`. `upsert: true` for edit flows.
- On success, updates `recipes.photo_path` in the same action body.
- Orphan blobs (upload succeeded, DB update failed) are tolerated; slice-7 admin cleanup task.

### 7.5 Error codes added by this slice

```
RECIPE_NOT_FOUND
RECIPE_FORBIDDEN              -- attempted to mutate a recipe outside your household
RECIPE_INVALID_SLOT
RECIPE_PHOTO_TOO_LARGE
RECIPE_PHOTO_BAD_TYPE
MEAL_PLAN_NO_ELIGIBLE_RECIPE  -- regenerate found nothing even with fallback (empty library)
```

### 7.6 Reads (no actions — direct Supabase queries, RLS-gated)

| Surface | Query |
|---|---|
| Today landing | `meal_plans` joined with `recipes` where `household_id = $1 AND plan_date = $2` |
| Week strip | `meal_plans` where `household_id = $1 AND plan_date BETWEEN current_date - 7 AND current_date + 7` |
| Library browse | `effective_recipes($household)` + slot filter + ILIKE search |
| Recipe detail | `recipes` by id + its `recipe_ingredients` + `recipe_steps` |

## 8. UI surfaces

### 8.1 Routes added

```
/plan                       Today-first list (default landing for slice 2a)
/plan/[date]                Any date (YYYY-MM-DD, used by week strip nav)
/recipes                    Library browse
/recipes/new                Create form
/recipes/[id]               Recipe detail
/recipes/[id]/edit          Edit form (fork-on-edit handled invisibly by updateRecipe)
```

The "Recipes & meal plan" placeholder card on `/dashboard` (from foundations) becomes active and routes to `/plan`.

### 8.2 Today-first list — `/plan` and `/plan/[date]`

Vertical stack of four slot rows in chronological order: breakfast, lunch, snacks, dinner — matching the `meal_slot` enum declaration. Each row shows a photo thumbnail (or placeholder icon) and the recipe name with the slot label. A week strip of seven days, centered on the viewed date, sits at the bottom; today is bolded.

Tap a slot row → action sheet (mobile) / modal (desktop) with:

- **View recipe** → `/recipes/[id]`
- **Pick different** → recipe picker (effective library filtered by slot)
- **Regenerate** → `regenerateMealPlanSlot`
- **Clear** → `setMealPlanSlot` with `recipeId = null`

Family members (any privilege in v1) see only **View recipe**.

**Slot row variants:**

- Recipe set, photo present → photo thumbnail + name + slot label.
- Recipe set, no photo → placeholder icon + name + slot label.
- `recipe_id = NULL`, `set_by_profile_id = NOT NULL` → "Cleared" (italic, muted). Action: **Pick recipe**.
- `recipe_id = NULL`, `set_by_profile_id = NULL` → "No suggestion (library is empty for this slot)" + CTA: **Add a recipe**.

**Empty library state:** If the household has no eligible recipes for any slot, the page collapses to a single full-bleed CTA: "Add your first recipe →".

**Missing-plan state (e.g., cron skipped or date > today + cron horizon):** Page shows "Not planned yet" plus a **Generate plan for this day** button that loops `regenerateMealPlanSlot` over the four slots.

### 8.3 Recipe library — `/recipes`

- Header: page title + **+ Add** button (routes to `/recipes/new`).
- Search input (ILIKE on `name`).
- Slot filter chip (All / Breakfast / Lunch / Dinner / Snacks).
- Card list, each card: photo + name + slot label + prep-time chip.
- Source: `effective_recipes(household)` where `archived_at IS NULL`.
- Sort: most-recently-used-in-plans first (recency rank computed from `meal_plans`), then alphabetical.
- Fork indicator: small "Customized" pill on cards where `parent_recipe_id IS NOT NULL`.
- Hidden starter section at the bottom (collapsible): "Hidden recipes (N)" with one-tap **Unhide**.
- Long-press / kebab menu: **Hide** (for starters), **Edit** / **Archive** (for household-owned).

### 8.4 Recipe detail — `/recipes/[id]`

- Back / title / kebab.
- Hero photo (16:9, lazy-loaded via Next `<Image>`).
- Meta line: slot · prep time.
- Sections: **Ingredients**, **Steps**, **Notes**.
- Kebab menu: **Edit**, **Add to plan…** (date + slot picker → `setMealPlanSlot`), **Hide** (starter) / **Archive** (household-owned).

### 8.5 Recipe form — `/recipes/new` and `/recipes/[id]/edit`

Single mobile-first form, vertical sections:

1. **Photo** — tap-to-pick / drag-drop; client-side compression; thumbnail preview.
2. **Name** — text, required, max 120.
3. **Slot** — segmented control, required.
4. **Prep time** — number + "min" suffix, optional.
5. **Ingredients** — repeater rows: item name (required), quantity (optional), unit (optional); drag-to-reorder; "+ Add ingredient."
6. **Steps** — repeater rows: instruction (multi-line); drag-to-reorder.
7. **Notes** — multi-line textarea.

Submit → `createRecipe` or `updateRecipe`. On success, redirect to `/recipes/[returnedId]`.

### 8.6 Mobile / PWA

- Service worker (already wired by foundations Serwist setup) caches `/plan` and the current four recipe pages for offline read.
- Offline writes return a "you're offline, try again" toast — not in scope to queue writes for v1.
- Next 16 `<Image>` for all photo rendering; lazy-load below the fold.

### 8.7 Loading / error / accessibility

- Each route has `loading.tsx` (skeleton) and `error.tsx` (foundations pattern).
- Optimistic UI on `setMealPlanSlot` and `regenerateMealPlanSlot`; reconcile on response.
- Keyboard reachability on all actions; focus traps in sheets/modals.
- Color is never the sole signal (e.g., "Cleared" uses italic + label, not just color).

## 9. Edge cases & error handling

- **Profile with no active household visits `/plan`.** Foundations' `requireHousehold()` redirects to `/onboarding`.
- **Household membership revoked mid-session.** Next server fetch returns no rows (RLS); page renders the "no household" empty state.
- **Maid removed mid-day.** Household keeps its plans; new maid (when invited) inherits the rolling plan.
- **Starter pack updated by admin after a household has forked.** Forks do not propagate; documented trade-off (§ 4.2).
- **Plan row references a hard-deleted recipe.** FK is `ON DELETE SET NULL`. UI renders "Recipe was removed" with a re-pick CTA.
- **Two writers override the same slot within seconds.** Last write wins (`set_at` updated; previous `set_by_profile_id` lost). No notification in v1.
- **Regenerate when library < 4-day window.** Falls back to "any eligible regardless of recent history." UI shows quiet info toast: "Library is small — same recipes may repeat."
- **Regenerate when library is empty for that slot.** Returns row with `recipe_id = NULL` and code `MEAL_PLAN_NO_ELIGIBLE_RECIPE`. UI: "Add a recipe →".
- **Cron skipped overnight (Vercel/Supabase outage).** Morning `/plan` shows "No plan for today — generate?" CTA.
- **Family member calls write RPC directly (DevTools).** RLS rejects; action returns `RECIPE_FORBIDDEN` / 403.
- **Partial upload (file in Storage, DB write fails).** Orphan blob. Tolerated; slice-7 cleanup.
- **EXIF location metadata.** Stripped by client-side compression.
- **4K image upload.** Compressed to ≤ 1 MB at ≤ 1920 px client-side; server enforces ≤ 5 MB + MIME type backstop.
- **Browser offline.** Reads cached by SW. Writes toast and fail; no queue.
- **Concurrent pg_cron workers.** `UNIQUE (household_id, plan_date, slot)` + `ON CONFLICT DO NOTHING` block duplicates.
- **Daylight saving.** Singapore observes no DST; DB timezone fixed `Asia/Singapore`. `0 22 * * *` is always 22:00 SGT.

## 10. Testing strategy

Same shape as foundations. Implementation can defer test tasks per the user's instruction; the design records what tests *should* exist so the implementation plan captures them.

- **DB-level (vitest + node-postgres, BEGIN/ROLLBACK harness)** —
  - RLS coverage on `recipes`, `recipe_ingredients`, `recipe_steps`, `household_recipe_hides`, `meal_plans`.
  - `effective_recipes(household)` invariants: starter minus forks minus hides plus household-owned, archived excluded.
  - `mealplan_suggest_for_date` invariants: no repeat within window; fallback when window exceeds library; NULL-row when empty; idempotent re-run.
  - `mealplan_regenerate_slot` and `mealplan_set_slot` invariants: RLS rejection for family role; upsert semantics; `set_by_profile_id` attribution.
  - `household_recipe_hides` insert rejected for non-starter recipe (CHECK trigger).
  - Storage RLS: cross-household read forbidden; same-household read allowed.

- **Server-action level (vitest + foundations' Clerk-JWT helpers)** —
  - `createRecipe`, `updateRecipe` (incl. fork-on-edit returning a new id), `archiveRecipe`, `hideStarterRecipe`: happy paths + authorization rejections.
  - `setMealPlanSlot`, `regenerateMealPlanSlot`: happy paths.
  - Zod validation: slot enum, positive prep time, ingredients require `item_name`, photo size + type.

- **E2E (Playwright, mobile + desktop projects)** —
  - Owner adds a recipe with photo → appears in library → plans today.
  - Maid logs in → today's plan is pre-filled (simulated by calling `mealplan_suggest_for_date(current_date)` via service-role client before the test; we cannot time-warp pg_cron in CI).
  - Family member sees today's plan; no edit affordances rendered.
  - Maid hits **Regenerate** on lunch; recipe changes; next regenerate excludes the previous one within the window.

- **Skipped on purpose** — image compression internals (we trust the library); pg_cron extension correctness (we trust Supabase); offline behavior beyond a single smoke test.

## 11. Out of scope (deferred)

- **Shopping list** → slice 2b.
- **Inventory + bill OCR** → slice 3.
- **Fridge tracking** → slice 4.
- **Tasks + reminders + Web Push** → slice 5.
- **Dietary tags + suggestion filtering** — revisit after v1 user feedback.
- **`meal_modify` / `view_only` enforcement on plan edits** — revisit when slice 6 (billing) wires privilege to dollars.
- **Multi-household switcher UI** — foundations schema supports it; UI deferred.
- **Admin UI for starter-pack management** → slice 7. Slice 2a seeds the starter via migration; updates are migration-driven.
- **Push notifications** ("tomorrow's plan is ready!") → slice 5.
- **Plan history eviction / archival** — plan rows are tiny; revisit if data volume warrants.
- **Recipe import from URLs / cookbooks / OCR** — manual entry only in v1.
- **Cuisine tags, difficulty, calorie info** — not used by suggestion; defer.
- **Comments / ratings on recipes** — out of scope.
- **Offline writes / write queue** — toast-and-fail in v1.

## 12. Risks & open questions

- **pg_cron availability on cloud Supabase.** Project tier must support extensions. Mitigation: first implementation task verifies `pg_cron` enables on the cloud project; fallback path is a Vercel Cron route that hits a service-role RPC.
- **Starter pack curation.** Slice 2a ships ~30–50 SG recipes seeded via migration. Source for recipe content and licensed photos is unsettled — v1 uses placeholder photos and AI-generated recipe text where needed, with a backlog ticket to commission/license proper assets before public launch. Gates "real" go-live, not slice 2a sign-off.
- **Image storage cost.** ~30 starter photos × 300 KB ≈ 9 MB. Per household, assume 50 custom × 300 KB ≈ 15 MB. 100 households ≈ 1.5 GB. Within Supabase free tier; revisit at growth.
- **Suggestion quality with thin libraries.** A household with 5 lunch recipes will see repeats every week. UI surfaces this; the answer is "add more recipes."
- **Family read-only is a UX deviation from foundations.** Foundations' `meal_modify` description implies family can override today's plan. Slice 2a parks that. Documented in §3 and §11.
- **Open: starter pack source of truth.** Maintaining starter recipes via migration files is awkward (every update is a migration). Slice 7 admin UI is the long-term answer; slice 2a accepts the friction.
- **Open: photo compression library choice.** `browser-image-compression` is the leading candidate (10k+ weekly downloads, MIT, no native deps). Final choice during implementation; alternatives include `compressorjs`.
