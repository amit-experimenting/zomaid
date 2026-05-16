# Recipes — architecture

**Status:** active
**Last reviewed:** 2026-05-16

## Routes
| Route | File | Type |
| --- | --- | --- |
| `/recipes` | `src/app/recipes/page.tsx` | page |
| `/recipes` (loading skeleton) | `src/app/recipes/loading.tsx` | loading |
| `/recipes` (server actions) | `src/app/recipes/actions.ts` | server-actions |
| `/recipes/new` | `src/app/recipes/new/page.tsx` | page |
| `/recipes/[id]` | `src/app/recipes/[id]/page.tsx` | page |
| `/recipes/[id]/edit` | `src/app/recipes/[id]/edit/page.tsx` | page |

Note: `src/app/recipes/page.tsx` currently renders two views off the same route — the default `PlannedView` (per-day meal-plan slot rows) and `LibraryView` (the recipe catalog grid, reached via `?view=library`). The PlannedView half is the meal-plan surface and is described in `features/meal-plan.md`; the LibraryView half is the recipes catalog and is owned by this spec. Both halves still live in this one file.

## Server actions
| Action | File | Input shape | Output shape | Called by |
| --- | --- | --- | --- | --- |
| `createRecipe` | `src/app/recipes/actions.ts:89` | `FormData` parsed via `CreateRecipeSchema` (Zod): `{ name, slot, diet, prepTimeMinutes?, defaultServings?, notes?, ingredients[], steps[], youtubeUrl?, kcalPerServing?, carbsGPerServing?, fatGPerServing?, proteinGPerServing? }` plus optional `photoFile: File` (JPEG/PNG/WebP, ≤5 MB) | `RecipeActionResult<{ recipeId: string }>` (discriminated `ok` union; error codes include `RECIPE_INVALID`, `RECIPE_FORBIDDEN`, `RECIPE_PHOTO_TOO_LARGE`, `RECIPE_PHOTO_BAD_TYPE`) | `src/components/recipes/recipe-form.tsx` (mode=`create`) |
| `updateRecipe` | `src/app/recipes/actions.ts:168` | `FormData` parsed via `UpdateRecipeSchema` (partial of create + required `recipeId: uuid`); same nutrition + photo handling. If the target is a starter (`household_id IS NULL`) the action forks it into the household first (deep-copies ingredients/steps), then applies the patch to the fork. | `RecipeActionResult<{ recipeId: string }>` (`recipeId` is the fork's id when a fork was created) | `src/components/recipes/recipe-form.tsx` (mode=`edit`) |
| `addRecipeToTodayPlan` | `src/app/recipes/actions.ts:284` | `{ recipeId: string }`. Permission: owner / maid / `family_member`+`meal_modify`. Slot is read off the recipe and SG-today is computed via `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" })`. | `RecipeActionResult<{ planDate: string }>` (`YYYY-MM-DD`) | `src/components/recipes/add-to-today-button.tsx` |
| `archiveRecipe` | `src/app/recipes/actions.ts:329` | `{ recipeId: string }` | `RecipeActionResult<{ recipeId: string }>` | _(not yet wired into UI — see Open questions)_ |
| `unarchiveRecipe` | `src/app/recipes/actions.ts:338` | `{ recipeId: string }` | `RecipeActionResult<{ recipeId: string }>` | _(not yet wired into UI — see Open questions)_ |
| `hideStarterRecipe` | `src/app/recipes/actions.ts:347` | `{ recipeId: string }` (must be a starter, enforced by DB trigger `household_recipe_hides_check_starter`) | `RecipeActionResult<{ recipeId: string }>` | _(not yet wired into UI — see Open questions)_ |
| `unhideStarterRecipe` | `src/app/recipes/actions.ts:358` | `{ recipeId: string }` | `RecipeActionResult<{ recipeId: string }>` | _(not yet wired into UI — see Open questions)_ |

Every action calls `requireHousehold()` (from `src/lib/auth/require.ts`) to resolve the active Clerk session → profile → household before touching Supabase. Mutating actions call `revalidatePath("/recipes")` (and `revalidatePath("/plan")` / `revalidatePath("/recipes/${id}")` where relevant) so the catalog index and meal-plan surface re-render after the change.

## Components
| Component | File | Used by |
| --- | --- | --- |
| `RecipesIndex` (default) | `src/app/recipes/page.tsx` | Next.js route `/recipes` (dispatches to `PlannedView` or `LibraryView` internal subcomponents based on `?view`) |
| `RecipesLoading` (default) | `src/app/recipes/loading.tsx` | Next.js suspense for `/recipes` |
| `NewRecipePage` (default) | `src/app/recipes/new/page.tsx` | Next.js route `/recipes/new` |
| `RecipePage` (default) | `src/app/recipes/[id]/page.tsx` | Next.js route `/recipes/[id]` |
| `EditRecipePage` (default) | `src/app/recipes/[id]/edit/page.tsx` | Next.js route `/recipes/[id]/edit` |
| `RecipeCard` | `src/components/recipes/recipe-card.tsx` | `src/app/recipes/page.tsx` (LibraryView grid) |
| `RecipeDetail` | `src/components/recipes/recipe-detail.tsx` | `src/app/recipes/[id]/page.tsx` |
| `RecipeForm` | `src/components/recipes/recipe-form.tsx` | `src/app/recipes/new/page.tsx`, `src/app/recipes/[id]/edit/page.tsx` |
| `RecipePhoto` | `src/components/recipes/recipe-photo.tsx` | `RecipeCard`, `RecipeDetail`, `src/components/plan/slot-row.tsx` (meal-plan slot avatar — cross-feature reuse) |
| `AddToTodayButton` | `src/components/recipes/add-to-today-button.tsx` | `RecipeCard` (calls `addRecipeToTodayPlan`, then routes to `/plan/<today>`) |
| `MainNav` | `src/components/site/main-nav.tsx` | All four recipes routes + the loading skeleton (shared site chrome) |

Cross-feature components rendered alongside the catalog but owned elsewhere: `DayStrip`, `SlotRow`, `SlotActionSheet` (all in the PlannedView half of `page.tsx`) belong to `features/meal-plan.md`.

## DB surface
| Object | Kind | Introduced in | Notes |
| --- | --- | --- | --- |
| `recipes` | table | `20260517_001_recipes.sql` | Catalog row. Tri-state shape gated by `recipes_invariant` CHECK: starter (`household_id IS NULL`, no parent, no creator); household custom (household + creator, no parent); fork (household + creator + parent). Unique `(household_id, parent_recipe_id)` prevents duplicate forks of the same starter. RLS: starters readable to any authenticated user; household rows scoped to active members; writes restricted to active owner/maid via `is_active_owner_or_maid()`. |
| `recipes.archived_at` | column | `20260517_001_recipes.sql` | Soft-delete timestamp; `effective_recipes` filters out archived rows. Set/cleared by `archiveRecipe` / `unarchiveRecipe`. |
| `recipes.default_servings` | column | `20260605_001_recipes_schema_default_servings_video.sql` | NOT NULL, default 4, CHECK 1–20. Used by meal-plan inventory scaling. |
| `recipes.youtube_url` | column | `20260605_001_recipes_schema_default_servings_video.sql` | Nullable; CHECK constrains shape to `https://(www.)?(youtube.com/watch?v=…\|youtu.be/…)`. The action layer enforces the same regex via Zod (`YoutubeUrlSchema`). |
| `recipes.diet` | column | `20260624_001_diet_preferences.sql` (default added by `20260625_001_recipes_diet_default.sql`) | NOT NULL `public.diet` enum. Recipes form lets the author pick; defaults to `non_vegetarian` for inserts that omit it. Planner-side filtering on this column lives in `features/meal-plan.md`. |
| `recipes.kcal_per_serving`, `carbs_g_per_serving`, `fat_g_per_serving`, `protein_g_per_serving` | columns | `20260702_001_recipe_nutrition.sql` | Nullable per-serving nutrition; non-negative CHECKs. Populated for starters by `20260703_001_starter_recipe_nutrition_fill.sql` then recomputed from ingredient lists by `20260704_001_starter_recipe_nutrition_recompute.sql`. Returned as PostgREST strings — recipe routes coerce via `Number(...)` before rendering. |
| `meal_slot` | enum | `20260517_001_recipes.sql` | values: `breakfast`, `lunch`, `snacks`, `dinner` |
| `diet` | enum | `20260624_001_diet_preferences.sql` | values: `vegan`, `vegetarian`, `eggitarian`, `non_vegetarian` |
| `recipe_ingredients` | table | `20260518_001_recipe_subtables.sql` | `(recipe_id, position)` unique; cascading delete from `recipes`. RLS piggy-backs on parent recipe visibility. `createRecipe` / `updateRecipe` insert positional rows; `updateRecipe` does a delete-then-reinsert when the ingredients array is submitted. |
| `recipe_steps` | table | `20260518_001_recipe_subtables.sql` | Same pattern as `recipe_ingredients` (positional, cascading delete, RLS via parent). |
| `household_recipe_hides` | table | `20260519_001_household_recipe_hides.sql` | Per-household soft-hide of starter recipes. Composite PK `(household_id, recipe_id)`. Trigger `household_recipe_hides_check_starter` rejects inserts where the target recipe has a non-null `household_id` (only starters can be hidden). Written by `hideStarterRecipe` / `unhideStarterRecipe`. |
| `effective_recipes(p_household uuid)` | RPC (view-like) | `20260521_001_effective_recipes.sql` (rewritten by `20260624_001_diet_preferences.sql` to add diet filtering) | Single source of truth for "what recipes does this household see": starters minus (already-forked-by-this-household ∪ hidden-by-this-household), plus household-owned rows, all `archived_at IS NULL`, all filtered by the household's strictest member diet via `household_strictest_diet(p_household)`. Called by the recipes LibraryView for the catalog grid. The PlannedView half of the same file and the meal-planner consume the same RPC for picker/autofill — see `features/meal-plan.md`. |
| `recipe-images-public` | storage bucket | `20260524_001_recipe_storage.sql` | Public-read; service-role-only write. Holds starter-pack photos (`starter/<slug>.jpg`). All starter `photo_path` values were nulled by `20260701_001_clear_starter_photo_paths.sql` because the uploads never landed; current starter cards render the deterministic SVG placeholder from `RecipePhoto`. |
| `recipe-images-household` | storage bucket | `20260524_001_recipe_storage.sql` | Private; path layout `<household_id>/<recipe_id>.<ext>` (jpg/png/webp). RLS reads gated by `has_active_membership`; writes by `is_active_owner_or_maid` keyed off the first path segment. `createRecipe` / `updateRecipe` upsert here; `getSignedUrl(path, 3600)` is used by all reads (recipes index, detail, planner slot rows). |
| Starter-pack seed | data migrations | `20260525_001_starter_pack_seed.sql`, `20260606_001_recipes_starter_pack_data_fill.sql`, `20260621_001_starter_pack_video_url_fixes.sql`, `20260701_001_clear_starter_photo_paths.sql`, `20260702_001_recipe_nutrition.sql`, `20260703_001_starter_recipe_nutrition_fill.sql`, `20260704_001_starter_recipe_nutrition_recompute.sql` | 30 SG starter rows then 25 Indian additions (55 total), populated with ingredients/steps/prep time/video URL/per-serving nutrition. Diet column backfilled by `20260624_001_diet_preferences.sql` (`WITH classification(...)` block). All starter rows have `household_id IS NULL`. |
| `is_active_owner_or_maid(uuid)` | RPC | `20260517_001_recipes.sql` | Helper used in RLS policies on `recipes`, `recipe_ingredients`, `recipe_steps`, `household_recipe_hides`, and the household-bucket storage policies. Returns true if the calling JWT subject maps to an active owner-or-maid membership of the household. |
| `mealplan_set_slot(p_date, p_slot, p_recipe_id)` | RPC | `20260522_001_meal_plan_rpcs.sql` (extended by `20260604_001_meal_plan_family_modify.sql`) | Called by `addRecipeToTodayPlan` to pin the recipe into today's slot. The RPC itself is owned by `features/meal-plan.md` — listed here only because the recipes action consumes it. |

## External integrations
- **Clerk:** every recipes route and server action authenticates via `requireHousehold()` (`src/lib/auth/require.ts`), which resolves the Clerk session → `profiles` → active `household_memberships` row and exposes the resulting `ctx.household`, `ctx.profile`, `ctx.membership` to callers. Permission checks on `addRecipeToTodayPlan` and the canEdit gate on `RecipePage` read `ctx.membership.role` / `ctx.membership.privilege` directly.
- **Supabase:**
  - RLS-scoped server client (`createClient` from `src/lib/supabase/server.ts`) for every read and write — recipe CRUD, ingredient/step writes, `effective_recipes` RPC, `mealplan_set_slot` RPC, photo upload and signed-URL generation.
  - Two storage buckets: `recipe-images-public` (starter photos — currently empty, paths nulled) read via `getPublicUrl(path)`; `recipe-images-household` (user uploads at `<household_id>/<recipe_id>.<ext>`) read via `createSignedUrl(path, 3600)` and written via `upload(path, file, { upsert: true })`.
  - No service-role usage in this feature; all writes ride caller RLS.
- **`browser-image-compression`** (npm): client-only dependency used by `RecipeForm.compressAndSet` to downscale to `maxSizeMB: 1`, `maxWidthOrHeight: 1920` before the upload hits the action. The 5 MB / `image/(jpeg|png|webp)` server-side validation in `validatePhoto` is the authoritative limit; the compressor is a UX optimisation to make uploads faster, not a security boundary.
- **YouTube:** `youtube_url` is stored as a plain `text` URL with a regex CHECK (`youtube.com/watch?v=…` or `youtu.be/…`). The UI links out with `target="_blank" rel="noopener noreferrer"`; no embed/iframe is rendered today. The 2026-05-14 oEmbed audit that fixed broken starter URLs is captured in `20260621_001_starter_pack_video_url_fixes.sql` — there is no runtime call to the oEmbed API.

## Open questions
- The four soft-state actions (`archiveRecipe`, `unarchiveRecipe`, `hideStarterRecipe`, `unhideStarterRecipe`) are exported and database-backed but no UI calls them yet. `effective_recipes` already filters on `archived_at IS NULL` and `household_recipe_hides`, so the back end is ready — but there is no entry point in `RecipeCard`, `RecipeDetail`, or `RecipeForm` for a user to trigger an archive or a starter-hide. Either wire these into the detail view's overflow menu, or remove them if the product direction has changed.

## Test coverage

| Code unit | File | Unit | Integration | E2E | Priority gap | Recommended test type |
| --- | --- | --- | --- | --- | --- | --- |
| `addRecipeToTodayPlan` | `src/app/recipes/actions.ts:284` | — | — | — | high | `tests/actions/` |
| `createRecipe` | `src/app/recipes/actions.ts:89` | — | — | — | high | `tests/actions/` |
| `updateRecipe` | `src/app/recipes/actions.ts:168` | — | — | — | high | `tests/actions/` |
| `archiveRecipe` | `src/app/recipes/actions.ts:329` | — | — | — | medium | `tests/actions/` |
| `hideStarterRecipe` | `src/app/recipes/actions.ts:347` | — | — | — | medium | `tests/actions/` |
| `unarchiveRecipe` | `src/app/recipes/actions.ts:338` | — | — | — | medium | `tests/actions/` |
| `unhideStarterRecipe` | `src/app/recipes/actions.ts:358` | — | — | — | medium | `tests/actions/` |
| `household_recipe_hides_check_starter` trigger | `supabase/migrations/20260519_001_household_recipe_hides.sql` | — | — | — | medium | `tests/db/` |
| `EditRecipePage` (`/recipes/[id]/edit` route) | `src/app/recipes/[id]/edit/page.tsx` | — | — | — | medium | `tests/e2e/` |
| `NewRecipePage` (`/recipes/new` route) | `src/app/recipes/new/page.tsx` | — | — | — | medium | `tests/e2e/` |
| `RecipePage` (`/recipes/[id]` route) | `src/app/recipes/[id]/page.tsx` | — | — | — | medium | `tests/e2e/` |
| `RecipesIndex` (`/recipes` LibraryView) | `src/app/recipes/page.tsx` | — | — | `tests/e2e/recipes-plan.spec.ts` (unauthenticated redirect only) | medium | `tests/e2e/` |
| `is_active_owner_or_maid(uuid)` | `supabase/migrations/20260517_001_recipes.sql` | — | — | — | low | `tests/db/` |
| `effective_recipes(p_household uuid)` | `supabase/migrations/20260521_001_effective_recipes.sql` (rewritten by `20260624_001_diet_preferences.sql`) | — | `tests/db/household-diet-preference.test.ts` | — | none | `tests/db/` |
| Starter pack seed integrity | `supabase/migrations/20260525_001_starter_pack_seed.sql` + follow-ups | — | `tests/db/recipes-seed.test.ts` | — | none | `tests/db/` |
