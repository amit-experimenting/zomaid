# Recipe edit form: video URL field + starter-pack URL audit

Date: 2026-05-14

## Problem

Two issues reported by the user:

1. The recipe edit form has no field for a video URL, so the existing
   `recipes.youtube_url` column can only be populated via SQL.
2. At least one starter-pack recipe (Kaya Toast with Soft-Boiled Eggs) points
   to a YouTube video that returns "This video isn't available anymore". We
   need to verify all starter-pack URLs and remove the broken ones.

Multi-URL support is explicitly deferred to a later spec.

## Scope

In scope:

- Add a single optional **Video URL** input to the recipe form, wired through
  `createRecipe` / `updateRecipe`. Available on both create and edit pages.
- Server-side validation that the value either matches the existing YouTube
  regex (same as the DB CHECK constraint) or is empty/null.
- Audit every starter-pack `youtube_url` via the YouTube oEmbed endpoint and
  write a migration that sets the broken ones to `null`.

Out of scope (deferred):

- Multiple URLs per recipe.
- Non-YouTube URL platforms (Vimeo, Instagram, etc.).
- Per-URL labels.
- Automatic replacement of broken videos with new ones.

## Changes

### Schema

No DB schema changes. The existing `recipes.youtube_url` column and its
`recipes_youtube_url_https` CHECK constraint
(see [supabase/migrations/20260605_001_recipes_schema_default_servings_video.sql](../../supabase/migrations/20260605_001_recipes_schema_default_servings_video.sql))
already satisfy the requirements.

### Server action ([src/app/recipes/actions.ts](../../src/app/recipes/actions.ts))

- Extend `CreateRecipeSchema` and (via `.partial()`) `UpdateRecipeSchema` with:

  ```ts
  youtubeUrl: z
    .string()
    .regex(/^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[A-Za-z0-9_-]+/)
    .optional()
    .nullable(),
  ```

  Regex mirrors the DB CHECK so failures surface in the form rather than as a
  500 from Postgres.

- `createRecipe`: read `youtubeUrl` from `FormData`. Treat empty string as
  `null`. Pass `youtube_url: parsed.data.youtubeUrl ?? null` into the
  `recipes.insert(...)` payload.

- `updateRecipe`: read the same way. If the field was submitted (key present
  in FormData), include it in the `patch` object; `undefined` means "don't
  touch". Empty string → `null` (i.e., clearing the URL is supported).

### Form ([src/components/recipes/recipe-form.tsx](../../src/components/recipes/recipe-form.tsx))

- Add `youtubeUrl?: string | null` to `RecipeFormProps["initial"]`.
- New `youtubeUrl` state (`useState(initial?.youtubeUrl ?? "")`).
- Render a `<Label>` + `<Input type="url">` between Prep time and Ingredients,
  with `placeholder="https://www.youtube.com/watch?v=..."`.
- On submit, always append `youtubeUrl` to the FormData (empty string is
  meaningful — it means "clear it"). Server treats `""` as `null`.

### Edit page ([src/app/recipes/[id]/edit/page.tsx](../../src/app/recipes/[id]/edit/page.tsx))

- Add `youtube_url` to the `select(...)` call.
- Pass `youtubeUrl: r.youtube_url` into the form's `initial` prop.

Create page ([src/app/recipes/new/page.tsx](../../src/app/recipes/new/page.tsx))
already passes no `initial`; the form's `useState(initial?.youtubeUrl ?? "")`
fallback covers it.

### Detail view

No change. The single-URL "Watch video" pill already exists.

### Starter-pack URL audit

A one-off Node script (`/tmp/audit-youtube-urls.mjs`) reads the starter-pack
migration, extracts every `(recipe_name, youtube_url)` pair from both Section
A (`UPDATE`) and Section B (`INSERT ... VALUES`), and probes each URL via
`https://www.youtube.com/oembed?url=<URL>&format=json` with up to 3 retries.
HTTP 200 means the video is public and embeddable; 404 means removed (or the
video ID was never real).

The audit output is the source of truth for the fix migration below — we are
NOT guessing which URLs are bad.

**Audit result (run 2026-05-14):** 48 of 50 starter URLs returned HTTP 404.
Only two survive:

- `Fried Rice with Egg` — `https://www.youtube.com/watch?v=qH__o17xHls`
- `Butter Chicken with Naan` — `https://www.youtube.com/watch?v=a03U45jFxOI`

The other 48 video IDs appear to have been hallucinated when the starter-pack
data-fill migration was authored. The fix migration nulls all 48.

### Fix migration

New file `supabase/migrations/<date>_001_starter_pack_video_url_fixes.sql`
(date assigned at implementation time, after the last existing migration). It:

- Lists the original broken video IDs as a SQL comment so the migration is
  auditable.
- For each broken recipe, sets `youtube_url` to a **verified working
  replacement URL** discovered via web search and confirmed via the same
  oEmbed probe used in the audit (HTTP 200 = embeddable).
- Replacement criteria:
  1. Real, public, embeddable YouTube video that returns HTTP 200 from
     `https://www.youtube.com/oembed?url=...&format=json`.
  2. Clearly matches the dish (recipe name + cuisine).
  3. Prefer well-known cooking channels and high view counts when available.
- Keyed by `name` with `household_id is null`. Idempotent (re-running sets the
  same value).
- Replacements are sourced by spawning parallel research agents to keep this
  tractable for 48 entries.

## Validation

- App-layer: zod regex on `youtubeUrl` matches the DB CHECK constraint, so
  invalid URLs are rejected with a form error instead of a DB exception.
- DB-layer: existing `recipes_youtube_url_https` constraint still applies.
- Cleared values: submitting an empty string sets the column to `null`,
  which trivially satisfies the CHECK (CHECK allows `null`).

## Testing

- `pnpm test` / `npm test`: existing suite should still pass with no semantic
  changes.
- Update [tests/db/recipes-seed.test.ts](../../tests/db/recipes-seed.test.ts)
  only if it asserts on specific URLs that the fix migration changes (otherwise
  no test change needed).
- Manual browser check (per AGENTS.md): open `/recipes/<id>/edit` for a
  starter recipe, confirm the URL field is prefilled, edit it, save, and
  verify the detail page shows the new "Watch video" link.

## Risks / open questions

- **DB CHECK already enforces YouTube-only.** If we later add Vimeo support,
  we'll need to relax that constraint at the same time we relax the zod regex.
- **oEmbed false negatives.** Some videos can be public but block embedding
  via owner setting, returning 401. We treat these as "bad" and null them
  out — the user-facing intent is "watch the video", and a non-embeddable
  video usually still plays via the canonical YouTube URL. **Mitigation:** if
  the audit nulls a video the user knows is fine, they can re-add it via the
  new edit form.
