# Meal plan — architecture

**Status:** active
**Last reviewed:** 2026-05-16

## Routes
| Route | File | Type |
| --- | --- | --- |
| `/plan` | `src/app/plan/page.tsx` | page (redirect → `/recipes`) |
| `/plan/[date]` | `src/app/plan/[date]/page.tsx` | page (redirect → `/recipes?date=…`) |
| `/plan` (server actions) | `src/app/plan/actions.ts` | server-actions |

Note: the per-day meal-plan surface no longer lives under `/plan/*`. After the "merge home / rename Recipes to Meal" refactor, the live UI is the `PlannedView` subcomponent inside `src/app/recipes/page.tsx` (default render when `?view` is absent). The two `/plan/*` page files are thin `redirect()` shims that preserve old bookmarks and push-notification deep links. The server actions in `src/app/plan/actions.ts` were not moved — `PlannedView` and the planner components still import them from `@/app/plan/actions`.

## Server actions
| Action | File | Input shape | Output shape | Called by |
| --- | --- | --- | --- | --- |
| `setMealPlanSlot` | `src/app/plan/actions.ts:21` | `{ planDate: 'YYYY-MM-DD', slot: 'breakfast'\|'lunch'\|'snacks'\|'dinner', recipeId: uuid \| null }` (Zod `SetSchema`) | `PlanActionResult<{ recipeId: string \| null }>` (discriminated `ok` union; error codes `PLAN_INVALID`, `PLAN_LOCKED`, `PLAN_FORBIDDEN`) | `src/components/plan/slot-action-sheet.tsx` ("Pick different" + "Clear" buttons) |
| `regenerateMealPlanSlot` | `src/app/plan/actions.ts:47` | `{ planDate, slot }` (Zod `RegenerateSchema`) | `PlanActionResult<{ recipeId: string \| null }>` — extra `MEAL_PLAN_NO_ELIGIBLE_RECIPE` error when the scored-eligible set is empty | `src/components/plan/slot-action-sheet.tsx` ("Regenerate" button) |
| `setPeopleEating` | `src/app/plan/actions.ts:76` | `{ planDate, slot, people: int 1–50 }` (Zod `PeopleEatingSchema`) | `PlanActionResult<{ recipeId: string \| null; peopleEating: number }>` | `src/components/plan/people-pill.tsx` |

All three actions call `requireHousehold()` (`src/lib/auth/require.ts`) to resolve the active Clerk session → profile → household, then invoke a Supabase RPC under caller RLS. Lock/permission errors surfaced from the RPCs are mapped to `PLAN_LOCKED` / `PLAN_FORBIDDEN` so the UI can show inline copy without parsing Postgres messages. `setMealPlanSlot` and `regenerateMealPlanSlot` `revalidatePath("/plan")` and `revalidatePath('/plan/${planDate}')`; `setPeopleEating` revalidates only the dated path. Note: these still point at the legacy `/plan/*` paths even though the live surface is now `/recipes` — see Open questions.

## Components
| Component | File | Used by |
| --- | --- | --- |
| `PlanIndex` (default) | `src/app/plan/page.tsx` | Next.js route `/plan` — redirect-only |
| `PlanForDate` (default) | `src/app/plan/[date]/page.tsx` | Next.js route `/plan/[date]` — redirect-only |
| `PlannedView` (internal) | `src/app/recipes/page.tsx:64` | Rendered by the `/recipes` route's default branch (i.e. when `?view` is not `library`). This is the planner surface — owned by this spec even though it lives under `src/app/recipes/`. See Open questions. |
| `SlotRow` | `src/components/plan/slot-row.tsx` | `PlannedView` (rendered inside `SlotActionSheet`'s `trigger`) |
| `SlotActionSheet` | `src/components/plan/slot-action-sheet.tsx` | `PlannedView` (one per slot) |
| `RecipePicker` | `src/components/plan/recipe-picker.tsx` | `SlotActionSheet` ("Pick different" dialog) |
| `PeoplePill` | `src/components/plan/people-pill.tsx` | `SlotRow` (inline edit of the per-slot people-eating override) |
| `SlotWarningBadge` | `src/components/plan/slot-warning-badge.tsx` | `SlotRow` (renders the cook-deduct warnings stored in `meal_plans.deduction_warnings`) |

Cross-feature reuse worth noting:
- `RecipePhoto` (`src/components/recipes/recipe-photo.tsx`) is imported by `SlotRow` for the per-slot avatar — owned by `features/recipes.md`.
- `MainNav` and `DayStrip` are shared site chrome; both are rendered by `PlannedView` but neither is planner-owned.

## DB surface
| Object | Kind | Introduced in | Notes |
| --- | --- | --- | --- |
| `meal_plans` | table | `20260520_001_meal_plans.sql` | One row per `(household_id, plan_date, slot)`. `recipe_id` may be NULL (explicit clear or autofill-tried-no-candidate). `set_by_profile_id` NULL ⇒ system-set (autofill / cron); non-NULL ⇒ user override. Indexes on `(household_id, plan_date DESC)` and `(household_id, slot, plan_date DESC)`. RLS read = `has_active_membership(household_id)`; write policies are replaced by `20260604_001_meal_plan_family_modify.sql` (see below). |
| `meal_plans.people_eating` | column | `20260611_001_inventory_column_additions.sql` | Nullable int 1–50 — per-slot roster override. NULL means "fall back to current `household_roster_size()`". Read by `mealplan_recipe_stock_score` and `inventory_cook_deduct`; written by `mealplan_set_people_eating` (and surfaced in UI by `PeoplePill`). |
| `meal_plans.cooked_at` | column | `20260611_001_inventory_column_additions.sql` | Set by `inventory_cook_deduct`. Treated by the autofill RPC as "do not overwrite" — once `cooked_at IS NOT NULL` the slot is frozen regardless of `recipe_id`. |
| `meal_plans.deduction_status` | column | `20260611_001_inventory_column_additions.sql` | `meal_deduction_status` enum (`pending` / `deducted` / `skipped` / `partial`). Used by the inventory cron sweep (not by planner UI) and by the null-recipe cleanup. Partial-index `meal_plans_pending_deduction_idx` on `(household_id, plan_date) WHERE deduction_status = 'pending'`. |
| `meal_plans.deduction_warnings` | column | `20260611_001_inventory_column_additions.sql` | `jsonb` array of `{item_name, requested_qty, deducted_qty, unit, reason}` populated by `inventory_cook_deduct`. Read by the planner via `SlotWarningBadge` to surface short / unconvertible / missing-stock incidents. |
| `meal_slot` | enum | `20260517_001_recipes.sql` | values: `breakfast`, `lunch`, `snacks`, `dinner`. Shared with `recipes.slot` and `household_meal_times.slot`. |
| `meal_deduction_status` | enum | `20260611_001_inventory_column_additions.sql` | values: `pending`, `deducted`, `skipped`, `partial`. |
| `household_meal_times` | table | `20260609_001_household_meal_times.sql` | `(household_id, slot)` PK → `meal_time time`. Consulted by `is_meal_slot_locked` to compute the "T-1 hour" lock window. Seeded on household insert via the `households_seed_meal_times` trigger (08:00 / 13:00 / 17:00 / 20:00 SGT). Owned by household settings, included here because the planner reads it directly in `PlannedView` to render the per-slot `(locked)` badge. |
| `current_household_id_for_caller()` | RPC (helper) | `20260522_001_meal_plan_rpcs.sql` | Resolves the most-recent active membership for the JWT subject. Called inside every `mealplan_*` RPC to scope writes. |
| `mealplan_set_slot(p_date, p_slot, p_recipe_id)` | RPC | `20260522_001_meal_plan_rpcs.sql` (lock check added by `20260618_001_meal_plan_inventory_rpcs.sql`) | Upsert one slot. Raises `cannot_modify_after_lock` if the slot is within its 1-hour lock window. RLS on `meal_plans.insert/update` enforces the family-modify permission gate. Called by `setMealPlanSlot` and by `addRecipeToTodayPlan` in `features/recipes.md`. |
| `mealplan_regenerate_slot(p_date, p_slot)` | RPC | `20260522_001_meal_plan_rpcs.sql` (replaced by `20260620_001_mealplan_autofill.sql` to use stock scoring) | Pick a recipe for one slot via the autofill scoring path: eligible = `effective_recipes(household).slot = p_slot` minus the recipes used in the same slot in the prior 4 days; if max stock-score ≥ 0.5 pick the top-scorer (random tiebreak), else pick a random eligible; if no eligible at all the slot ends up `recipe_id = NULL` (action layer surfaces `MEAL_PLAN_NO_ELIGIBLE_RECIPE`). Same lock check as `mealplan_set_slot`. |
| `mealplan_set_people_eating(p_date, p_slot, p_people)` | RPC | `20260618_001_meal_plan_inventory_rpcs.sql` | Writes the per-slot people-eating override. Explicit `can_modify_meal_plan` check + lock check inside the function body (security invoker, but the check is duplicated so the error surfaces with the same code path as the other RPCs). |
| `is_meal_slot_locked(p_household, p_date, p_slot)` | RPC (helper) | `20260618_001_meal_plan_inventory_rpcs.sql` | Returns true once `now() ≥ slotStart − 1h`. Used by all three planner write RPCs and by `mealplan_autofill_date_for_household` to skip locked slots. |
| `can_modify_meal_plan(p_household)` | RPC (helper) | `20260604_001_meal_plan_family_modify.sql` | `security definer`. Returns true for active owner/maid memberships, or for family_member with privilege in `('full', 'meal_modify')`. Used in the replacement `meal_plans_insert/update/delete` RLS policies and explicitly inside `mealplan_set_people_eating` and `mealplan_autofill_date`. The same predicate is mirrored in TypeScript inside `PlannedView` (`mealPlanReadOnly = role === 'family_member' && privilege === 'view_only'`) to hide the action buttons before the user clicks; the RPC + RLS are the authoritative check. |
| `mealplan_recipe_stock_score(p_household, p_recipe_id, p_people)` | RPC (helper) | `20260620_001_mealplan_autofill.sql` | `security definer`. Returns a `[0,1]` fraction = scaled-ingredient-in-stock count / total ingredient count. Drives the candidate ranking inside `mealplan_regenerate_slot` and `mealplan_autofill_date_for_household`. Returns `0` for recipes with no ingredients (those never win the ≥ 0.5 threshold but can still be picked in the fallback random path). |
| `mealplan_autofill_date_for_household(p_household, p_date)` | RPC | `20260620_001_mealplan_autofill.sql` | `security definer`. Per-slot worker. Skips locked slots and slots where `recipe_id IS NOT NULL` OR `cooked_at IS NOT NULL`. Resolves effective people-eating, scores eligible candidates, upserts via `ON CONFLICT … DO UPDATE … WHERE meal_plans.recipe_id IS NULL AND meal_plans.cooked_at IS NULL` so a manual override or already-cooked slot is never clobbered. Returns the number of slots actually filled. `revoke from public; grant to postgres` — only the wrappers below call it. |
| `mealplan_autofill_date(p_date)` | RPC | `20260620_001_mealplan_autofill.sql` | User-facing wrapper. Resolves household from JWT, requires `can_modify_meal_plan`, then delegates. Invoked from `PlannedView` on every render where `selectedYmd >= todayYmd` and the caller is not read-only — this is the "on-view autofill" path. |
| `mealplan_suggest_for_date(p_date)` | RPC | `20260522_001_meal_plan_rpcs.sql` (rewritten by `20260620_001_mealplan_autofill.sql` to delegate to the autofill worker) | Cron entry point. Loops every active household and calls `mealplan_autofill_date_for_household`. `revoke from public; grant to postgres`. |
| `mealplan-suggest-tomorrow` cron job | pg_cron schedule | `20260523_001_meal_plan_cron.sql` | `0 22 * * *` SGT — invokes `mealplan_suggest_for_date(current_date + 1)`. Uses `cron.unschedule` first so the migration is idempotent. |
| (cleanup) orphan null-recipe purge | data migration | `20260619_001_meal_plan_null_recipe_cleanup.sql` | One-time `DELETE FROM meal_plans WHERE recipe_id IS NULL AND people_eating IS NULL AND cooked_at IS NULL AND deduction_status = 'pending'`. Pre-condition for the autofill RPC's conditional upsert (so a fresh INSERT or a same-row UPDATE both behave correctly). No runtime code path touches this. |
| `inventory_cook_deduct(p_meal_plan_id)` | RPC | `20260614_001_inventory_cook_deduct.sql` | Owned by inventory, listed here because it is the writer of `meal_plans.cooked_at`, `deduction_status`, and `deduction_warnings` — all three are read by `PlannedView` / `SlotWarningBadge`. The planner does not invoke this RPC directly; the inventory cron sweep (`20260615_001_inventory_sweep_cron.sql`) does. |
| `effective_recipes(p_household)` | RPC | defined in `features/recipes.md` | Consumed by the planner in three places: (1) `PlannedView` calls it directly to build the `RecipePicker` candidate list; (2) `mealplan_regenerate_slot` calls it inside the candidate CTE; (3) `mealplan_autofill_date_for_household` calls it inside the candidate CTE. Diet filtering, archive filtering, hide filtering, and starter/custom/fork unification are all handled by the RPC — the planner takes its result as the source of truth. |

## External integrations
- **Clerk:** JWT subject is read inside `current_household_id_for_caller()` (and via `requireHousehold()` in every server action) to scope every RPC to the caller's active household.
- **Supabase:** server client (`createClient` from `src/lib/supabase/server.ts`, RLS as caller) for all reads and write RPCs from `PlannedView` and the three planner actions. No service-role usage in the planner runtime path; the cron job runs as `postgres` (the `mealplan-suggest-tomorrow` schedule and `mealplan_autofill_date_for_household` both rely on that to bypass `auth.jwt()` resolution).
- **pg_cron:** the `mealplan-suggest-tomorrow` job (22:00 SGT nightly, registered in `20260523_001_meal_plan_cron.sql`) is the only cron driver the planner owns. Inventory's own sweep cron (`20260615_001_inventory_sweep_cron.sql`) is what eventually writes back to `meal_plans.deduction_*`.

## Open questions
- **PlannedView placement.** The planner's primary UI lives at `src/app/recipes/page.tsx:64` (the default branch when `?view` is not `library`). It was placed there during the "merge home / rename Recipes to Meal" refactor so the route URL could be `/recipes` without splitting the file structure. The component is purely planner concerns (slot rows, autofill kickoff, people-pill, lock badges) and could be lifted to e.g. `src/components/plan/planned-view.tsx` so `src/app/recipes/page.tsx` becomes a thin dispatcher. `features/recipes.md` already flagged this; recording here that this spec is the canonical owner.
- **`revalidatePath` targets are stale.** All three actions revalidate `/plan` and `/plan/[date]`, but those routes are now redirect-only — the live surface is `/recipes` (no params) and `/recipes?date=…`. Mutations still appear to work because the user is redirected through `/plan/*` once and then sees fresh data via the on-view autofill + the `PlannedView` SSR fetch, but the cache-invalidation hint is pointing at the wrong path. Worth a follow-up to re-target `revalidatePath("/recipes")`.
- **Pre-autofill `mealplan_suggest_for_date` left in place.** The cron-only wrapper still exists for the `mealplan-suggest-tomorrow` job and now just loops households and calls the per-household worker. That's fine; flag here only so future audits don't confuse the two entry points (`mealplan_autofill_date` = user/on-view, `mealplan_suggest_for_date` = cron).

## Test coverage
_To be filled in Phase 2._
