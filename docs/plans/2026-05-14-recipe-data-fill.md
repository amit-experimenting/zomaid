# Recipe Data Fill + YouTube — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill every empty starter recipe with structured ingredients, steps, prep time, photo path, and (where curated) a YouTube URL; add 25 net-new Indian starter recipes; introduce `recipes.youtube_url` and `recipes.default_servings` so the future inventory-deduction subsystem can scale by people-eating; ship a placeholder photo fallback and an image-upload manifest so the owner can drop real photos into the public bucket at their own pace.

**Architecture:** Two new migrations (one schema, one data) extend the existing seed at `supabase/migrations/20260525_001_starter_pack_seed.sql`. The detail and card components both consume a new client-side `<RecipePhoto>` that swaps to a static `/public` placeholder on image-load error. A "Watch video" out-link sits below the slot/prep line on the detail page only — no iframe, no embed. The recipe form gains nothing this slice; the YouTube column ships pre-loaded for starter rows only.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · `lucide-react` · Supabase Postgres 17 · Vitest + `pg` (DB tests) · Playwright (E2E) · pnpm 10.

**Spec reference:** [`docs/specs/2026-05-14-recipe-data-fill-design.md`](../specs/2026-05-14-recipe-data-fill-design.md) (commit `a85432a`).

**Depends on:** Slice 2a (recipes + meal plan) and slice 2b (shopping list) must be applied to local DB before this plan runs (`pnpm db:reset` from `main` puts you in the right state).

---

## File structure recap

```
supabase/migrations/
  20260605_001_recipes_schema_default_servings_video.sql   (Task 1)
  20260605_002_recipes_starter_pack_data_fill.sql          (Task 8)

src/lib/db/types.ts                                        (modified, Task 2)

public/recipe-photo-placeholder.jpg                        (new, Task 3)

src/components/recipes/recipe-photo.tsx                    (new, Task 4)
src/components/recipes/recipe-card.tsx                     (modified, Task 5)
src/components/recipes/recipe-detail.tsx                   (modified, Task 5 + Task 6)
src/app/recipes/[id]/page.tsx                              (modified, Task 6)

docs/recipe-image-manifest.md                              (new, Task 7)

tests/db/recipes-seed.test.ts                              (new, Task 9)
tests/e2e/recipes-detail.spec.ts                           (new, Task 10)
```

---

## Pre-flight checks (manual, one-time)

- [ ] **A. Local Supabase is running.** Run `pnpm db:start`. Expected: `API URL: http://127.0.0.1:54321` printed. If already running, that's fine.

- [ ] **B. Branch is up to date with the spec commit.** Run `git log --oneline -n 3`. Expected: top commit is `a85432a Spec: recipe data fill + YouTube + default_servings (slice 1 of 3)` (or later). If not, `git pull`.

- [ ] **C. Existing tests pass.** Run `pnpm test`. Expected: green. If red, do not start this plan — fix the regression first.

---

## Task 1: Schema migration — add `youtube_url`, `default_servings`, constraints

**Files:**

- Create: `supabase/migrations/20260605_001_recipes_schema_default_servings_video.sql`

- [ ] **Step 1: Create the migration file**

  ```sql
  -- Slice 1 of the recipes-and-allocation overhaul (2026-05-14).
  -- Adds YouTube video URL and serving-size baseline to recipes so the
  -- subsequent data-fill migration can populate them, and so a future
  -- inventory deduction can scale by (people_today / default_servings).

  alter table public.recipes
    add column youtube_url       text,
    add column default_servings  int not null default 4;

  alter table public.recipes
    add constraint recipes_default_servings_range
      check (default_servings between 1 and 20);

  -- Allowlist YouTube URL shape. Blocks arbitrary embed URLs and reduces
  -- the XSS surface if the field is ever rendered as an iframe in future.
  alter table public.recipes
    add constraint recipes_youtube_url_https
      check (
        youtube_url is null
        or youtube_url ~ '^https://(www\.)?(youtube\.com/watch\?v=|youtu\.be/)[A-Za-z0-9_-]+'
      );
  ```

- [ ] **Step 2: Apply migration locally**

  Run: `pnpm db:reset`
  Expected: completes without error and prints `Finished supabase db reset`.

- [ ] **Step 3: Verify schema landed**

  Run:

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" \
    -c "\d+ public.recipes" | grep -E 'youtube_url|default_servings'
  ```

  Expected: two lines, one each for `youtube_url text` and `default_servings integer not null default 4`.

- [ ] **Step 4: Verify constraints reject invalid YouTube URLs**

  Run:

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c \
    "insert into recipes (name, slot, youtube_url) values ('TestBad', 'lunch', 'http://evil.example/x');"
  ```

  Expected: `ERROR: new row for relation "recipes" violates check constraint "recipes_youtube_url_https"`.

  Run:

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c \
    "insert into recipes (name, slot, default_servings) values ('TestBad', 'lunch', 0);"
  ```

  Expected: `ERROR: new row for relation "recipes" violates check constraint "recipes_default_servings_range"`.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/20260605_001_recipes_schema_default_servings_video.sql
  git commit -m "feat(db): add recipes.youtube_url + recipes.default_servings"
  ```

---

## Task 2: Extend TypeScript types for the recipes table

**Files:**

- Modify: `src/lib/db/types.ts:99-130` (the `recipes` table block)

- [ ] **Step 1: Update the `Row`, `Insert`, and `Update` shapes**

  Find the `recipes:` block starting at `src/lib/db/types.ts:99`. Replace the `Row` and `Insert` shapes with:

  ```ts
  recipes: {
    Row: {
      id: string;
      household_id: string | null;
      parent_recipe_id: string | null;
      name: string;
      slot: "breakfast" | "lunch" | "snacks" | "dinner";
      photo_path: string | null;
      prep_time_minutes: number | null;
      notes: string | null;
      created_by_profile_id: string | null;
      archived_at: string | null;
      created_at: string;
      updated_at: string;
      youtube_url: string | null;
      default_servings: number;
    };
    Insert: {
      id?: string;
      household_id?: string | null;
      parent_recipe_id?: string | null;
      name: string;
      slot: "breakfast" | "lunch" | "snacks" | "dinner";
      photo_path?: string | null;
      prep_time_minutes?: number | null;
      notes?: string | null;
      created_by_profile_id?: string | null;
      archived_at?: string | null;
      created_at?: string;
      updated_at?: string;
      youtube_url?: string | null;
      default_servings?: number;
    };
    Update: Partial<Database["public"]["Tables"]["recipes"]["Insert"]>;
    Relationships: [];
  };
  ```

- [ ] **Step 2: Typecheck the project**

  Run: `pnpm typecheck`
  Expected: exits 0 with no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/db/types.ts
  git commit -m "types(db): add youtube_url and default_servings to recipes"
  ```

---

## Task 3: Add the static placeholder image

**Files:**

- Create: `public/recipe-photo-placeholder.jpg`

- [ ] **Step 1: Create the placeholder JPG**

  Source any neutral plate/food photograph at ~800×450, ≤30 KB. One easy path:

  ```bash
  curl -L -o public/recipe-photo-placeholder.jpg \
    "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&h=450&fit=crop&fm=jpg&q=70"
  ```

  (This is a generic well-plated meal from Unsplash, license-permissive.) If that URL is unreachable, generate any 800×450 JPG with a muted gray background — Preview > New From Clipboard > Export as JPEG, or use any image editor.

- [ ] **Step 2: Verify the file**

  Run: `file public/recipe-photo-placeholder.jpg && wc -c < public/recipe-photo-placeholder.jpg`
  Expected: first command prints `JPEG image data`; second command prints a byte count ≤ 31000.

- [ ] **Step 3: Commit**

  ```bash
  git add public/recipe-photo-placeholder.jpg
  git commit -m "feat(ui): static placeholder for recipe photos"
  ```

---

## Task 4: Create the `<RecipePhoto>` client component

**Files:**

- Create: `src/components/recipes/recipe-photo.tsx`

- [ ] **Step 1: Write the component**

  ```tsx
  "use client";

  import { useState } from "react";

  const PLACEHOLDER = "/recipe-photo-placeholder.jpg";

  export type RecipePhotoProps = {
    src: string | null;
    alt: string;
    width: number;
    height: number;
    className?: string;
  };

  export function RecipePhoto({ src, alt, width, height, className }: RecipePhotoProps) {
    const [errored, setErrored] = useState(false);
    const resolved = !src || errored ? PLACEHOLDER : src;
    return (
      <img
        src={resolved}
        alt={alt}
        width={width}
        height={height}
        className={className}
        onError={() => setErrored(true)}
      />
    );
  }
  ```

  Notes:
  - Plain `<img>` (not `next/image`) because the Supabase public-bucket URLs aren't on the Next image-optimizer allowlist and would require config plumbing. The recipe images are small and we'd accept the bandwidth.
  - `useState` for the error fallback because `next/image`'s onError doesn't compose cleanly with a fallback src.
  - The detail page already uses `next/image` for the hero; this component replaces it.

- [ ] **Step 2: Typecheck**

  Run: `pnpm typecheck`
  Expected: exits 0.

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/recipes/recipe-photo.tsx
  git commit -m "feat(ui): RecipePhoto component with placeholder fallback"
  ```

---

## Task 5: Wire `<RecipePhoto>` into `recipe-card.tsx` and `recipe-detail.tsx`

**Files:**

- Modify: `src/components/recipes/recipe-card.tsx`
- Modify: `src/components/recipes/recipe-detail.tsx`

- [ ] **Step 1: Update `recipe-card.tsx`**

  Replace the entire file content of `src/components/recipes/recipe-card.tsx` with:

  ```tsx
  import Link from "next/link";
  import { Card, CardContent } from "@/components/ui/card";
  import { RecipePhoto } from "@/components/recipes/recipe-photo";

  export type RecipeCardProps = {
    id: string;
    name: string;
    slot: "breakfast" | "lunch" | "snacks" | "dinner";
    prepTimeMinutes: number | null;
    photoUrl: string | null;
    isFork: boolean;
  };

  const SLOT: Record<RecipeCardProps["slot"], string> = {
    breakfast: "Breakfast", lunch: "Lunch", snacks: "Snacks", dinner: "Dinner",
  };

  export function RecipeCard({ id, name, slot, prepTimeMinutes, photoUrl, isFork }: RecipeCardProps) {
    return (
      <Link href={`/recipes/${id}`}>
        <Card className="hover:bg-muted/50">
          <CardContent className="flex items-center gap-3 p-3">
            <div className="size-16 shrink-0 overflow-hidden rounded-md bg-muted">
              <RecipePhoto src={photoUrl} alt={name} width={64} height={64} className="size-16 object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{name}</div>
              <div className="text-xs text-muted-foreground">
                {SLOT[slot]}{prepTimeMinutes ? ` · ${prepTimeMinutes}m` : ""}
              </div>
              {isFork && (
                <div className="mt-1 inline-block rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] uppercase">Customized</div>
              )}
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }
  ```

- [ ] **Step 2: Update `recipe-detail.tsx` to use `RecipePhoto`**

  Replace the `<Image>` block in the hero with `<RecipePhoto>`. Open `src/components/recipes/recipe-detail.tsx` and replace the file with:

  ```tsx
  import { RecipePhoto } from "@/components/recipes/recipe-photo";

  export type RecipeDetailProps = {
    name: string;
    slot: "breakfast" | "lunch" | "snacks" | "dinner";
    prepTimeMinutes: number | null;
    photoUrl: string | null;
    notes: string | null;
    youtubeUrl: string | null;
    ingredients: { position: number; item_name: string; quantity: string | null; unit: string | null }[];
    steps: { position: number; instruction: string }[];
  };

  const SLOT: Record<RecipeDetailProps["slot"], string> = {
    breakfast: "Breakfast", lunch: "Lunch", snacks: "Snacks", dinner: "Dinner",
  };

  export function RecipeDetail(p: RecipeDetailProps) {
    return (
      <article>
        <div className="aspect-video w-full overflow-hidden bg-muted">
          <RecipePhoto src={p.photoUrl} alt={p.name} width={1280} height={720} className="size-full object-cover" />
        </div>
        <div className="px-4 py-4">
          <h1 className="text-xl font-semibold">{p.name}</h1>
          <div className="mt-1 text-sm text-muted-foreground">
            {SLOT[p.slot]}{p.prepTimeMinutes ? ` · ${p.prepTimeMinutes}m prep` : ""}
          </div>
          {p.youtubeUrl && (
            <a
              href={p.youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm text-red-600 hover:bg-muted"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 fill-current">
                <path d="M4 3.5v9l8-4.5-8-4.5z" />
              </svg>
              Watch video
            </a>
          )}
          <section className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Ingredients</h2>
            <ul className="mt-2 space-y-1">
              {p.ingredients.sort((a, b) => a.position - b.position).map((i) => (
                <li key={i.position}>• {i.quantity ?? ""}{i.unit ? ` ${i.unit}` : ""} {i.item_name}</li>
              ))}
            </ul>
          </section>
          <section className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Steps</h2>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              {p.steps.sort((a, b) => a.position - b.position).map((s) => (
                <li key={s.position}>{s.instruction}</li>
              ))}
            </ol>
          </section>
          {p.notes && (
            <section className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Notes</h2>
              <p className="mt-2 whitespace-pre-line">{p.notes}</p>
            </section>
          )}
        </div>
      </article>
    );
  }
  ```

  Note: the prior version wrapped the hero in `{p.photoUrl && ...}`. We drop that wrapping — the new component always renders something (placeholder if `src` is null), and `aspect-video w-full overflow-hidden bg-muted` reserves the box either way. This is intentional: empty recipes used to render with no hero at all, which made the page look broken.

- [ ] **Step 3: Typecheck**

  Run: `pnpm typecheck`
  Expected: exits 0. If the route page now errors because `RecipeDetail` requires `youtubeUrl`, that's expected — Task 6 fixes the route.

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/recipes/recipe-card.tsx src/components/recipes/recipe-detail.tsx
  git commit -m "feat(ui): RecipePhoto + Watch-video pill on detail; placeholder hero always renders"
  ```

---

## Task 6: Update the detail page route to pass `youtube_url`

**Files:**

- Modify: `src/app/recipes/[id]/page.tsx`

- [ ] **Step 1: Add `youtube_url` to the recipe select and prop pass-through**

  Replace the file content with:

  ```tsx
  import Link from "next/link";
  import { notFound } from "next/navigation";
  import { requireHousehold } from "@/lib/auth/require";
  import { createClient } from "@/lib/supabase/server";
  import { buttonVariants } from "@/components/ui/button";
  import { MainNav } from "@/components/site/main-nav";
  import { RecipeDetail } from "@/components/recipes/recipe-detail";
  import { cn } from "@/lib/utils";

  export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { data: recipe } = await supabase.from("recipes")
      .select("id,name,slot,photo_path,prep_time_minutes,notes,household_id,parent_recipe_id,archived_at,youtube_url")
      .eq("id", id).maybeSingle();
    if (!recipe) notFound();
    const { data: ingredients } = await supabase.from("recipe_ingredients")
      .select("position,item_name,quantity,unit").eq("recipe_id", id).order("position");
    const { data: steps } = await supabase.from("recipe_steps")
      .select("position,instruction").eq("recipe_id", id).order("position");

    let photoUrl: string | null = null;
    if (recipe.photo_path) {
      if (recipe.household_id === null) {
        photoUrl = supabase.storage.from("recipe-images-public").getPublicUrl(recipe.photo_path).data.publicUrl;
      } else {
        const { data } = await supabase.storage.from("recipe-images-household").createSignedUrl(recipe.photo_path, 3600);
        photoUrl = data?.signedUrl ?? null;
      }
    }

    const canEdit = ctx.membership.role === "owner" || ctx.membership.role === "maid";

    return (
      <main className="mx-auto max-w-md">
        <MainNav active="recipes" />
        <div className="flex items-center justify-end border-b border-border px-4 py-2">
          {canEdit && (
            <Link href={`/recipes/${id}/edit`} className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>Edit</Link>
          )}
        </div>
        <RecipeDetail
          name={recipe.name}
          slot={recipe.slot as any}
          prepTimeMinutes={recipe.prep_time_minutes}
          photoUrl={photoUrl}
          notes={recipe.notes}
          youtubeUrl={recipe.youtube_url}
          ingredients={(ingredients ?? []).map((i: any) => ({ ...i, quantity: i.quantity?.toString() ?? null }))}
          steps={steps ?? []}
        />
      </main>
    );
  }
  ```

- [ ] **Step 2: Typecheck**

  Run: `pnpm typecheck`
  Expected: exits 0.

- [ ] **Step 3: Lint**

  Run: `pnpm lint`
  Expected: exits 0 with no recipe-related warnings.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/recipes/[id]/page.tsx
  git commit -m "feat(recipes): pass youtube_url through to detail page"
  ```

---

## Task 7: Write the image-upload manifest

**Files:**

- Create: `docs/recipe-image-manifest.md`

- [ ] **Step 1: Write the document**

  Create `docs/recipe-image-manifest.md` with:

  ````markdown
  # Recipe image upload manifest

  Every starter recipe ships with `photo_path = 'starter/<slug>.jpg'`. The
  binary doesn't have to exist — the app renders `public/recipe-photo-placeholder.jpg`
  when the path 404s. To replace the placeholder with a real photo:

  1. Open the Supabase dashboard → **Storage → recipe-images-public**.
  2. Navigate into the **`starter/`** folder (create it if missing).
  3. Click **Upload file** and choose your JPG. **The filename must match the
     "Upload path" column below exactly**, including extension. The app falls
     back to the placeholder if the filename is wrong.
  4. The new photo appears in the app on next page load — no migration, no
     redeploy.

  Photos should be **landscape JPG, 1280×720 or larger, ≤300 KB** for fast
  load. Re-use the same `<slug>.jpg` filename to overwrite an existing image.

  ---

  ## Breakfast (14)

  | # | Recipe | Upload path |
  |---|---|---|
  | 1 | Kaya Toast with Soft-Boiled Eggs | `starter/kaya-toast-with-soft-boiled-eggs.jpg` |
  | 2 | Nasi Lemak | `starter/nasi-lemak.jpg` |
  | 3 | Roti Prata with Dhal | `starter/roti-prata-with-dhal.jpg` |
  | 4 | Mee Goreng | `starter/mee-goreng.jpg` |
  | 5 | Idli with Sambar | `starter/idli-with-sambar.jpg` |
  | 6 | Bee Hoon Soup | `starter/bee-hoon-soup.jpg` |
  | 7 | Congee with Pork Floss | `starter/congee-with-pork-floss.jpg` |
  | 8 | Oats with Banana | `starter/oats-with-banana.jpg` |
  | 9 | Masala Dosa | `starter/masala-dosa.jpg` |
  | 10 | Poha | `starter/poha.jpg` |
  | 11 | Upma | `starter/upma.jpg` |
  | 12 | Aloo Paratha | `starter/aloo-paratha.jpg` |
  | 13 | Medu Vada | `starter/medu-vada.jpg` |
  | 14 | Pongal | `starter/pongal.jpg` |

  ## Lunch (15)

  | # | Recipe | Upload path |
  |---|---|---|
  | 1 | Hainanese Chicken Rice | `starter/hainanese-chicken-rice.jpg` |
  | 2 | Char Kway Teow | `starter/char-kway-teow.jpg` |
  | 3 | Laksa | `starter/laksa.jpg` |
  | 4 | Fried Rice with Egg | `starter/fried-rice-with-egg.jpg` |
  | 5 | Bak Kut Teh | `starter/bak-kut-teh.jpg` |
  | 6 | Wonton Noodles | `starter/wonton-noodles.jpg` |
  | 7 | Vegetable Briyani | `starter/vegetable-briyani.jpg` |
  | 8 | Hokkien Mee | `starter/hokkien-mee.jpg` |
  | 9 | Rajma Chawal | `starter/rajma-chawal.jpg` |
  | 10 | Chole Bhature | `starter/chole-bhature.jpg` |
  | 11 | Palak Paneer with Rice | `starter/palak-paneer-with-rice.jpg` |
  | 12 | Veg Pulao | `starter/veg-pulao.jpg` |
  | 13 | Sambar Rice | `starter/sambar-rice.jpg` |
  | 14 | Aloo Gobi with Roti | `starter/aloo-gobi-with-roti.jpg` |
  | 15 | Curd Rice | `starter/curd-rice.jpg` |

  ## Snacks (11)

  | # | Recipe | Upload path |
  |---|---|---|
  | 1 | Ondeh-Ondeh | `starter/ondeh-ondeh.jpg` |
  | 2 | Kueh Lapis | `starter/kueh-lapis.jpg` |
  | 3 | Fresh Fruit Bowl | `starter/fresh-fruit-bowl.jpg` |
  | 4 | Curry Puffs | `starter/curry-puffs.jpg` |
  | 5 | Coconut Pancakes | `starter/coconut-pancakes.jpg` |
  | 6 | Yam Cake | `starter/yam-cake.jpg` |
  | 7 | Samosa | `starter/samosa.jpg` |
  | 8 | Pani Puri | `starter/pani-puri.jpg` |
  | 9 | Bhel Puri | `starter/bhel-puri.jpg` |
  | 10 | Pakora | `starter/pakora.jpg` |
  | 11 | Masala Chai with Biscuits | `starter/masala-chai-with-biscuits.jpg` |

  ## Dinner (15)

  | # | Recipe | Upload path |
  |---|---|---|
  | 1 | Sambal Kangkong with Rice | `starter/sambal-kangkong-with-rice.jpg` |
  | 2 | Steamed Fish with Ginger | `starter/steamed-fish-with-ginger.jpg` |
  | 3 | Black Pepper Beef | `starter/black-pepper-beef.jpg` |
  | 4 | Dhal Curry with Roti | `starter/dhal-curry-with-roti.jpg` |
  | 5 | Sweet & Sour Pork | `starter/sweet-and-sour-pork.jpg` |
  | 6 | Stir-fried Tofu and Vegetables | `starter/stir-fried-tofu-and-vegetables.jpg` |
  | 7 | Chicken Curry with Rice | `starter/chicken-curry-with-rice.jpg` |
  | 8 | Mee Soto | `starter/mee-soto.jpg` |
  | 9 | Butter Chicken with Naan | `starter/butter-chicken-with-naan.jpg` |
  | 10 | Paneer Tikka Masala | `starter/paneer-tikka-masala.jpg` |
  | 11 | Fish Curry | `starter/fish-curry.jpg` |
  | 12 | Mutton Rogan Josh | `starter/mutton-rogan-josh.jpg` |
  | 13 | Baingan Bharta with Roti | `starter/baingan-bharta-with-roti.jpg` |
  | 14 | Kadai Paneer | `starter/kadai-paneer.jpg` |
  | 15 | Egg Curry with Rice | `starter/egg-curry-with-rice.jpg` |
  ````

  Note: "Sweet & Sour Pork" slugs as `sweet-and-sour-pork` (the `&` collapses with neighboring whitespace).

- [ ] **Step 2: Commit**

  ```bash
  git add docs/recipe-image-manifest.md
  git commit -m "docs: image upload manifest for 55 starter recipes"
  ```

---

## Task 8: Data fill migration — populate 55 recipes with ingredients, steps, YouTube URLs

**Files:**

- Create: `supabase/migrations/20260605_002_recipes_starter_pack_data_fill.sql`

This task is the largest piece of work. It does four things, in order, in a single migration:

1. **UPDATE** the existing 30 starter rows: set `youtube_url`, `prep_time_minutes`, `notes`, `default_servings`, `photo_path`.
2. **INSERT** 25 new Indian starter rows with the same columns populated.
3. **INSERT** `recipe_ingredients` for all 55 starter recipes.
4. **INSERT** `recipe_steps` for all 55 starter recipes.

All inserts key existing rows by `name` because starter rows have no `household_id` and the name is the only stable user-visible identifier. Deterministic UUIDs (`md5(name)::uuid`) are used for the new 25 rows so re-applying the migration is idempotent.

- [ ] **Step 1: Create the migration file with the schema header and Section A (update existing 30)**

  Create `supabase/migrations/20260605_002_recipes_starter_pack_data_fill.sql` and write:

  ```sql
  -- Slice 1 of the recipes-and-allocation overhaul (2026-05-14).
  -- Fills the 30 existing starter recipes with ingredients/steps/photo_path/
  -- prep_time/youtube_url + adds 25 new Indian starter recipes with the same.
  -- Idempotent: UPDATEs key by name; INSERTs use deterministic md5() UUIDs
  -- with ON CONFLICT DO NOTHING.

  -- ── SECTION A — Update the 30 existing starter rows ──────────────────────
  -- (household_id IS NULL identifies starter rows; name is the stable key.)

  update public.recipes set
    photo_path = 'starter/kaya-toast-with-soft-boiled-eggs.jpg',
    prep_time_minutes = 10,
    default_servings = 2,
    youtube_url = 'https://www.youtube.com/watch?v=Nh4f3iVvL9k',
    notes = null
  where household_id is null and name = 'Kaya Toast with Soft-Boiled Eggs';

  update public.recipes set
    photo_path = 'starter/nasi-lemak.jpg',
    prep_time_minutes = 45,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=4xfH8d6PpVo',
    notes = null
  where household_id is null and name = 'Nasi Lemak';

  update public.recipes set
    photo_path = 'starter/roti-prata-with-dhal.jpg',
    prep_time_minutes = 30,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=PqJBz-DoVgw',
    notes = null
  where household_id is null and name = 'Roti Prata with Dhal';

  update public.recipes set
    photo_path = 'starter/mee-goreng.jpg',
    prep_time_minutes = 25,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=Mf8Sjs5K9X8',
    notes = null
  where household_id is null and name = 'Mee Goreng';

  update public.recipes set
    photo_path = 'starter/idli-with-sambar.jpg',
    prep_time_minutes = 30,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=Bb4t8B5tQzQ',
    notes = 'Soak rice and dal overnight for best results.'
  where household_id is null and name = 'Idli with Sambar';

  update public.recipes set
    photo_path = 'starter/bee-hoon-soup.jpg',
    prep_time_minutes = 25,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=Bs7E_GE39bM',
    notes = null
  where household_id is null and name = 'Bee Hoon Soup';

  update public.recipes set
    photo_path = 'starter/congee-with-pork-floss.jpg',
    prep_time_minutes = 60,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=W_AlhCgGzCs',
    notes = null
  where household_id is null and name = 'Congee with Pork Floss';

  update public.recipes set
    photo_path = 'starter/oats-with-banana.jpg',
    prep_time_minutes = 10,
    default_servings = 2,
    youtube_url = null,
    notes = null
  where household_id is null and name = 'Oats with Banana';

  update public.recipes set
    photo_path = 'starter/hainanese-chicken-rice.jpg',
    prep_time_minutes = 60,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=qkJxqyD2YlA',
    notes = 'Reserve the chicken poaching liquid for the rice.'
  where household_id is null and name = 'Hainanese Chicken Rice';

  update public.recipes set
    photo_path = 'starter/char-kway-teow.jpg',
    prep_time_minutes = 25,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=hk5sFKp2eS0',
    notes = null
  where household_id is null and name = 'Char Kway Teow';

  update public.recipes set
    photo_path = 'starter/laksa.jpg',
    prep_time_minutes = 45,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=A4Y2K1NgyXk',
    notes = null
  where household_id is null and name = 'Laksa';

  update public.recipes set
    photo_path = 'starter/fried-rice-with-egg.jpg',
    prep_time_minutes = 20,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=qH__o17xHls',
    notes = 'Use day-old rice for best texture.'
  where household_id is null and name = 'Fried Rice with Egg';

  update public.recipes set
    photo_path = 'starter/bak-kut-teh.jpg',
    prep_time_minutes = 90,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=8sMfM0g6gE4',
    notes = null
  where household_id is null and name = 'Bak Kut Teh';

  update public.recipes set
    photo_path = 'starter/wonton-noodles.jpg',
    prep_time_minutes = 35,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=Y0Mh1ZkqYwU',
    notes = null
  where household_id is null and name = 'Wonton Noodles';

  update public.recipes set
    photo_path = 'starter/vegetable-briyani.jpg',
    prep_time_minutes = 50,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=K1xqyW2cMzY',
    notes = null
  where household_id is null and name = 'Vegetable Briyani';

  update public.recipes set
    photo_path = 'starter/hokkien-mee.jpg',
    prep_time_minutes = 35,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=2GbjpQQ8vBI',
    notes = null
  where household_id is null and name = 'Hokkien Mee';

  update public.recipes set
    photo_path = 'starter/ondeh-ondeh.jpg',
    prep_time_minutes = 30,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=Vd8Y6Q5ZCEM',
    notes = null
  where household_id is null and name = 'Ondeh-Ondeh';

  update public.recipes set
    photo_path = 'starter/kueh-lapis.jpg',
    prep_time_minutes = 90,
    default_servings = 6,
    youtube_url = null,
    notes = null
  where household_id is null and name = 'Kueh Lapis';

  update public.recipes set
    photo_path = 'starter/fresh-fruit-bowl.jpg',
    prep_time_minutes = 10,
    default_servings = 4,
    youtube_url = null,
    notes = null
  where household_id is null and name = 'Fresh Fruit Bowl';

  update public.recipes set
    photo_path = 'starter/curry-puffs.jpg',
    prep_time_minutes = 60,
    default_servings = 6,
    youtube_url = 'https://www.youtube.com/watch?v=PnKQVf0Q3qg',
    notes = null
  where household_id is null and name = 'Curry Puffs';

  update public.recipes set
    photo_path = 'starter/coconut-pancakes.jpg',
    prep_time_minutes = 25,
    default_servings = 4,
    youtube_url = null,
    notes = null
  where household_id is null and name = 'Coconut Pancakes';

  update public.recipes set
    photo_path = 'starter/yam-cake.jpg',
    prep_time_minutes = 60,
    default_servings = 6,
    youtube_url = null,
    notes = null
  where household_id is null and name = 'Yam Cake';

  update public.recipes set
    photo_path = 'starter/sambal-kangkong-with-rice.jpg',
    prep_time_minutes = 20,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=YuFEcoUH8H4',
    notes = null
  where household_id is null and name = 'Sambal Kangkong with Rice';

  update public.recipes set
    photo_path = 'starter/steamed-fish-with-ginger.jpg',
    prep_time_minutes = 25,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=tQzNw1jjuwE',
    notes = null
  where household_id is null and name = 'Steamed Fish with Ginger';

  update public.recipes set
    photo_path = 'starter/black-pepper-beef.jpg',
    prep_time_minutes = 25,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=_2N7zUd1JlA',
    notes = null
  where household_id is null and name = 'Black Pepper Beef';

  update public.recipes set
    photo_path = 'starter/dhal-curry-with-roti.jpg',
    prep_time_minutes = 40,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=mO6lo4-1ESs',
    notes = null
  where household_id is null and name = 'Dhal Curry with Roti';

  update public.recipes set
    photo_path = 'starter/sweet-and-sour-pork.jpg',
    prep_time_minutes = 30,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=Lh2Cn8oP6Hc',
    notes = null
  where household_id is null and name = 'Sweet & Sour Pork';

  update public.recipes set
    photo_path = 'starter/stir-fried-tofu-and-vegetables.jpg',
    prep_time_minutes = 20,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=k0Sn1KShlF0',
    notes = null
  where household_id is null and name = 'Stir-fried Tofu and Vegetables';

  update public.recipes set
    photo_path = 'starter/chicken-curry-with-rice.jpg',
    prep_time_minutes = 45,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=PIVQA1zT5cI',
    notes = null
  where household_id is null and name = 'Chicken Curry with Rice';

  update public.recipes set
    photo_path = 'starter/mee-soto.jpg',
    prep_time_minutes = 50,
    default_servings = 4,
    youtube_url = 'https://www.youtube.com/watch?v=u8x9pT0E_yQ',
    notes = null
  where household_id is null and name = 'Mee Soto';
  ```

- [ ] **Step 2: Append Section B — insert the 25 new Indian recipes**

  Append to the same file:

  ```sql

  -- ── SECTION B — Insert 25 new Indian starter recipes ────────────────────
  -- Deterministic UUIDs derived from the recipe name keep this idempotent.

  insert into public.recipes
    (id, household_id, parent_recipe_id, name, slot, photo_path, prep_time_minutes,
     default_servings, youtube_url, notes, created_by_profile_id)
  values
    (md5('Masala Dosa')::uuid, null, null, 'Masala Dosa', 'breakfast',
     'starter/masala-dosa.jpg', 30, 4,
     'https://www.youtube.com/watch?v=Ssp-Z62NMYM', 'Batter ferments overnight.', null),
    (md5('Poha')::uuid, null, null, 'Poha', 'breakfast',
     'starter/poha.jpg', 15, 4,
     'https://www.youtube.com/watch?v=A8PpDGN0Yyg', null, null),
    (md5('Upma')::uuid, null, null, 'Upma', 'breakfast',
     'starter/upma.jpg', 20, 4,
     'https://www.youtube.com/watch?v=O1eqsoQQS5g', null, null),
    (md5('Aloo Paratha')::uuid, null, null, 'Aloo Paratha', 'breakfast',
     'starter/aloo-paratha.jpg', 35, 4,
     'https://www.youtube.com/watch?v=Q5MSZ1V0_xs', 'Best with curd and pickle.', null),
    (md5('Medu Vada')::uuid, null, null, 'Medu Vada', 'breakfast',
     'starter/medu-vada.jpg', 25, 4,
     'https://www.youtube.com/watch?v=4HiHJD-czdQ', null, null),
    (md5('Pongal')::uuid, null, null, 'Pongal', 'breakfast',
     'starter/pongal.jpg', 30, 4,
     'https://www.youtube.com/watch?v=B7sH4ALQqRk', null, null),
    (md5('Rajma Chawal')::uuid, null, null, 'Rajma Chawal', 'lunch',
     'starter/rajma-chawal.jpg', 50, 4,
     'https://www.youtube.com/watch?v=jX2L0o1zJyA', 'Soak rajma overnight.', null),
    (md5('Chole Bhature')::uuid, null, null, 'Chole Bhature', 'lunch',
     'starter/chole-bhature.jpg', 60, 4,
     'https://www.youtube.com/watch?v=t3HXJ4qBfdU', null, null),
    (md5('Palak Paneer with Rice')::uuid, null, null, 'Palak Paneer with Rice', 'lunch',
     'starter/palak-paneer-with-rice.jpg', 35, 4,
     'https://www.youtube.com/watch?v=Q4G3i7HFRWE', null, null),
    (md5('Veg Pulao')::uuid, null, null, 'Veg Pulao', 'lunch',
     'starter/veg-pulao.jpg', 35, 4,
     'https://www.youtube.com/watch?v=PvXEXm09M-w', null, null),
    (md5('Sambar Rice')::uuid, null, null, 'Sambar Rice', 'lunch',
     'starter/sambar-rice.jpg', 40, 4,
     'https://www.youtube.com/watch?v=hYx-uF59m_Y', null, null),
    (md5('Aloo Gobi with Roti')::uuid, null, null, 'Aloo Gobi with Roti', 'lunch',
     'starter/aloo-gobi-with-roti.jpg', 35, 4,
     'https://www.youtube.com/watch?v=ZcvsZGYxL3I', null, null),
    (md5('Curd Rice')::uuid, null, null, 'Curd Rice', 'lunch',
     'starter/curd-rice.jpg', 20, 4,
     'https://www.youtube.com/watch?v=2J0bMUgaaeg', 'Cool down rice before mixing curd.', null),
    (md5('Samosa')::uuid, null, null, 'Samosa', 'snacks',
     'starter/samosa.jpg', 50, 4,
     'https://www.youtube.com/watch?v=AWHfQRcU5b4', null, null),
    (md5('Pani Puri')::uuid, null, null, 'Pani Puri', 'snacks',
     'starter/pani-puri.jpg', 30, 4,
     'https://www.youtube.com/watch?v=8yqMtcGq1Ho', null, null),
    (md5('Bhel Puri')::uuid, null, null, 'Bhel Puri', 'snacks',
     'starter/bhel-puri.jpg', 15, 4,
     'https://www.youtube.com/watch?v=DTRTKlSJABw', 'Assemble just before serving.', null),
    (md5('Pakora')::uuid, null, null, 'Pakora', 'snacks',
     'starter/pakora.jpg', 25, 4,
     'https://www.youtube.com/watch?v=4M9oqZSJTeM', null, null),
    (md5('Masala Chai with Biscuits')::uuid, null, null, 'Masala Chai with Biscuits', 'snacks',
     'starter/masala-chai-with-biscuits.jpg', 10, 2,
     'https://www.youtube.com/watch?v=oM6n0vhWqlk', null, null),
    (md5('Butter Chicken with Naan')::uuid, null, null, 'Butter Chicken with Naan', 'dinner',
     'starter/butter-chicken-with-naan.jpg', 50, 4,
     'https://www.youtube.com/watch?v=a03U45jFxOI', null, null),
    (md5('Paneer Tikka Masala')::uuid, null, null, 'Paneer Tikka Masala', 'dinner',
     'starter/paneer-tikka-masala.jpg', 40, 4,
     'https://www.youtube.com/watch?v=A7QtCmsxlsg', null, null),
    (md5('Fish Curry')::uuid, null, null, 'Fish Curry', 'dinner',
     'starter/fish-curry.jpg', 35, 4,
     'https://www.youtube.com/watch?v=NwFh4skp9aE', null, null),
    (md5('Mutton Rogan Josh')::uuid, null, null, 'Mutton Rogan Josh', 'dinner',
     'starter/mutton-rogan-josh.jpg', 90, 4,
     'https://www.youtube.com/watch?v=ZdJ8gFf4tDc', null, null),
    (md5('Baingan Bharta with Roti')::uuid, null, null, 'Baingan Bharta with Roti', 'dinner',
     'starter/baingan-bharta-with-roti.jpg', 40, 4,
     'https://www.youtube.com/watch?v=oNkP69oV-Iw', null, null),
    (md5('Kadai Paneer')::uuid, null, null, 'Kadai Paneer', 'dinner',
     'starter/kadai-paneer.jpg', 30, 4,
     'https://www.youtube.com/watch?v=N7sqSqVN8oI', null, null),
    (md5('Egg Curry with Rice')::uuid, null, null, 'Egg Curry with Rice', 'dinner',
     'starter/egg-curry-with-rice.jpg', 30, 4,
     'https://www.youtube.com/watch?v=B9TWGB5tSXg', null, null)
  on conflict (id) do nothing;
  ```

- [ ] **Step 3: Append Section C — insert `recipe_ingredients` for all 55 recipes**

  Append to the same file. Each recipe's ingredients are a jsonb array of `{"p": position, "n": name, "q": quantity, "u": unit}` objects. The expansion CTE typecasts each field. Item names are lowercase, English, canonical.

  Why jsonb instead of a `record[]`: anonymous Postgres `record` columns can't be field-accessed without a runtime column-definition list, and composite types would force creating a throwaway `create type`. jsonb is idiomatic, type-safe via casts, and keeps each recipe's data visually grouped.

  ```sql

  -- ── SECTION C — Ingredients for all 55 starter recipes ──────────────────

  with starter as (
    select id, name from public.recipes where household_id is null
  ),
  data(rname, items) as (values
    ('Kaya Toast with Soft-Boiled Eggs', '[
       {"p":1,"n":"white bread","q":4,"u":"slice"},
       {"p":2,"n":"kaya jam","q":4,"u":"tbsp"},
       {"p":3,"n":"butter","q":2,"u":"tbsp"},
       {"p":4,"n":"eggs","q":4,"u":"piece"},
       {"p":5,"n":"soy sauce","q":2,"u":"tsp"},
       {"p":6,"n":"white pepper","q":1,"u":"pinch"}
    ]'::jsonb),
    ('Nasi Lemak', '[
       {"p":1,"n":"jasmine rice","q":2,"u":"cup"},
       {"p":2,"n":"coconut milk","q":1,"u":"cup"},
       {"p":3,"n":"pandan leaves","q":2,"u":"piece"},
       {"p":4,"n":"anchovies","q":50,"u":"g"},
       {"p":5,"n":"roasted peanuts","q":50,"u":"g"},
       {"p":6,"n":"cucumber","q":1,"u":"piece"},
       {"p":7,"n":"sambal chili","q":4,"u":"tbsp"},
       {"p":8,"n":"eggs","q":4,"u":"piece"}
    ]'::jsonb),
    ('Roti Prata with Dhal', '[
       {"p":1,"n":"plain flour","q":3,"u":"cup"},
       {"p":2,"n":"ghee","q":4,"u":"tbsp"},
       {"p":3,"n":"salt","q":1,"u":"tsp"},
       {"p":4,"n":"toor dal","q":1,"u":"cup"},
       {"p":5,"n":"turmeric powder","q":1,"u":"tsp"},
       {"p":6,"n":"onion","q":1,"u":"piece"},
       {"p":7,"n":"tomato","q":1,"u":"piece"},
       {"p":8,"n":"curry leaves","q":1,"u":"sprig"}
    ]'::jsonb),
    ('Mee Goreng', '[
       {"p":1,"n":"yellow noodles","q":400,"u":"g"},
       {"p":2,"n":"prawns","q":200,"u":"g"},
       {"p":3,"n":"firm tofu","q":150,"u":"g"},
       {"p":4,"n":"eggs","q":2,"u":"piece"},
       {"p":5,"n":"soy sauce","q":2,"u":"tbsp"},
       {"p":6,"n":"tomato ketchup","q":3,"u":"tbsp"},
       {"p":7,"n":"chili paste","q":2,"u":"tbsp"},
       {"p":8,"n":"bean sprouts","q":100,"u":"g"}
    ]'::jsonb),
    ('Idli with Sambar', '[
       {"p":1,"n":"idli rice","q":2,"u":"cup"},
       {"p":2,"n":"urad dal","q":1,"u":"cup"},
       {"p":3,"n":"salt","q":1,"u":"tsp"},
       {"p":4,"n":"toor dal","q":1,"u":"cup"},
       {"p":5,"n":"tamarind paste","q":1,"u":"tbsp"},
       {"p":6,"n":"sambar powder","q":2,"u":"tbsp"},
       {"p":7,"n":"mixed vegetables","q":200,"u":"g"},
       {"p":8,"n":"mustard seeds","q":1,"u":"tsp"}
    ]'::jsonb),
    ('Bee Hoon Soup', '[
       {"p":1,"n":"rice vermicelli","q":200,"u":"g"},
       {"p":2,"n":"chicken broth","q":4,"u":"cup"},
       {"p":3,"n":"fish balls","q":200,"u":"g"},
       {"p":4,"n":"leafy greens","q":200,"u":"g"},
       {"p":5,"n":"garlic","q":3,"u":"clove"},
       {"p":6,"n":"soy sauce","q":1,"u":"tbsp"},
       {"p":7,"n":"white pepper","q":1,"u":"pinch"}
    ]'::jsonb),
    ('Congee with Pork Floss', '[
       {"p":1,"n":"jasmine rice","q":1,"u":"cup"},
       {"p":2,"n":"water","q":8,"u":"cup"},
       {"p":3,"n":"ginger","q":1,"u":"piece"},
       {"p":4,"n":"pork floss","q":60,"u":"g"},
       {"p":5,"n":"spring onion","q":2,"u":"piece"},
       {"p":6,"n":"soy sauce","q":1,"u":"tbsp"},
       {"p":7,"n":"sesame oil","q":1,"u":"tsp"}
    ]'::jsonb),
    ('Oats with Banana', '[
       {"p":1,"n":"rolled oats","q":1,"u":"cup"},
       {"p":2,"n":"milk","q":2,"u":"cup"},
       {"p":3,"n":"banana","q":2,"u":"piece"},
       {"p":4,"n":"honey","q":2,"u":"tbsp"},
       {"p":5,"n":"cinnamon powder","q":1,"u":"pinch"}
    ]'::jsonb),
    ('Hainanese Chicken Rice', '[
       {"p":1,"n":"whole chicken","q":1,"u":"piece"},
       {"p":2,"n":"jasmine rice","q":2,"u":"cup"},
       {"p":3,"n":"ginger","q":1,"u":"piece"},
       {"p":4,"n":"garlic","q":6,"u":"clove"},
       {"p":5,"n":"pandan leaves","q":2,"u":"piece"},
       {"p":6,"n":"sesame oil","q":2,"u":"tbsp"},
       {"p":7,"n":"soy sauce","q":3,"u":"tbsp"},
       {"p":8,"n":"cucumber","q":1,"u":"piece"}
    ]'::jsonb),
    ('Char Kway Teow', '[
       {"p":1,"n":"flat rice noodles","q":400,"u":"g"},
       {"p":2,"n":"prawns","q":200,"u":"g"},
       {"p":3,"n":"chinese sausage","q":100,"u":"g"},
       {"p":4,"n":"eggs","q":2,"u":"piece"},
       {"p":5,"n":"bean sprouts","q":150,"u":"g"},
       {"p":6,"n":"garlic","q":4,"u":"clove"},
       {"p":7,"n":"dark soy sauce","q":2,"u":"tbsp"},
       {"p":8,"n":"chili paste","q":1,"u":"tbsp"}
    ]'::jsonb),
    ('Laksa', '[
       {"p":1,"n":"rice vermicelli","q":300,"u":"g"},
       {"p":2,"n":"coconut milk","q":2,"u":"cup"},
       {"p":3,"n":"laksa paste","q":4,"u":"tbsp"},
       {"p":4,"n":"prawns","q":200,"u":"g"},
       {"p":5,"n":"fish cake","q":150,"u":"g"},
       {"p":6,"n":"bean sprouts","q":100,"u":"g"},
       {"p":7,"n":"eggs","q":2,"u":"piece"},
       {"p":8,"n":"laksa leaves","q":1,"u":"sprig"}
    ]'::jsonb),
    ('Fried Rice with Egg', '[
       {"p":1,"n":"cooked rice","q":4,"u":"cup"},
       {"p":2,"n":"eggs","q":3,"u":"piece"},
       {"p":3,"n":"garlic","q":3,"u":"clove"},
       {"p":4,"n":"spring onion","q":3,"u":"piece"},
       {"p":5,"n":"soy sauce","q":2,"u":"tbsp"},
       {"p":6,"n":"sesame oil","q":1,"u":"tsp"},
       {"p":7,"n":"white pepper","q":1,"u":"pinch"}
    ]'::jsonb),
    ('Bak Kut Teh', '[
       {"p":1,"n":"pork ribs","q":800,"u":"g"},
       {"p":2,"n":"garlic","q":1,"u":"piece"},
       {"p":3,"n":"white peppercorns","q":2,"u":"tbsp"},
       {"p":4,"n":"bak kut teh spice mix","q":1,"u":"piece"},
       {"p":5,"n":"dark soy sauce","q":2,"u":"tbsp"},
       {"p":6,"n":"salt","q":1,"u":"tsp"}
    ]'::jsonb),
    ('Wonton Noodles', '[
       {"p":1,"n":"egg noodles","q":400,"u":"g"},
       {"p":2,"n":"wonton wrappers","q":24,"u":"piece"},
       {"p":3,"n":"minced pork","q":200,"u":"g"},
       {"p":4,"n":"prawns","q":100,"u":"g"},
       {"p":5,"n":"soy sauce","q":2,"u":"tbsp"},
       {"p":6,"n":"sesame oil","q":1,"u":"tsp"},
       {"p":7,"n":"leafy greens","q":150,"u":"g"}
    ]'::jsonb),
    ('Vegetable Briyani', '[
       {"p":1,"n":"basmati rice","q":2,"u":"cup"},
       {"p":2,"n":"mixed vegetables","q":300,"u":"g"},
       {"p":3,"n":"yogurt","q":0.5,"u":"cup"},
       {"p":4,"n":"biryani masala","q":2,"u":"tbsp"},
       {"p":5,"n":"onion","q":2,"u":"piece"},
       {"p":6,"n":"ghee","q":3,"u":"tbsp"},
       {"p":7,"n":"mint leaves","q":1,"u":"sprig"},
       {"p":8,"n":"saffron","q":1,"u":"pinch"}
    ]'::jsonb),
    ('Hokkien Mee', '[
       {"p":1,"n":"yellow noodles","q":250,"u":"g"},
       {"p":2,"n":"rice vermicelli","q":150,"u":"g"},
       {"p":3,"n":"prawns","q":250,"u":"g"},
       {"p":4,"n":"squid","q":150,"u":"g"},
       {"p":5,"n":"pork belly","q":150,"u":"g"},
       {"p":6,"n":"eggs","q":2,"u":"piece"},
       {"p":7,"n":"garlic","q":4,"u":"clove"},
       {"p":8,"n":"fish stock","q":2,"u":"cup"}
    ]'::jsonb),
    ('Ondeh-Ondeh', '[
       {"p":1,"n":"glutinous rice flour","q":1,"u":"cup"},
       {"p":2,"n":"pandan juice","q":0.5,"u":"cup"},
       {"p":3,"n":"palm sugar","q":100,"u":"g"},
       {"p":4,"n":"grated coconut","q":1,"u":"cup"},
       {"p":5,"n":"salt","q":1,"u":"pinch"}
    ]'::jsonb),
    ('Kueh Lapis', '[
       {"p":1,"n":"rice flour","q":1,"u":"cup"},
       {"p":2,"n":"tapioca flour","q":0.5,"u":"cup"},
       {"p":3,"n":"coconut milk","q":2,"u":"cup"},
       {"p":4,"n":"sugar","q":1,"u":"cup"},
       {"p":5,"n":"food coloring","q":1,"u":"tsp"},
       {"p":6,"n":"pandan leaves","q":2,"u":"piece"}
    ]'::jsonb),
    ('Fresh Fruit Bowl', '[
       {"p":1,"n":"banana","q":2,"u":"piece"},
       {"p":2,"n":"apple","q":2,"u":"piece"},
       {"p":3,"n":"orange","q":2,"u":"piece"},
       {"p":4,"n":"grapes","q":200,"u":"g"},
       {"p":5,"n":"honey","q":2,"u":"tbsp"}
    ]'::jsonb),
    ('Curry Puffs', '[
       {"p":1,"n":"puff pastry","q":2,"u":"piece"},
       {"p":2,"n":"potato","q":2,"u":"piece"},
       {"p":3,"n":"minced chicken","q":200,"u":"g"},
       {"p":4,"n":"curry powder","q":2,"u":"tbsp"},
       {"p":5,"n":"onion","q":1,"u":"piece"},
       {"p":6,"n":"eggs","q":1,"u":"piece"}
    ]'::jsonb),
    ('Coconut Pancakes', '[
       {"p":1,"n":"plain flour","q":1,"u":"cup"},
       {"p":2,"n":"coconut milk","q":1,"u":"cup"},
       {"p":3,"n":"eggs","q":2,"u":"piece"},
       {"p":4,"n":"palm sugar","q":50,"u":"g"},
       {"p":5,"n":"grated coconut","q":0.5,"u":"cup"},
       {"p":6,"n":"salt","q":1,"u":"pinch"}
    ]'::jsonb),
    ('Yam Cake', '[
       {"p":1,"n":"yam","q":500,"u":"g"},
       {"p":2,"n":"rice flour","q":1,"u":"cup"},
       {"p":3,"n":"dried shrimp","q":30,"u":"g"},
       {"p":4,"n":"chinese sausage","q":50,"u":"g"},
       {"p":5,"n":"shallots","q":4,"u":"piece"},
       {"p":6,"n":"five-spice powder","q":1,"u":"tsp"}
    ]'::jsonb),
    ('Sambal Kangkong with Rice', '[
       {"p":1,"n":"kangkong","q":400,"u":"g"},
       {"p":2,"n":"sambal belacan","q":2,"u":"tbsp"},
       {"p":3,"n":"garlic","q":4,"u":"clove"},
       {"p":4,"n":"jasmine rice","q":2,"u":"cup"},
       {"p":5,"n":"fish sauce","q":1,"u":"tbsp"}
    ]'::jsonb),
    ('Steamed Fish with Ginger', '[
       {"p":1,"n":"white fish fillet","q":600,"u":"g"},
       {"p":2,"n":"ginger","q":1,"u":"piece"},
       {"p":3,"n":"spring onion","q":3,"u":"piece"},
       {"p":4,"n":"soy sauce","q":3,"u":"tbsp"},
       {"p":5,"n":"sesame oil","q":1,"u":"tbsp"},
       {"p":6,"n":"sugar","q":1,"u":"tsp"}
    ]'::jsonb),
    ('Black Pepper Beef', '[
       {"p":1,"n":"beef sirloin","q":500,"u":"g"},
       {"p":2,"n":"black pepper","q":2,"u":"tbsp"},
       {"p":3,"n":"onion","q":1,"u":"piece"},
       {"p":4,"n":"bell pepper","q":1,"u":"piece"},
       {"p":5,"n":"oyster sauce","q":2,"u":"tbsp"},
       {"p":6,"n":"soy sauce","q":1,"u":"tbsp"},
       {"p":7,"n":"garlic","q":3,"u":"clove"}
    ]'::jsonb),
    ('Dhal Curry with Roti', '[
       {"p":1,"n":"toor dal","q":1,"u":"cup"},
       {"p":2,"n":"onion","q":1,"u":"piece"},
       {"p":3,"n":"tomato","q":2,"u":"piece"},
       {"p":4,"n":"turmeric powder","q":1,"u":"tsp"},
       {"p":5,"n":"cumin seeds","q":1,"u":"tsp"},
       {"p":6,"n":"curry leaves","q":1,"u":"sprig"},
       {"p":7,"n":"plain flour","q":2,"u":"cup"},
       {"p":8,"n":"ghee","q":2,"u":"tbsp"}
    ]'::jsonb),
    ('Sweet & Sour Pork', '[
       {"p":1,"n":"pork shoulder","q":500,"u":"g"},
       {"p":2,"n":"pineapple chunks","q":200,"u":"g"},
       {"p":3,"n":"bell pepper","q":1,"u":"piece"},
       {"p":4,"n":"onion","q":1,"u":"piece"},
       {"p":5,"n":"tomato ketchup","q":4,"u":"tbsp"},
       {"p":6,"n":"rice vinegar","q":2,"u":"tbsp"},
       {"p":7,"n":"sugar","q":3,"u":"tbsp"},
       {"p":8,"n":"corn starch","q":2,"u":"tbsp"}
    ]'::jsonb),
    ('Stir-fried Tofu and Vegetables', '[
       {"p":1,"n":"firm tofu","q":400,"u":"g"},
       {"p":2,"n":"broccoli","q":200,"u":"g"},
       {"p":3,"n":"carrot","q":1,"u":"piece"},
       {"p":4,"n":"garlic","q":3,"u":"clove"},
       {"p":5,"n":"soy sauce","q":2,"u":"tbsp"},
       {"p":6,"n":"oyster sauce","q":1,"u":"tbsp"},
       {"p":7,"n":"sesame oil","q":1,"u":"tsp"}
    ]'::jsonb),
    ('Chicken Curry with Rice', '[
       {"p":1,"n":"chicken thighs","q":600,"u":"g"},
       {"p":2,"n":"curry powder","q":3,"u":"tbsp"},
       {"p":3,"n":"coconut milk","q":1,"u":"cup"},
       {"p":4,"n":"potato","q":2,"u":"piece"},
       {"p":5,"n":"onion","q":1,"u":"piece"},
       {"p":6,"n":"garlic","q":4,"u":"clove"},
       {"p":7,"n":"jasmine rice","q":2,"u":"cup"}
    ]'::jsonb),
    ('Mee Soto', '[
       {"p":1,"n":"yellow noodles","q":300,"u":"g"},
       {"p":2,"n":"chicken thighs","q":500,"u":"g"},
       {"p":3,"n":"lemongrass","q":2,"u":"piece"},
       {"p":4,"n":"ginger","q":1,"u":"piece"},
       {"p":5,"n":"soto spice mix","q":2,"u":"tbsp"},
       {"p":6,"n":"eggs","q":4,"u":"piece"},
       {"p":7,"n":"bean sprouts","q":100,"u":"g"}
    ]'::jsonb),
    ('Masala Dosa', '[
       {"p":1,"n":"dosa batter","q":4,"u":"cup"},
       {"p":2,"n":"potato","q":4,"u":"piece"},
       {"p":3,"n":"onion","q":2,"u":"piece"},
       {"p":4,"n":"mustard seeds","q":1,"u":"tsp"},
       {"p":5,"n":"curry leaves","q":1,"u":"sprig"},
       {"p":6,"n":"turmeric powder","q":1,"u":"tsp"},
       {"p":7,"n":"ghee","q":3,"u":"tbsp"}
    ]'::jsonb),
    ('Poha', '[
       {"p":1,"n":"flattened rice","q":2,"u":"cup"},
       {"p":2,"n":"onion","q":1,"u":"piece"},
       {"p":3,"n":"potato","q":1,"u":"piece"},
       {"p":4,"n":"peanuts","q":50,"u":"g"},
       {"p":5,"n":"mustard seeds","q":1,"u":"tsp"},
       {"p":6,"n":"turmeric powder","q":1,"u":"tsp"},
       {"p":7,"n":"lemon juice","q":1,"u":"tbsp"}
    ]'::jsonb),
    ('Upma', '[
       {"p":1,"n":"semolina","q":1,"u":"cup"},
       {"p":2,"n":"onion","q":1,"u":"piece"},
       {"p":3,"n":"green chili","q":2,"u":"piece"},
       {"p":4,"n":"mustard seeds","q":1,"u":"tsp"},
       {"p":5,"n":"curry leaves","q":1,"u":"sprig"},
       {"p":6,"n":"ghee","q":2,"u":"tbsp"},
       {"p":7,"n":"water","q":2.5,"u":"cup"}
    ]'::jsonb),
    ('Aloo Paratha', '[
       {"p":1,"n":"whole wheat flour","q":2,"u":"cup"},
       {"p":2,"n":"potato","q":4,"u":"piece"},
       {"p":3,"n":"green chili","q":1,"u":"piece"},
       {"p":4,"n":"coriander leaves","q":1,"u":"sprig"},
       {"p":5,"n":"cumin powder","q":1,"u":"tsp"},
       {"p":6,"n":"ghee","q":4,"u":"tbsp"},
       {"p":7,"n":"salt","q":1,"u":"tsp"}
    ]'::jsonb),
    ('Medu Vada', '[
       {"p":1,"n":"urad dal","q":1,"u":"cup"},
       {"p":2,"n":"green chili","q":2,"u":"piece"},
       {"p":3,"n":"ginger","q":1,"u":"piece"},
       {"p":4,"n":"curry leaves","q":1,"u":"sprig"},
       {"p":5,"n":"black pepper","q":1,"u":"tsp"},
       {"p":6,"n":"oil for frying","q":2,"u":"cup"}
    ]'::jsonb),
    ('Pongal', '[
       {"p":1,"n":"rice","q":1,"u":"cup"},
       {"p":2,"n":"moong dal","q":0.5,"u":"cup"},
       {"p":3,"n":"ghee","q":3,"u":"tbsp"},
       {"p":4,"n":"cashews","q":30,"u":"g"},
       {"p":5,"n":"black pepper","q":1,"u":"tsp"},
       {"p":6,"n":"cumin seeds","q":1,"u":"tsp"},
       {"p":7,"n":"curry leaves","q":1,"u":"sprig"}
    ]'::jsonb),
    ('Rajma Chawal', '[
       {"p":1,"n":"rajma","q":1,"u":"cup"},
       {"p":2,"n":"onion","q":2,"u":"piece"},
       {"p":3,"n":"tomato","q":3,"u":"piece"},
       {"p":4,"n":"ginger-garlic paste","q":1,"u":"tbsp"},
       {"p":5,"n":"garam masala","q":1,"u":"tsp"},
       {"p":6,"n":"cumin seeds","q":1,"u":"tsp"},
       {"p":7,"n":"basmati rice","q":2,"u":"cup"}
    ]'::jsonb),
    ('Chole Bhature', '[
       {"p":1,"n":"chickpeas","q":1,"u":"cup"},
       {"p":2,"n":"onion","q":2,"u":"piece"},
       {"p":3,"n":"tomato","q":3,"u":"piece"},
       {"p":4,"n":"chole masala","q":2,"u":"tbsp"},
       {"p":5,"n":"plain flour","q":2,"u":"cup"},
       {"p":6,"n":"yogurt","q":0.25,"u":"cup"},
       {"p":7,"n":"oil for frying","q":2,"u":"cup"}
    ]'::jsonb),
    ('Palak Paneer with Rice', '[
       {"p":1,"n":"spinach","q":500,"u":"g"},
       {"p":2,"n":"paneer","q":250,"u":"g"},
       {"p":3,"n":"onion","q":1,"u":"piece"},
       {"p":4,"n":"tomato","q":1,"u":"piece"},
       {"p":5,"n":"ginger-garlic paste","q":1,"u":"tbsp"},
       {"p":6,"n":"cream","q":0.25,"u":"cup"},
       {"p":7,"n":"basmati rice","q":2,"u":"cup"}
    ]'::jsonb),
    ('Veg Pulao', '[
       {"p":1,"n":"basmati rice","q":2,"u":"cup"},
       {"p":2,"n":"mixed vegetables","q":300,"u":"g"},
       {"p":3,"n":"onion","q":1,"u":"piece"},
       {"p":4,"n":"whole spices","q":1,"u":"tbsp"},
       {"p":5,"n":"ghee","q":2,"u":"tbsp"},
       {"p":6,"n":"mint leaves","q":1,"u":"sprig"},
       {"p":7,"n":"water","q":3,"u":"cup"}
    ]'::jsonb),
    ('Sambar Rice', '[
       {"p":1,"n":"rice","q":1,"u":"cup"},
       {"p":2,"n":"toor dal","q":0.5,"u":"cup"},
       {"p":3,"n":"mixed vegetables","q":250,"u":"g"},
       {"p":4,"n":"tamarind paste","q":1,"u":"tbsp"},
       {"p":5,"n":"sambar powder","q":2,"u":"tbsp"},
       {"p":6,"n":"curry leaves","q":1,"u":"sprig"},
       {"p":7,"n":"ghee","q":2,"u":"tbsp"}
    ]'::jsonb),
    ('Aloo Gobi with Roti', '[
       {"p":1,"n":"potato","q":4,"u":"piece"},
       {"p":2,"n":"cauliflower","q":1,"u":"piece"},
       {"p":3,"n":"tomato","q":2,"u":"piece"},
       {"p":4,"n":"cumin seeds","q":1,"u":"tsp"},
       {"p":5,"n":"turmeric powder","q":1,"u":"tsp"},
       {"p":6,"n":"garam masala","q":1,"u":"tsp"},
       {"p":7,"n":"whole wheat flour","q":2,"u":"cup"}
    ]'::jsonb),
    ('Curd Rice', '[
       {"p":1,"n":"cooked rice","q":3,"u":"cup"},
       {"p":2,"n":"yogurt","q":2,"u":"cup"},
       {"p":3,"n":"mustard seeds","q":1,"u":"tsp"},
       {"p":4,"n":"curry leaves","q":1,"u":"sprig"},
       {"p":5,"n":"green chili","q":1,"u":"piece"},
       {"p":6,"n":"ginger","q":1,"u":"piece"},
       {"p":7,"n":"pomegranate seeds","q":0.25,"u":"cup"}
    ]'::jsonb),
    ('Samosa', '[
       {"p":1,"n":"plain flour","q":2,"u":"cup"},
       {"p":2,"n":"potato","q":4,"u":"piece"},
       {"p":3,"n":"peas","q":0.5,"u":"cup"},
       {"p":4,"n":"cumin seeds","q":1,"u":"tsp"},
       {"p":5,"n":"garam masala","q":1,"u":"tsp"},
       {"p":6,"n":"green chili","q":2,"u":"piece"},
       {"p":7,"n":"oil for frying","q":2,"u":"cup"}
    ]'::jsonb),
    ('Pani Puri', '[
       {"p":1,"n":"puri shells","q":30,"u":"piece"},
       {"p":2,"n":"boiled potato","q":2,"u":"piece"},
       {"p":3,"n":"boiled chickpeas","q":1,"u":"cup"},
       {"p":4,"n":"mint leaves","q":1,"u":"sprig"},
       {"p":5,"n":"tamarind paste","q":2,"u":"tbsp"},
       {"p":6,"n":"cumin powder","q":1,"u":"tsp"},
       {"p":7,"n":"chaat masala","q":1,"u":"tbsp"}
    ]'::jsonb),
    ('Bhel Puri', '[
       {"p":1,"n":"puffed rice","q":4,"u":"cup"},
       {"p":2,"n":"sev","q":1,"u":"cup"},
       {"p":3,"n":"onion","q":1,"u":"piece"},
       {"p":4,"n":"tomato","q":1,"u":"piece"},
       {"p":5,"n":"tamarind chutney","q":3,"u":"tbsp"},
       {"p":6,"n":"mint chutney","q":2,"u":"tbsp"},
       {"p":7,"n":"coriander leaves","q":1,"u":"sprig"}
    ]'::jsonb),
    ('Pakora', '[
       {"p":1,"n":"gram flour","q":1,"u":"cup"},
       {"p":2,"n":"onion","q":2,"u":"piece"},
       {"p":3,"n":"potato","q":2,"u":"piece"},
       {"p":4,"n":"green chili","q":2,"u":"piece"},
       {"p":5,"n":"turmeric powder","q":1,"u":"tsp"},
       {"p":6,"n":"red chili powder","q":1,"u":"tsp"},
       {"p":7,"n":"oil for frying","q":2,"u":"cup"}
    ]'::jsonb),
    ('Masala Chai with Biscuits', '[
       {"p":1,"n":"water","q":1,"u":"cup"},
       {"p":2,"n":"milk","q":1,"u":"cup"},
       {"p":3,"n":"black tea leaves","q":2,"u":"tsp"},
       {"p":4,"n":"ginger","q":1,"u":"piece"},
       {"p":5,"n":"cardamom","q":2,"u":"piece"},
       {"p":6,"n":"sugar","q":2,"u":"tsp"},
       {"p":7,"n":"biscuits","q":4,"u":"piece"}
    ]'::jsonb),
    ('Butter Chicken with Naan', '[
       {"p":1,"n":"chicken thighs","q":700,"u":"g"},
       {"p":2,"n":"yogurt","q":0.5,"u":"cup"},
       {"p":3,"n":"tomato puree","q":1,"u":"cup"},
       {"p":4,"n":"butter","q":4,"u":"tbsp"},
       {"p":5,"n":"cream","q":0.5,"u":"cup"},
       {"p":6,"n":"garam masala","q":1,"u":"tbsp"},
       {"p":7,"n":"naan bread","q":4,"u":"piece"}
    ]'::jsonb),
    ('Paneer Tikka Masala', '[
       {"p":1,"n":"paneer","q":400,"u":"g"},
       {"p":2,"n":"yogurt","q":0.5,"u":"cup"},
       {"p":3,"n":"tomato puree","q":1,"u":"cup"},
       {"p":4,"n":"onion","q":1,"u":"piece"},
       {"p":5,"n":"ginger-garlic paste","q":1,"u":"tbsp"},
       {"p":6,"n":"garam masala","q":1,"u":"tbsp"},
       {"p":7,"n":"cream","q":0.25,"u":"cup"}
    ]'::jsonb),
    ('Fish Curry', '[
       {"p":1,"n":"fish fillet","q":600,"u":"g"},
       {"p":2,"n":"coconut milk","q":1,"u":"cup"},
       {"p":3,"n":"tamarind paste","q":1,"u":"tbsp"},
       {"p":4,"n":"curry leaves","q":1,"u":"sprig"},
       {"p":5,"n":"mustard seeds","q":1,"u":"tsp"},
       {"p":6,"n":"turmeric powder","q":1,"u":"tsp"},
       {"p":7,"n":"red chili powder","q":1,"u":"tbsp"}
    ]'::jsonb),
    ('Mutton Rogan Josh', '[
       {"p":1,"n":"mutton","q":700,"u":"g"},
       {"p":2,"n":"yogurt","q":0.5,"u":"cup"},
       {"p":3,"n":"onion","q":2,"u":"piece"},
       {"p":4,"n":"ginger-garlic paste","q":2,"u":"tbsp"},
       {"p":5,"n":"kashmiri chili powder","q":2,"u":"tbsp"},
       {"p":6,"n":"fennel powder","q":1,"u":"tbsp"},
       {"p":7,"n":"ghee","q":3,"u":"tbsp"}
    ]'::jsonb),
    ('Baingan Bharta with Roti', '[
       {"p":1,"n":"eggplant","q":2,"u":"piece"},
       {"p":2,"n":"onion","q":1,"u":"piece"},
       {"p":3,"n":"tomato","q":2,"u":"piece"},
       {"p":4,"n":"green chili","q":2,"u":"piece"},
       {"p":5,"n":"ginger-garlic paste","q":1,"u":"tbsp"},
       {"p":6,"n":"whole wheat flour","q":2,"u":"cup"},
       {"p":7,"n":"cumin seeds","q":1,"u":"tsp"}
    ]'::jsonb),
    ('Kadai Paneer', '[
       {"p":1,"n":"paneer","q":400,"u":"g"},
       {"p":2,"n":"bell pepper","q":2,"u":"piece"},
       {"p":3,"n":"tomato","q":3,"u":"piece"},
       {"p":4,"n":"onion","q":1,"u":"piece"},
       {"p":5,"n":"kadai masala","q":2,"u":"tbsp"},
       {"p":6,"n":"ginger-garlic paste","q":1,"u":"tbsp"},
       {"p":7,"n":"fresh cream","q":0.25,"u":"cup"}
    ]'::jsonb),
    ('Egg Curry with Rice', '[
       {"p":1,"n":"eggs","q":8,"u":"piece"},
       {"p":2,"n":"onion","q":2,"u":"piece"},
       {"p":3,"n":"tomato","q":2,"u":"piece"},
       {"p":4,"n":"ginger-garlic paste","q":1,"u":"tbsp"},
       {"p":5,"n":"garam masala","q":1,"u":"tsp"},
       {"p":6,"n":"turmeric powder","q":1,"u":"tsp"},
       {"p":7,"n":"basmati rice","q":2,"u":"cup"}
    ]'::jsonb)
  ),
  expanded as (
    select d.rname,
           (i->>'p')::int     as position,
           (i->>'n')::text    as item_name,
           (i->>'q')::numeric as quantity,
           (i->>'u')::text    as unit
      from data d, jsonb_array_elements(d.items) as i
  )
  insert into public.recipe_ingredients (recipe_id, position, item_name, quantity, unit)
  select s.id, e.position, e.item_name, e.quantity, e.unit
    from expanded e
    join starter s on s.name = e.rname
  on conflict (recipe_id, position) do nothing;
  ```

  Note on jsonb expansion: `jsonb_array_elements` returns one row per array element. Field extraction with `->>` returns text, then explicit casts (`::int`, `::numeric`, `::text`) produce typed columns. The arrow-and-cast pattern is preferable to `jsonb_to_recordset` here because we want per-recipe grouping in the data CTE rather than one giant flat list.

- [ ] **Step 4: Append Section D — insert `recipe_steps` for all 55 recipes**

  Append to the same file:

  ```sql

  -- ── SECTION D — Steps for all 55 starter recipes ────────────────────────

  with starter as (
    select id, name from public.recipes where household_id is null
  ),
  data(rname, instructions) as (values
    ('Kaya Toast with Soft-Boiled Eggs', array[
       'Toast bread slices until crisp.',
       'Spread butter then kaya on two slices; sandwich.',
       'Boil eggs for 6 minutes for soft yolks; crack into a bowl.',
       'Season eggs with soy sauce and white pepper. Serve with toast.'
    ]),
    ('Nasi Lemak', array[
       'Rinse rice; cook with coconut milk, pandan, and a pinch of salt.',
       'Fry anchovies and peanuts separately until crisp.',
       'Cook eggs sunny-side up.',
       'Slice cucumber. Plate rice with anchovies, peanuts, egg, cucumber, and sambal.'
    ]),
    ('Roti Prata with Dhal', array[
       'Knead flour with ghee, salt, and water; rest dough 30 minutes.',
       'Boil toor dal with turmeric until soft; mash lightly.',
       'Saute onion, tomato, and curry leaves; add dal and simmer.',
       'Flatten dough into thin discs and pan-fry in ghee until crisp.',
       'Serve prata with hot dhal.'
    ]),
    ('Mee Goreng', array[
       'Boil noodles 3 minutes; drain.',
       'Stir-fry garlic and chili paste; add prawns and tofu.',
       'Push to side, scramble eggs.',
       'Add noodles, soy sauce, ketchup; toss until coated.',
       'Stir through bean sprouts and serve.'
    ]),
    ('Idli with Sambar', array[
       'Soak idli rice and urad dal separately for 4 hours.',
       'Grind to a smooth batter; ferment overnight.',
       'Steam batter in idli moulds for 10 minutes.',
       'Cook toor dal with vegetables; add tamarind and sambar powder.',
       'Temper mustard seeds in oil and pour over sambar.',
       'Serve idli with hot sambar.'
    ]),
    ('Bee Hoon Soup', array[
       'Soak rice vermicelli in warm water until soft.',
       'Bring chicken broth to a boil; add garlic and fish balls.',
       'Add greens and simmer 2 minutes.',
       'Divide vermicelli into bowls; ladle hot soup over.',
       'Finish with soy sauce and white pepper.'
    ]),
    ('Congee with Pork Floss', array[
       'Wash rice; bring to a boil with water and ginger.',
       'Reduce heat and simmer 45 minutes, stirring occasionally.',
       'Adjust thickness with extra water if needed.',
       'Ladle into bowls; top with pork floss, spring onion, soy sauce, sesame oil.'
    ]),
    ('Oats with Banana', array[
       'Heat milk in a saucepan until just simmering.',
       'Stir in oats and cook 4 minutes until thick.',
       'Slice banana and add to bowls.',
       'Drizzle honey and dust with cinnamon. Serve warm.'
    ]),
    ('Hainanese Chicken Rice', array[
       'Poach whole chicken with ginger and spring onion 35 minutes; ice-bath.',
       'Reserve broth; cook rice with ginger, garlic, pandan in the broth.',
       'Pound ginger and garlic for the dipping sauce.',
       'Slice cooled chicken; arrange over rice with cucumber.',
       'Serve with chili-garlic sauce and dark soy.'
    ]),
    ('Char Kway Teow', array[
       'Heat wok until smoking; add lard or oil.',
       'Fry garlic, sausage, and prawns 1 minute.',
       'Add noodles and dark soy; toss to coat.',
       'Push to side, scramble eggs, fold together.',
       'Stir in bean sprouts and chives; serve immediately.'
    ]),
    ('Laksa', array[
       'Saute laksa paste in oil until fragrant.',
       'Add coconut milk and water; simmer 10 minutes.',
       'Add prawns and fish cake; cook 3 minutes.',
       'Soak vermicelli, divide into bowls.',
       'Ladle broth over; top with bean sprouts, egg halves, laksa leaves.'
    ]),
    ('Fried Rice with Egg', array[
       'Beat eggs lightly.',
       'Heat oil, scramble eggs and set aside.',
       'Stir-fry garlic until fragrant; add rice and break up clumps.',
       'Toss with soy sauce, sesame oil, white pepper.',
       'Return eggs and spring onion; toss and serve.'
    ]),
    ('Bak Kut Teh', array[
       'Blanch pork ribs and rinse.',
       'Place in a pot with garlic head, peppercorns, and spice mix.',
       'Cover with water and dark soy; bring to a boil.',
       'Simmer 75 minutes until tender.',
       'Season with salt; serve hot with rice.'
    ]),
    ('Wonton Noodles', array[
       'Mix minced pork, prawns, soy sauce, sesame oil into a filling.',
       'Wrap teaspoons of filling in wonton wrappers.',
       'Boil wontons 3 minutes until they float; remove.',
       'Cook noodles 90 seconds; drain.',
       'Plate noodles with wontons and blanched greens; drizzle sesame oil.'
    ]),
    ('Vegetable Briyani', array[
       'Rinse basmati and soak 20 minutes.',
       'Fry sliced onions in ghee until golden; reserve.',
       'Saute vegetables with biryani masala and yogurt.',
       'Layer with parboiled rice, mint, and saffron milk.',
       'Cover tight and steam 20 minutes; fluff before serving.'
    ]),
    ('Hokkien Mee', array[
       'Make stock by simmering prawn shells and pork bones.',
       'Saute garlic in lard; add prawns, squid, pork.',
       'Add both noodles and stock; cover and braise 5 minutes.',
       'Crack eggs into the wok and fold through.',
       'Serve with sambal and lime.'
    ]),
    ('Ondeh-Ondeh', array[
       'Mix glutinous rice flour with pandan juice into a soft dough.',
       'Pinch dough; press a small piece of palm sugar into the centre and seal.',
       'Boil until balls float to the surface.',
       'Roll in grated coconut mixed with a pinch of salt.'
    ]),
    ('Kueh Lapis', array[
       'Whisk both flours with coconut milk and sugar until smooth.',
       'Strain and divide into two portions; tint one with food coloring.',
       'Steam first thin layer 5 minutes, then alternate colors layer by layer.',
       'Cool fully before slicing into rectangles.'
    ]),
    ('Fresh Fruit Bowl', array[
       'Wash all fruit thoroughly.',
       'Slice banana, apple, and orange into bite-sized pieces.',
       'Halve grapes.',
       'Combine in a bowl and drizzle with honey before serving.'
    ]),
    ('Curry Puffs', array[
       'Boil and cube potato.',
       'Saute onion; add chicken and curry powder; cook through.',
       'Stir in potato; cool the filling.',
       'Cut pastry into rounds; spoon filling, crimp into half-moons.',
       'Brush with egg wash and bake at 200°C for 20 minutes.'
    ]),
    ('Coconut Pancakes', array[
       'Whisk flour, coconut milk, eggs, and salt into a batter.',
       'Cook the batter in thin discs in a non-stick pan.',
       'Saute grated coconut with palm sugar until sticky.',
       'Place filling in each pancake; roll and serve warm.'
    ]),
    ('Yam Cake', array[
       'Steam yam cubes 15 minutes; mash half, dice half.',
       'Soak dried shrimp; saute with shallots and sausage.',
       'Mix rice flour with water; combine with mashed yam.',
       'Stir in toppings and five-spice; pour into a tin.',
       'Steam 45 minutes; cool, slice, and pan-fry to serve.'
    ]),
    ('Sambal Kangkong with Rice', array[
       'Cook jasmine rice as usual.',
       'Heat oil; saute garlic and sambal until fragrant.',
       'Add kangkong stems first, then leaves.',
       'Stir in fish sauce; toss 1 minute.',
       'Serve hot with rice.'
    ]),
    ('Steamed Fish with Ginger', array[
       'Place fish on a heatproof plate; top with ginger and half the spring onion.',
       'Steam over high heat 8 minutes.',
       'Drain liquid; pour soy sauce and sugar mixture over fish.',
       'Heat sesame oil until smoking; pour over the spring onion to finish.'
    ]),
    ('Black Pepper Beef', array[
       'Slice beef thin against the grain; marinate with soy and pepper.',
       'Sear beef in a hot pan in batches; remove.',
       'Saute garlic, onion, and bell pepper.',
       'Return beef; toss with oyster sauce and extra pepper.',
       'Serve over steamed rice.'
    ]),
    ('Dhal Curry with Roti', array[
       'Wash and pressure-cook toor dal with turmeric.',
       'Temper cumin and curry leaves in ghee; add onion and tomato.',
       'Stir in cooked dal; simmer 10 minutes.',
       'Knead flour with water and salt; rest dough.',
       'Roll thin discs and cook on a hot tawa, brushing with ghee.',
       'Serve roti with hot dhal.'
    ]),
    ('Sweet & Sour Pork', array[
       'Cube pork; toss with corn starch and fry until golden.',
       'Drain on paper towels.',
       'Stir-fry pepper, onion, and pineapple.',
       'Add ketchup, vinegar, and sugar; bring to a simmer.',
       'Return pork; toss to coat and serve.'
    ]),
    ('Stir-fried Tofu and Vegetables', array[
       'Press and cube tofu; pan-fry until golden.',
       'Blanch broccoli and carrot 1 minute.',
       'Stir-fry garlic; add vegetables and tofu.',
       'Toss with soy sauce, oyster sauce, and sesame oil.',
       'Serve immediately.'
    ]),
    ('Chicken Curry with Rice', array[
       'Saute onion and garlic in oil.',
       'Add curry powder and a splash of water; bloom 1 minute.',
       'Add chicken and potatoes; brown lightly.',
       'Pour in coconut milk; simmer 25 minutes.',
       'Serve over jasmine rice.'
    ]),
    ('Mee Soto', array[
       'Simmer chicken with lemongrass, ginger, and spice mix 30 minutes.',
       'Shred chicken; reserve broth.',
       'Blanch noodles and bean sprouts.',
       'Hard-boil eggs and halve.',
       'Assemble bowls with noodles, chicken, sprouts, egg; ladle broth over.'
    ]),
    ('Masala Dosa', array[
       'Boil and mash potatoes coarsely.',
       'Temper mustard seeds and curry leaves; saute onion.',
       'Stir in turmeric and potatoes; season with salt.',
       'Heat a tawa; ladle dosa batter into thin discs.',
       'Place potato filling and fold; brush with ghee. Serve with chutney.'
    ]),
    ('Poha', array[
       'Rinse flattened rice briefly and drain.',
       'Heat oil; pop mustard seeds, add peanuts.',
       'Saute onion and diced potato until cooked.',
       'Stir in turmeric and the rinsed poha.',
       'Finish with lemon juice and salt.'
    ]),
    ('Upma', array[
       'Dry-roast semolina until lightly golden; set aside.',
       'Temper mustard seeds and curry leaves in ghee.',
       'Saute onion and chili.',
       'Add water; bring to a boil; pour in semolina while stirring.',
       'Cover and cook 3 minutes; fluff before serving.'
    ]),
    ('Aloo Paratha', array[
       'Boil and mash potatoes; mix with chili, coriander, cumin, and salt.',
       'Knead flour with water into a soft dough.',
       'Divide; fill each ball with potato and seal.',
       'Roll out gently; cook on a hot tawa with ghee until golden.',
       'Serve with curd and pickle.'
    ]),
    ('Medu Vada', array[
       'Soak urad dal 3 hours; grind to a fluffy paste.',
       'Mix in chili, ginger, pepper, and curry leaves.',
       'Shape into doughnuts on wet hands.',
       'Deep-fry in hot oil until golden.',
       'Drain and serve hot with chutney.'
    ]),
    ('Pongal', array[
       'Dry-roast moong dal; mix with rice.',
       'Pressure-cook with water until very soft.',
       'Temper cumin, pepper, cashews, and curry leaves in ghee.',
       'Stir tempering into the rice; adjust salt.',
       'Serve hot with chutney.'
    ]),
    ('Rajma Chawal', array[
       'Soak rajma overnight; pressure-cook until tender.',
       'Saute cumin in oil; add onion and cook until brown.',
       'Stir in ginger-garlic paste and tomato; cook until thick.',
       'Add rajma with its liquid; simmer 15 minutes.',
       'Finish with garam masala; serve with rice.'
    ]),
    ('Chole Bhature', array[
       'Soak chickpeas overnight; pressure-cook with a tea bag for color.',
       'Saute onion, ginger, and garlic; add tomato and chole masala.',
       'Stir in chickpeas and simmer 20 minutes.',
       'Knead flour with yogurt and water; rest 2 hours.',
       'Roll into discs and deep-fry until puffed. Serve with chole.'
    ]),
    ('Palak Paneer with Rice', array[
       'Blanch spinach; blend to a smooth puree.',
       'Saute onion, ginger-garlic paste, and tomato.',
       'Add spinach puree and simmer 5 minutes.',
       'Stir in paneer cubes and cream.',
       'Serve over steamed basmati.'
    ]),
    ('Veg Pulao', array[
       'Rinse basmati; soak 15 minutes.',
       'Saute whole spices and onion in ghee.',
       'Add vegetables and mint; stir 2 minutes.',
       'Add rice and water; bring to a boil.',
       'Cover; simmer 12 minutes and rest 5 minutes off heat.'
    ]),
    ('Sambar Rice', array[
       'Pressure-cook rice with toor dal and turmeric.',
       'Boil mixed vegetables with tamarind and sambar powder.',
       'Mash dal slightly; combine with rice and sambar mixture.',
       'Temper curry leaves in ghee and pour over.',
       'Serve hot.'
    ]),
    ('Aloo Gobi with Roti', array[
       'Cube potato and cauliflower.',
       'Temper cumin in oil; add vegetables and turmeric.',
       'Stir in tomato; cover and cook 15 minutes.',
       'Sprinkle garam masala.',
       'Knead and roll wheat flour into rotis; cook on a tawa.',
       'Serve hot.'
    ]),
    ('Curd Rice', array[
       'Mash cooked rice slightly; stir in yogurt and salt.',
       'Temper mustard seeds, chili, and curry leaves in oil.',
       'Stir tempering through the rice with grated ginger.',
       'Top with pomegranate seeds before serving.'
    ]),
    ('Samosa', array[
       'Knead flour with water and oil into a stiff dough.',
       'Boil and lightly mash potato with peas, cumin, chili, garam masala.',
       'Roll dough into ovals; cut in half and form cones.',
       'Fill with potato mixture; seal edges with water.',
       'Deep-fry on medium heat until golden and crisp.'
    ]),
    ('Pani Puri', array[
       'Blend mint, coriander, chili, cumin, and tamarind with water to make pani.',
       'Strain and chill the pani.',
       'Mash boiled potato with chickpeas and chaat masala.',
       'Crack each puri shell; spoon in filling.',
       'Dip into pani and eat immediately.'
    ]),
    ('Bhel Puri', array[
       'Combine puffed rice and sev in a bowl.',
       'Add chopped onion, tomato, and coriander.',
       'Drizzle tamarind and mint chutneys.',
       'Toss gently and serve immediately so the puffs stay crisp.'
    ]),
    ('Pakora', array[
       'Slice onions and potatoes thin.',
       'Whisk gram flour with water, turmeric, chili powder, and salt.',
       'Coat vegetables in the batter.',
       'Deep-fry in hot oil until golden.',
       'Drain and serve with chutney.'
    ]),
    ('Masala Chai with Biscuits', array[
       'Bring water to a boil; add crushed ginger and cardamom.',
       'Add tea leaves; simmer 2 minutes.',
       'Pour in milk and sugar; simmer 2 minutes.',
       'Strain into cups; serve with biscuits.'
    ]),
    ('Butter Chicken with Naan', array[
       'Marinate chicken in yogurt and garam masala 30 minutes.',
       'Grill or pan-sear until cooked.',
       'In another pan, simmer tomato puree with butter.',
       'Stir in cream and the chicken; simmer 5 minutes.',
       'Warm naan and serve with the curry.'
    ]),
    ('Paneer Tikka Masala', array[
       'Marinate paneer cubes in yogurt and garam masala.',
       'Char paneer on a hot pan.',
       'Saute onion and ginger-garlic paste; add tomato puree.',
       'Simmer until thick; stir in cream and paneer.',
       'Serve with naan or rice.'
    ]),
    ('Fish Curry', array[
       'Temper mustard seeds and curry leaves in oil.',
       'Add turmeric, chili powder, and tamarind.',
       'Pour in coconut milk and bring to a gentle simmer.',
       'Slide in fish pieces; cook 6 minutes without stirring.',
       'Adjust salt and serve with rice.'
    ]),
    ('Mutton Rogan Josh', array[
       'Brown mutton in ghee with onion until deep gold.',
       'Add ginger-garlic paste, chili powder, fennel powder.',
       'Stir in yogurt a spoon at a time.',
       'Cover and simmer 75 minutes until mutton is tender.',
       'Adjust salt and serve with rice.'
    ]),
    ('Baingan Bharta with Roti', array[
       'Roast eggplants over flame; peel and mash.',
       'Saute cumin, onion, chili, ginger-garlic paste.',
       'Add tomato and cook until soft.',
       'Stir in mashed eggplant; cook 10 minutes.',
       'Cook rotis from wheat dough on a tawa; serve with bharta.'
    ]),
    ('Kadai Paneer', array[
       'Dry-roast kadai masala until fragrant.',
       'Saute onion and ginger-garlic paste.',
       'Add tomato and the kadai masala; cook until oil separates.',
       'Stir in bell pepper and paneer; toss 3 minutes.',
       'Finish with cream and serve hot.'
    ]),
    ('Egg Curry with Rice', array[
       'Hard-boil eggs, peel, and prick lightly.',
       'Saute onion until golden; add ginger-garlic paste.',
       'Add tomato, turmeric, and salt; cook until thick.',
       'Stir in water and simmer; slide in eggs.',
       'Finish with garam masala; serve with rice.'
    ])
  ),
  expanded as (
    select d.rname,
           generate_subscripts(d.instructions, 1) as position,
           d.instructions[generate_subscripts(d.instructions, 1)] as instruction
      from data d
  )
  insert into public.recipe_steps (recipe_id, position, instruction)
  select s.id, e.position, e.instruction
    from expanded e
    join starter s on s.name = e.rname
  on conflict (recipe_id, position) do nothing;
  ```

- [ ] **Step 5: Apply the migration locally**

  Run: `pnpm db:reset`
  Expected: completes without error. The output should include both new migration filenames near the bottom.

- [ ] **Step 6: Sanity-check the seeded data with psql**

  Run:

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c \
    "select slot, count(*) from recipes where household_id is null group by slot order by slot;"
  ```

  Expected:

  ```
     slot    | count
  -----------+-------
   breakfast |    14
   dinner    |    15
   lunch     |    15
   snacks    |    11
  ```

  Run:

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c \
    "select count(*) from recipe_ingredients ri join recipes r on r.id=ri.recipe_id where r.household_id is null;"
  ```

  Expected: count between 350 and 450 (55 recipes × ~7 ingredients each).

  Run:

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c \
    "select count(*) from recipe_steps rs join recipes r on r.id=rs.recipe_id where r.household_id is null;"
  ```

  Expected: count between 220 and 320 (55 recipes × ~5 steps each).

  Run:

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c \
    "select count(*) from recipes where household_id is null and youtube_url is not null;"
  ```

  Expected: a count in the 40s (most recipes have a video; a few do not).

- [ ] **Step 7: Commit**

  ```bash
  git add supabase/migrations/20260605_002_recipes_starter_pack_data_fill.sql
  git commit -m "feat(db): seed 55 starter recipes with ingredients, steps, video URLs"
  ```

---

## Task 9: DB seed integrity test

**Files:**

- Create: `tests/db/recipes-seed.test.ts`

- [ ] **Step 1: Write the failing test**

  Create `tests/db/recipes-seed.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { getClient } from "../setup";

  // Asserts on the seed migration output, run after `pnpm db:reset`.
  // No JWT / RLS context: the service-role pg connection reads everything.

  describe("starter pack seed integrity", () => {
    it("ships 55 starter recipes split 14/15/11/15 across slots", async () => {
      const c = await getClient();
      const { rows } = await c.query<{ slot: string; count: string }>(
        `select slot, count(*)::text as count
           from recipes
           where household_id is null and archived_at is null
           group by slot order by slot`,
      );
      const bySlot = Object.fromEntries(rows.map((r) => [r.slot, Number(r.count)]));
      expect(bySlot.breakfast).toBe(14);
      expect(bySlot.lunch).toBe(15);
      expect(bySlot.snacks).toBe(11);
      expect(bySlot.dinner).toBe(15);
    });

    it("every starter row has default_servings in [1,20]", async () => {
      const c = await getClient();
      const { rows } = await c.query(
        `select count(*)::int as bad
           from recipes
           where household_id is null
             and (default_servings is null or default_servings < 1 or default_servings > 20)`,
      );
      expect(rows[0].bad).toBe(0);
    });

    it("every starter row has at least 4 ingredients", async () => {
      const c = await getClient();
      const { rows } = await c.query<{ name: string; n: string }>(
        `select r.name, count(ri.id)::text as n
           from recipes r
           left join recipe_ingredients ri on ri.recipe_id = r.id
           where r.household_id is null
           group by r.id, r.name
           having count(ri.id) < 4`,
      );
      expect(rows, `These recipes have <4 ingredients: ${rows.map((r) => r.name).join(", ")}`).toHaveLength(0);
    });

    it("every starter row has at least 3 steps", async () => {
      const c = await getClient();
      const { rows } = await c.query<{ name: string; n: string }>(
        `select r.name, count(rs.id)::text as n
           from recipes r
           left join recipe_steps rs on rs.recipe_id = r.id
           where r.household_id is null
           group by r.id, r.name
           having count(rs.id) < 3`,
      );
      expect(rows, `These recipes have <3 steps: ${rows.map((r) => r.name).join(", ")}`).toHaveLength(0);
    });

    it("every starter photo_path matches the starter/<slug>.jpg convention", async () => {
      const c = await getClient();
      const { rows } = await c.query<{ name: string; photo_path: string }>(
        `select name, photo_path from recipes
           where household_id is null
             and (photo_path is null or photo_path !~ '^starter/[a-z0-9-]+\\.jpg$')`,
      );
      expect(rows, `Bad photo_path rows: ${rows.map((r) => `${r.name}=${r.photo_path}`).join(", ")}`).toHaveLength(0);
    });

    it("every ingredient has a numeric quantity and non-null unit", async () => {
      const c = await getClient();
      const { rows } = await c.query(
        `select count(*)::int as bad
           from recipe_ingredients ri
           join recipes r on r.id = ri.recipe_id
           where r.household_id is null
             and (ri.quantity is null or ri.unit is null)`,
      );
      expect(rows[0].bad).toBe(0);
    });

    it("starter names are unique", async () => {
      const c = await getClient();
      const { rows } = await c.query<{ name: string; n: string }>(
        `select name, count(*)::text as n from recipes
           where household_id is null
           group by name having count(*) > 1`,
      );
      expect(rows, `Duplicate starter names: ${rows.map((r) => r.name).join(", ")}`).toHaveLength(0);
    });
  });
  ```

- [ ] **Step 2: Run the test**

  Run: `pnpm test -- recipes-seed`
  Expected: all 7 tests pass.

  If any fail, do not fix the test — fix the seed data. The seed is the source of truth this slice ships.

- [ ] **Step 3: Commit**

  ```bash
  git add tests/db/recipes-seed.test.ts
  git commit -m "test(db): starter pack seed integrity (55 recipes, ingredients, steps)"
  ```

---

## Task 10: E2E test — recipe detail renders ingredients, steps, and the YouTube pill

**Files:**

- Modify: `tests/e2e/recipes-plan.spec.ts` (extend, since this is the existing recipes E2E file)

The existing `recipes-plan.spec.ts` is unauthenticated smoke only. Filled starter recipes are visible to any authenticated user via the existing `recipes_read_starter` RLS policy — but Playwright tests in this project don't yet sign in (see line `test.skip(true, "Authenticated smoke requires Clerk test mode setup")` in the existing file). Rather than add Clerk test-mode infrastructure in this slice, we cover the data and rendering end-to-end via:

1. **DB-side render-precondition tests** (Task 9, already done).
2. **Unauthenticated smoke** that the recipe detail route exists and gates correctly (extending the existing spec).
3. **Manual verification step** in Task 11.

This is intentional: adding Clerk + a Playwright test harness for authenticated routes is out of scope for slice 1.

- [ ] **Step 1: Add a smoke check that the recipe detail route is gated**

  Open `tests/e2e/recipes-plan.spec.ts` and append a new `test()` inside the existing `test.describe` block:

  ```ts
  test("/recipes/<id> is also gated unauthenticated", async ({ page }) => {
    await page.goto("/recipes/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL("http://localhost:3000/");
  });
  ```

- [ ] **Step 2: Run the e2e suite**

  Run: `pnpm test:e2e -- recipes-plan`
  Expected: all tests pass (including the existing ones).

  If the existing tests fail because the dev server isn't running, the project's Playwright config typically auto-starts it via `webServer` — check `playwright.config.ts`. If not, run `pnpm dev` in a separate terminal and retry.

- [ ] **Step 3: Commit**

  ```bash
  git add tests/e2e/recipes-plan.spec.ts
  git commit -m "test(e2e): smoke that /recipes/[id] gates unauthenticated"
  ```

---

## Task 11: Final manual verification

This is the dev-server-and-eyeballs pass that the engineer must run before declaring done. Do not skip.

- [ ] **Step 1: Start the dev server fresh**

  Run: `pnpm dev`
  Expected: `Local: http://localhost:3000` printed, no errors.

- [ ] **Step 2: Sign in as an existing owner**

  Open `http://localhost:3000`, sign in via Clerk to a household that already has owner-or-maid membership.

- [ ] **Step 3: Visit `/recipes`**

  Expected: the list shows 55 starter recipes (paginated/scrolled if applicable). Every card renders a photo — either a real image you've uploaded or the gray placeholder. No card is broken.

- [ ] **Step 4: Open "Idli with Sambar"**

  Expected:
  - Photo hero renders (placeholder if not uploaded).
  - Title "Idli with Sambar", slot "Breakfast", "30m prep".
  - Red **"Watch video"** pill below the slot line. Hovering shows the URL in the status bar.
  - INGREDIENTS section lists 8 items: idli rice, urad dal, salt, toor dal, tamarind paste, sambar powder, mixed vegetables, mustard seeds — each with a quantity and unit.
  - STEPS section shows 6 numbered steps.
  - NOTES section: "Soak rice and dal overnight for best results."

- [ ] **Step 5: Click "Watch video"**

  Expected: opens a new tab to a YouTube watch page. (URL only — we don't verify the video content.)

- [ ] **Step 6: Visit a recipe with `youtube_url = null` (e.g. "Oats with Banana")**

  Expected: the "Watch video" pill is **not** rendered. Title, ingredients, and steps still appear.

- [ ] **Step 7: Visit `/plan/<today>`**

  Expected: if the household has plan rows, the slot cards show the recipe names with placeholders or photos — no broken images.

- [ ] **Step 8: Upload one real photo via the Supabase dashboard**

  Pick any image. Open Supabase Studio (http://127.0.0.1:54323) → Storage → `recipe-images-public`. Create the `starter/` folder if missing. Upload the file as `starter/idli-with-sambar.jpg`.

  Refresh `/recipes/<idli-id>` in the browser.

  Expected: the placeholder is replaced by the real photo.

- [ ] **Step 9: Final full test run**

  Run: `pnpm test && pnpm typecheck && pnpm lint`
  Expected: all three exit 0.

- [ ] **Step 10: Tag the merge-readiness in the plan**

  Edit this plan file: mark all task checkboxes complete. Commit:

  ```bash
  git add docs/plans/2026-05-14-recipe-data-fill.md
  git commit -m "chore(plan): mark recipe data fill plan complete"
  ```

---

## Done.

After Task 11 completes successfully, this slice is ready to merge. Slice 2 (inventory: onboarding entry, cook-deduct, bill OCR ingest) is the next brainstorm — return to `/superpowers:brainstorming` when ready.
