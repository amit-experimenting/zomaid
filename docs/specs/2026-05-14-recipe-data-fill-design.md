# Zomaid — Recipe Data Fill + YouTube — Design

> **Superseded as the living architecture doc for the recipes area by [`features/recipes.md`](features/recipes.md).** This dated spec is retained for historical context.

- **Date**: 2026-05-14
- **Status**: Approved (brainstorming) — pending implementation plan
- **Slice**: 1 of 3 in the recipes-and-allocation overhaul (this doc); follow-ups are slice 2 (inventory) and slice 3 (auto-allocation). Independent of the original 7-slice numbering used by foundations.
- **Owner**: dharni05@gmail.com
- **Depends on**: [2026-05-11 Slice 2a Recipes & Meal Plan Design](./2026-05-11-slice-2a-recipes-meal-plan-design.md)

## 1. Context

The starter pack shipped in slice 2a contains 30 recipe names with no ingredients, no steps, no photos, no prep time, no notes, and no video links. The detail page renders "INGREDIENTS" and "STEPS" headers above empty lists. This slice fills that data, doubles the Indian-cuisine coverage by adding 25 new starter recipes, and introduces a YouTube video link column on `recipes`. It also adds `recipes.default_servings` — a baseline serving count — so the future inventory deduction (slice 2) can scale ingredient quantities to actual people eating.

This is the first of three brainstorm cycles. Slice 2 will add the inventory subsystem (onboarding inventory entry, cook-deduct, bill OCR ingest into inventory). Slice 3 will replace the manual "Generate plan" button with on-view auto-allocation that filters by inventory availability and non-repeat history.

## 2. Decomposition (this brainstorm cycle)

| # | Slice | Status |
|---|---|---|
| 1 | Recipe data fill + YouTube + default_servings (this doc) | Designing |
| 2 | Inventory: table, onboarding entry, cook-deduct, bill OCR ingest | Pending — separate brainstorm |
| 3 | Auto-allocation on view, inventory-aware suggestion engine | Pending — separate brainstorm |

Order is dictated by hard dependencies. Slice 3 cannot filter by inventory until slice 2 ships, and slice 2 cannot deduct quantities until slice 1 ships ingredients with quantities + `default_servings`.

## 3. Decisions log (from brainstorming, 2026-05-14)

| Q | Decision |
|---|---|
| Starter pack scope | **Keep existing 30, add 25 net-new Indian** (the 5 already-Indian-ish names — Idli with Sambar, Roti Prata with Dhal, Vegetable Briyani, Dhal Curry with Roti, Chicken Curry with Rice — are filled in place rather than duplicated). Final library = 55 starter recipes, all populated. |
| Photo source | **Predictable per-recipe `photo_path` slug + static placeholder.** All starter rows ship with `photo_path = 'starter/<slug>.jpg'`. A shared placeholder at `/public/recipe-photo-placeholder.jpg` renders when the file 404s. Owner uploads real images to the public bucket at their own pace; no migration or redeploy per image. A manifest doc lists every expected upload path. |
| YouTube placement | **"Watch video" pill button** below the slot/prep line on the recipe detail page. Opens in a new tab. Hidden when `youtube_url` is null. No iframe, no embed, no inline player. |
| YouTube data | **Curated URLs in the seed migration** — every starter recipe gets a YouTube URL where a reasonable cooking video exists; null is acceptable when no good fit found. |
| Serving size model | **Single `recipes.default_servings` int column** (not null, default 4, bounded 1–20). All ingredient quantities are sized for this serving count. Slice 2 will scale linearly by `(people_today / default_servings)`. Per-ingredient scaling flags rejected as overkill for v1. |
| YouTube in recipe form | **Not in this slice.** Column ships; owner/maid editing UI is a follow-up after we see real seed data in production. |
| Data delivery | **Single SQL migration** following the existing `20260525_001_starter_pack_seed.sql` pattern (`update` existing 30 + `insert` 25 new + ingredients + steps). |

## 4. Schema changes

### 4.1 `recipes` — three new columns

```sql
alter table public.recipes
  add column youtube_url       text,
  add column default_servings  int not null default 4;

alter table public.recipes
  add constraint recipes_default_servings_range
    check (default_servings between 1 and 20);

alter table public.recipes
  add constraint recipes_youtube_url_https
    check (
      youtube_url is null
      or youtube_url ~ '^https://(www\.)?(youtube\.com/watch\?v=|youtu\.be/)[A-Za-z0-9_-]+'
    );
```

- `youtube_url`: nullable. Regex constraint restricts to canonical YouTube URLs (`youtube.com/watch?v=…` or `youtu.be/…`). This blocks arbitrary embed URLs and reduces the XSS surface should the field ever be rendered as an iframe.
- `default_servings`: not null with `default 4`. Existing 30 rows pick up the default automatically; the data-fill migration overrides per recipe where 4 isn't sensible (e.g. small breakfast items at 2).
- No backfill statement needed for `youtube_url` (nullable) or `default_servings` (default supplied).

No changes to `recipe_ingredients` or `recipe_steps` — they already have `quantity`, `unit`, `position`, and structured `instruction` text.

### 4.2 Migration filename

`supabase/migrations/20260605_001_recipes_schema_default_servings_video.sql`

Follows the existing `YYYYMMDD_NNN_descriptor.sql` convention. Date sequenced after the current latest migration (`20260604_001_meal_plan_family_modify.sql`).

## 5. Data delivery

### 5.1 Migration `20260605_002_recipes_starter_pack_data_fill.sql`

Single migration. Order of statements:

1. **`update public.recipes`** — for each of the existing 30 starter rows (keyed by `name`), set `youtube_url`, `default_servings`, `photo_path = 'starter/<slug>.jpg'`, `prep_time_minutes`, `notes`.
2. **`insert into public.recipes`** — 25 new Indian starter rows. `household_id = null`, `parent_recipe_id = null`, `created_by_profile_id = null`, all new columns populated. UUIDs derived deterministically from the slug via `md5(slug)::uuid` (cast through `uuid` to ensure idempotent re-runs).
3. **`insert into public.recipe_ingredients`** — all rows for the 55 starter recipes. Lookup parent `recipe_id` by `name` via a CTE. Position starts at 1 per recipe.
4. **`insert into public.recipe_steps`** — same shape, with `instruction` text.

Idempotency: the `update` statements are inherently idempotent (target by stable name). For `insert`, deterministic UUIDs combined with the existing `recipes_invariant` and `recipes_household_fork_unique` constraints make re-runs safe — a re-applied migration would conflict on primary key. Wrap the inserts in `on conflict (id) do nothing` for the recipe rows; ingredients and steps use `on conflict (recipe_id, position) do nothing` (the existing unique index).

Why one migration not two: simpler `pnpm db:reset`, atomic data update, matches the existing seed pattern. The schema change in section 4.1 is a separate migration only because it ships a constraint that must be in place before the data fill writes valid rows.

### 5.2 The 25 new Indian recipes

| Slot | Names |
|---|---|
| Breakfast (6) | Masala Dosa, Poha, Upma, Aloo Paratha, Medu Vada, Pongal |
| Lunch (7) | Rajma Chawal, Chole Bhature, Palak Paneer with Rice, Veg Pulao, Sambar Rice, Aloo Gobi with Roti, Curd Rice |
| Snacks (5) | Samosa, Pani Puri, Bhel Puri, Pakora, Masala Chai with Biscuits |
| Dinner (7) | Butter Chicken with Naan, Paneer Tikka Masala, Fish Curry, Mutton Rogan Josh, Baingan Bharta with Roti, Kadai Paneer, Egg Curry with Rice |

Final library after slice 1: 14 breakfast, 15 lunch, 11 snacks, 15 dinner = **55 starter recipes**.

### 5.3 Ingredient and step content quality bar

- Each recipe carries ≥4 ingredients and ≥3 steps. Ingredients have a numeric `quantity` and an English `unit` (`cup`, `tbsp`, `tsp`, `g`, `ml`, `piece`, `clove`, `pinch`). No null quantities in seed data — slice 2 deduction depends on numeric values.
- Quantities are sized for the row's `default_servings`. Most recipes are sized for 4 servings; very small items (e.g. masala chai) sized for 2.
- Steps are imperative, ≤120 characters each, ≤8 steps per recipe.
- Item names in `recipe_ingredients.item_name` are lowercase canonical English (`basmati rice`, not `Basmati Rice` or `Rice (Basmati)`). This becomes important in slice 2 when bill OCR items match against ingredient names — case-insensitive matching is already used by the shopping auto-add function ([20260527_001_shopping_auto_add_fn.sql:24](../../supabase/migrations/20260527_001_shopping_auto_add_fn.sql#L24)).

### 5.4 `photo_path` convention

All starter rows: `photo_path = 'starter/<slug>.jpg'` where `<slug>` is the recipe name lowercased, with every run of non-alphanumeric characters collapsed into a single hyphen, and leading/trailing hyphens trimmed.

- "Idli with Sambar" → `starter/idli-with-sambar.jpg`
- "Palak Paneer with Rice" → `starter/palak-paneer-with-rice.jpg`
- "Masala Chai with Biscuits" → `starter/masala-chai-with-biscuits.jpg`

The actual files do not need to exist when the migration runs. `<RecipePhoto>` (section 6.1) falls back to a static placeholder on `onError`.

## 6. UI changes

### 6.1 `src/components/recipes/recipe-photo.tsx` (new)

Client component. Props: `{ src: string | null; alt: string; className?: string }`. Renders an `<Image>` from `next/image` with `unoptimized` (Supabase public URLs aren't on the Next image optimizer allowlist). `onError` swaps `src` to `/recipe-photo-placeholder.jpg`. When the incoming `src` is null, renders the placeholder immediately.

Used in:
- `src/components/recipes/recipe-detail.tsx` (replaces the inline `<Image>` block in the hero)
- `src/components/recipes/recipe-card.tsx` (existing card photo)
- `src/app/plan/[date]/page.tsx` — the resolved `photoUrl` from the per-slot loop can flow through `<RecipePhoto>` for the TodayList rows where it's rendered

### 6.2 `src/components/recipes/recipe-detail.tsx` (edit)

After the slot/prep-time `<div>` and before the `<section>` for ingredients, insert a "Watch video" link when `youtube_url` is set:

```tsx
{youtubeUrl && (
  <a
    href={youtubeUrl}
    target="_blank"
    rel="noopener noreferrer"
    className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm text-red-600"
  >
    <PlayIcon className="size-3.5" />
    Watch video
  </a>
)}
```

`PlayIcon` from `lucide-react` (already a dependency — used elsewhere in `src/components/ui`). Props type for `RecipeDetailProps` gets a new `youtubeUrl: string | null` field. The page route (`src/app/recipes/[id]/page.tsx`) selects `youtube_url` from the recipe row and passes it down.

### 6.3 `public/recipe-photo-placeholder.jpg` (new)

One shared neutral placeholder image. Solid muted background with a small fork/knife icon. ~800×450 (16:9). ≤30 KB. Committed to the repo so dev environments work without bucket uploads.

### 6.4 `recipe-form.tsx` — explicit non-change

The form does **not** gain a YouTube URL input in this slice. The schema column ships; an editing UI is a follow-up. Households only see the column on starter recipes (which they cannot edit) until that follow-up. Custom household recipes created via the form will have `youtube_url = null`.

## 7. Image manifest

### 7.1 `docs/recipe-image-manifest.md` (new)

A single markdown document. Columns:

| # | Recipe name | Slot | Expected upload path | Suggested content |
|---|---|---|---|---|

55 rows. Top of the file contains a one-paragraph instructions block:

> Upload images via the Supabase dashboard at **Storage → recipe-images-public → starter/**. Use the exact filename in the "Expected upload path" column. Once uploaded, the image appears in the app on next page load — no migration or redeploy needed.

The manifest is the durable mapping. When you add more starter recipes later, this file gets updated alongside the seed migration.

## 8. Testing

### 8.1 `tests/db/recipes-seed.test.ts` (new) — vitest + local Supabase

Asserts on the seeded state:
- `select count(*) from recipes where household_id is null and archived_at is null` returns 55.
- Every starter row has `default_servings between 1 and 20`.
- Every starter row has ≥4 ingredients (`recipe_ingredients`) and ≥3 steps (`recipe_steps`).
- Every starter row's `photo_path` matches `^starter/[a-z0-9-]+\.jpg$`.
- Every non-null `youtube_url` matches the column-level regex.
- Every ingredient has a non-null `quantity` and a non-null `unit`.
- No two starter recipes share the same `name`.

### 8.2 `tests/e2e/recipes-detail.spec.ts` (new) — Playwright

Signs in as an owner with an active household. Navigates to `/recipes/<starter-recipe-id>` for a known starter (`Idli with Sambar`).
- Asserts title, slot label, and "Xm prep" line are visible.
- Asserts ingredient list contains ≥4 items and step list contains ≥3 items.
- Asserts the "Watch video" pill is present and its `href` points to a `youtube.com` or `youtu.be` URL.
- Forces an image 404 (use a recipe whose file isn't uploaded) and asserts the placeholder image is rendered.

### 8.3 No new unit tests for `<RecipePhoto>`

The `onError` fallback is too thin to warrant an isolated unit test. The e2e covers the placeholder swap end-to-end. If logic grows (lazy load, blur placeholder, etc.) we add a unit test then.

## 9. Risks and trade-offs

- **YouTube URL rot.** Seeded videos can be taken down. Acceptable — the link breaks, the rest of the recipe still works. We do not validate URLs at runtime; the column-level regex only enforces shape, not reachability. Curating videos is a one-time cost.
- **Image placeholder until user uploads.** Until the owner uploads 55 images, every recipe card shows the same generic photo. UX trade-off accepted in the brainstorm — the alternative (bundling 55 Unsplash binaries in the repo) is heavier and license-uncertain.
- **`default_servings = 4` is opinionated.** Some real households are 2 or 6. Slice 2 will scale, so this only affects the displayed "this recipe makes X servings" string (a future detail-page addition) — not correctness of deduction.
- **Idempotency depends on `name` stability.** The `update` statements key by `name`. If a future migration renames an existing starter recipe, the update lookup breaks. Mitigation: never rename starter rows once shipped; add new ones instead, archive old ones via `archived_at`.

## 10. Out of scope (explicit)

- Inventory table, onboarding entry flow, cook-deduct logic, bill-OCR-to-inventory writer → **slice 2**.
- On-view auto-allocation (replacing the "Generate plan for this day" button), inventory-aware suggestion engine, "haven't eaten in N days" rule extension → **slice 3**.
- Editing `youtube_url` in `recipe-form.tsx` (custom household recipes can't get YouTube links yet).
- Embedding YouTube videos in-page (iframe). Out-link only.
- Internationalized recipe names. English only.
- Per-ingredient scaling flags (`scales_with_servings`). Rejected as v1 overkill.
- Migration to backfill custom household recipes with default ingredients/steps. We only fill starter rows (`household_id is null`).
