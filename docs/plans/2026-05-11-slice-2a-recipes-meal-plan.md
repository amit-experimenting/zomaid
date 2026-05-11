# Slice 2a — Recipes & Meal Plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement slice 2a end-to-end: a recipe catalog (curated SG starter pack + per-household fork-on-edit + structured ingredients/steps/photos), a meal-plan model (one row per household × date × slot), a nightly pg_cron suggestion engine with a 4-day non-repeat window, owner+maid-edit / family-read-only RLS, and a today-first mobile UI. Shopping list is deferred to slice 2b.

**Architecture:** All new tables live alongside foundations tables with the same RLS pattern (`auth.jwt()->>'sub'` via `has_active_membership` / `is_active_owner_or_maid` helpers). The suggestion engine is a single SQL function called by `pg_cron` at 22:00 SGT; on-demand regenerate and manual override are `security invoker` RPCs that the server actions call. Recipe photos use Supabase Storage with two buckets (public for starter pack; household-scoped for custom). The today-first list at `/plan` is the new default surface for the slice; the dashboard's "Recipes & meal plan" card from foundations becomes active and routes there.

**Tech Stack:** Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Clerk v7 · Supabase (`@supabase/ssr`, `@supabase/supabase-js` v2, Supabase Storage) · Postgres 17 + `pg_cron` · Zod · `browser-image-compression` (client photo compression) · Vitest + `pg` (DB/integration tests) · Playwright (E2E) · pnpm 10.

**Spec reference:** [`docs/specs/2026-05-11-slice-2a-recipes-meal-plan-design.md`](../specs/2026-05-11-slice-2a-recipes-meal-plan-design.md) (commit `d57f74b`).

**Depends on:** Foundations slice — see [`docs/HANDOFF.md`](../HANDOFF.md). Slice 2a assumes foundations has been verified locally (`pnpm db:reset && pnpm test` passes with 28+ tests).

---

## Pre-flight checks (manual, one-time)

- [ ] **A. Confirm `pg_cron` available locally.** Run `psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "select * from pg_available_extensions where name='pg_cron';"`. Expected: a single row. Local Supabase ships `pg_cron`; if missing, upgrade the Supabase CLI.

- [ ] **B. Confirm `pg_cron` available on the cloud Supabase project.** In the Supabase dashboard → Database → Extensions, search `pg_cron`. If listed: continue. If not listed: this slice's cron is blocked on cloud. Fallback path = a Vercel Cron route that hits an admin RPC; **do not start Task 8 (cron) until this is confirmed or a fallback design is appended to this plan.**

- [ ] **C. Confirm Supabase Storage works on the cloud project.** Visit Supabase dashboard → Storage. Expected: an empty Storage section. No setup needed; Task 9 creates the buckets via migration.

When A is green, you can start Task 1. B and C must be green before Tasks 8 and 9 respectively.

---

## File structure recap

```
supabase/migrations/
  20260517_001_recipes.sql                 (Task 2)
  20260518_001_recipe_subtables.sql        (Task 3)
  20260519_001_household_recipe_hides.sql  (Task 4)
  20260520_001_meal_plans.sql              (Task 5)
  20260521_001_effective_recipes.sql       (Task 6)
  20260522_001_meal_plan_rpcs.sql          (Task 7)
  20260523_001_meal_plan_cron.sql          (Task 8)
  20260524_001_recipe_storage.sql          (Task 9)
  20260525_001_starter_pack_seed.sql       (Task 10)

src/lib/db/types.ts                        (extended in Task 11)

src/components/ui/sheet.tsx                (Task 12)
src/components/ui/textarea.tsx             (Task 12)
src/components/ui/dropdown-menu.tsx        (Task 12)
src/components/ui/dialog.tsx               (Task 12)

src/app/recipes/actions.ts                 (Task 13)
src/app/plan/actions.ts                    (Task 14)

src/components/plan/today-list.tsx         (Task 15)
src/components/plan/slot-row.tsx           (Task 15)
src/components/plan/week-strip.tsx         (Task 15)
src/components/plan/slot-action-sheet.tsx  (Task 15)
src/components/plan/recipe-picker.tsx      (Task 15)

src/app/plan/page.tsx                      (Task 16)
src/app/plan/[date]/page.tsx               (Task 16)

src/components/recipes/recipe-card.tsx     (Task 17)
src/components/recipes/recipe-detail.tsx   (Task 17)

src/app/recipes/page.tsx                   (Task 18)
src/app/recipes/[id]/page.tsx              (Task 19)

src/components/recipes/recipe-form.tsx     (Task 20)
src/app/recipes/[id]/edit/page.tsx         (Task 20)
src/app/recipes/new/page.tsx               (Task 21)

src/app/dashboard/page.tsx                 (modified in Task 22)

tests/factories.ts                         (extended per DB task)
tests/db/recipes.test.ts                   (Task 2)
tests/db/recipe-subtables.test.ts          (Task 3)
tests/db/household-recipe-hides.test.ts    (Task 4)
tests/db/meal-plans.test.ts                (Task 5)
tests/db/effective-recipes.test.ts         (Task 6)
tests/db/meal-plan-rpcs.test.ts            (Task 7)
tests/db/recipe-storage-rls.test.ts        (Task 9)
tests/actions/recipes-actions.test.ts      (Task 13)
tests/actions/plan-actions.test.ts         (Task 14)
tests/e2e/recipes-plan.spec.ts             (Task 23)
```

> **Note on test tasks.** The user has indicated tests will be revisited later. The plan still includes test code per TDD; at execution time, the test-writing steps may be deferred or skipped task-by-task. The implementation steps stand on their own — do not skip the implementation steps just because you skipped the test.

---

## Task 1: Install dev/runtime dependencies

**Files:**

- Modify: `package.json` (via pnpm)
- Modify: `pnpm-lock.yaml` (auto)

- [ ] **Step 1: Install runtime dependency for client-side photo compression**

  ```bash
  pnpm add browser-image-compression@2.0.2
  ```

  Expected: `package.json` gains `"browser-image-compression": "^2.0.2"` under `dependencies`. Lockfile updated.

- [ ] **Step 2: Verify typecheck still clean**

  ```bash
  pnpm typecheck
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add package.json pnpm-lock.yaml
  git commit -m "Add browser-image-compression for slice 2a photo uploads"
  ```

---

## Task 2: Migration — `meal_slot` enum + `recipes` table + RLS, with tests

**Files:**

- Create: `supabase/migrations/20260517_001_recipes.sql`
- Modify: `tests/factories.ts` (add `insertRecipe`)
- Create: `tests/db/recipes.test.ts`

- [ ] **Step 1: Extend `tests/factories.ts` with recipe helpers**

  Append to `tests/factories.ts`:

  ```ts
  export type RecipeSlot = "breakfast" | "lunch" | "snacks" | "dinner";

  export type RecipeRow = {
    id: string;
    household_id: string | null;
    parent_recipe_id: string | null;
    name: string;
    slot: RecipeSlot;
    photo_path: string | null;
    prep_time_minutes: number | null;
    notes: string | null;
    created_by_profile_id: string | null;
    archived_at: string | null;
  };

  type InsertRecipeArgs =
    | (Partial<RecipeRow> & { household_id?: null; parent_recipe_id?: null })
    | (Partial<RecipeRow> & { household_id: string; created_by_profile_id: string });

  export async function insertRecipe(
    client: Client,
    overrides: InsertRecipeArgs = {},
  ): Promise<RecipeRow> {
    const row: RecipeRow = {
      id: overrides.id ?? randomUUID(),
      household_id: overrides.household_id ?? null,
      parent_recipe_id: overrides.parent_recipe_id ?? null,
      name: overrides.name ?? `Recipe ${randomUUID().slice(0, 8)}`,
      slot: overrides.slot ?? "lunch",
      photo_path: overrides.photo_path ?? null,
      prep_time_minutes: overrides.prep_time_minutes ?? null,
      notes: overrides.notes ?? null,
      created_by_profile_id: overrides.created_by_profile_id ?? null,
      archived_at: overrides.archived_at ?? null,
    };
    await client.query(
      `insert into recipes
        (id, household_id, parent_recipe_id, name, slot, photo_path,
         prep_time_minutes, notes, created_by_profile_id, archived_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        row.id, row.household_id, row.parent_recipe_id, row.name, row.slot,
        row.photo_path, row.prep_time_minutes, row.notes,
        row.created_by_profile_id, row.archived_at,
      ],
    );
    return row;
  }
  ```

- [ ] **Step 2: Write failing tests**

  Create `tests/db/recipes.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { asAnon, setJwtClaims, withTransaction } from "../setup";
  import {
    insertHousehold,
    insertMembership,
    insertProfile,
    insertRecipe,
  } from "../factories";

  describe("recipes RLS + invariants", () => {
    it("starter recipes are readable to authenticated users", async () => {
      await withTransaction(async (c) => {
        const starter = await insertRecipe(c, {
          household_id: null,
          name: "Nasi Lemak",
          slot: "breakfast",
        });
        const me = await insertProfile(c);

        await setJwtClaims(c, { sub: me.clerk_user_id });
        const { rows } = await c.query(
          "select id from recipes where id = $1",
          [starter.id],
        );
        expect(rows).toHaveLength(1);
      });
    });

    it("starter recipes are invisible to anon", async () => {
      await withTransaction(async (c) => {
        const starter = await insertRecipe(c, { household_id: null });
        await asAnon(c);
        const { rows } = await c.query(
          "select id from recipes where id = $1",
          [starter.id],
        );
        expect(rows).toHaveLength(0);
      });
    });

    it("household recipes are visible only to household members", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const outsider = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, {
          household_id: hh.id,
          profile_id: owner.id,
          role: "owner",
        });
        const r = await insertRecipe(c, {
          household_id: hh.id,
          created_by_profile_id: owner.id,
          name: "Tan family curry",
        });

        await setJwtClaims(c, { sub: owner.clerk_user_id });
        let res = await c.query("select id from recipes where id=$1", [r.id]);
        expect(res.rows).toHaveLength(1);

        await setJwtClaims(c, { sub: outsider.clerk_user_id });
        res = await c.query("select id from recipes where id=$1", [r.id]);
        expect(res.rows).toHaveLength(0);
      });
    });

    it("rejects starter rows with parent_recipe_id set (invariant)", async () => {
      await withTransaction(async (c) => {
        const starter = await insertRecipe(c, { household_id: null });
        await expect(
          c.query(
            `insert into recipes (id, household_id, parent_recipe_id, name, slot)
             values (gen_random_uuid(), null, $1, 'invalid', 'lunch')`,
            [starter.id],
          ),
        ).rejects.toThrow(/recipes_invariant/);
      });
    });

    it("rejects household rows without created_by (invariant)", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await expect(
          c.query(
            `insert into recipes (id, household_id, name, slot)
             values (gen_random_uuid(), $1, 'orphan', 'lunch')`,
            [hh.id],
          ),
        ).rejects.toThrow(/recipes_invariant/);
      });
    });

    it("enforces one fork per (household, parent_recipe_id)", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        const starter = await insertRecipe(c, { household_id: null });
        await insertRecipe(c, {
          household_id: hh.id,
          parent_recipe_id: starter.id,
          created_by_profile_id: owner.id,
          name: "Our nasi lemak",
        });
        await expect(
          insertRecipe(c, {
            household_id: hh.id,
            parent_recipe_id: starter.id,
            created_by_profile_id: owner.id,
            name: "duplicate fork",
          }),
        ).rejects.toThrow(/recipes_household_fork_unique/);
      });
    });

    it("owner or maid can insert household recipes; family cannot", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const maid = await insertProfile(c);
        const family = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, {
          household_id: hh.id, profile_id: owner.id, role: "owner",
        });
        await insertMembership(c, {
          household_id: hh.id, profile_id: maid.id, role: "maid",
        });
        await insertMembership(c, {
          household_id: hh.id, profile_id: family.id, role: "family_member",
        });

        await setJwtClaims(c, { sub: owner.clerk_user_id });
        await expect(
          c.query(
            `insert into recipes (household_id, name, slot, created_by_profile_id)
             values ($1,'O','lunch',$2)`,
            [hh.id, owner.id],
          ),
        ).resolves.toBeTruthy();

        await setJwtClaims(c, { sub: maid.clerk_user_id });
        await expect(
          c.query(
            `insert into recipes (household_id, name, slot, created_by_profile_id)
             values ($1,'M','lunch',$2)`,
            [hh.id, maid.id],
          ),
        ).resolves.toBeTruthy();

        await setJwtClaims(c, { sub: family.clerk_user_id });
        await expect(
          c.query(
            `insert into recipes (household_id, name, slot, created_by_profile_id)
             values ($1,'F','lunch',$2)`,
            [hh.id, family.id],
          ),
        ).rejects.toThrow(/row-level security/);
      });
    });
  });
  ```

- [ ] **Step 3: Run failing tests**

  ```bash
  pnpm test tests/db/recipes.test.ts
  ```

  Expected: tests fail with `type "meal_slot" does not exist` or `relation "recipes" does not exist`.

- [ ] **Step 4: Write the migration**

  Create `supabase/migrations/20260517_001_recipes.sql`:

  ```sql
  -- Slice 2a — Recipe catalog. Starter pack + per-household fork-on-edit.
  -- See docs/specs/2026-05-11-slice-2a-recipes-meal-plan-design.md §4.

  create type public.meal_slot as enum
    ('breakfast', 'lunch', 'snacks', 'dinner');

  create table public.recipes (
    id                    uuid primary key default gen_random_uuid(),
    household_id          uuid references public.households(id) on delete cascade,
    parent_recipe_id      uuid references public.recipes(id) on delete set null,
    name                  text not null check (length(name) between 1 and 120),
    slot                  public.meal_slot not null,
    photo_path            text,
    prep_time_minutes     int check (prep_time_minutes is null or prep_time_minutes > 0),
    notes                 text,
    created_by_profile_id uuid references public.profiles(id) on delete set null,
    archived_at           timestamptz,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    -- Invariants: starter / custom / fork must match exactly one shape.
    constraint recipes_invariant check (
      (household_id is null and parent_recipe_id is null and created_by_profile_id is null)
      or
      (household_id is not null and parent_recipe_id is null and created_by_profile_id is not null)
      or
      (household_id is not null and parent_recipe_id is not null and created_by_profile_id is not null)
    )
  );

  create unique index recipes_household_fork_unique
    on public.recipes (household_id, parent_recipe_id)
    where parent_recipe_id is not null;

  create index recipes_household_id_idx        on public.recipes (household_id);
  create index recipes_slot_idx                on public.recipes (slot);
  create index recipes_archived_at_idx         on public.recipes (archived_at)
    where archived_at is not null;

  alter table public.recipes enable row level security;

  -- updated_at trigger (foundations pattern)
  create or replace function public.touch_updated_at()
    returns trigger language plpgsql as $$
    begin new.updated_at := now(); return new; end;
    $$;
  -- Note: foundations may already define touch_updated_at; create or replace handles that.

  create trigger recipes_touch_updated_at
    before update on public.recipes
    for each row execute function public.touch_updated_at();

  -- ── RLS ────────────────────────────────────────────────────────────────────

  -- Starter rows readable to any authenticated user.
  create policy recipes_read_starter on public.recipes
    for select to authenticated
    using (
      household_id is null
      and (auth.jwt() ->> 'sub') is not null
    );

  -- Household-scoped read: any active member.
  create policy recipes_read_household on public.recipes
    for select to authenticated
    using (
      household_id is not null
      and public.has_active_membership(household_id)
    );

  -- Household-scoped writes: owner OR maid. Starter rows are written by the
  -- seed migration as service_role and have no insert/update/delete policy.
  create policy recipes_insert_household on public.recipes
    for insert to authenticated
    with check (
      household_id is not null
      and public.is_active_owner_or_maid(household_id)
    );

  create policy recipes_update_household on public.recipes
    for update to authenticated
    using (
      household_id is not null
      and public.is_active_owner_or_maid(household_id)
    )
    with check (
      household_id is not null
      and public.is_active_owner_or_maid(household_id)
    );

  create policy recipes_delete_household on public.recipes
    for delete to authenticated
    using (
      household_id is not null
      and public.is_active_owner_or_maid(household_id)
    );

  -- Note: `is_active_owner_or_maid` is defined in migration 20260520_001_meal_plans.sql.
  -- This migration must run *after* that one logically, but because migrations
  -- apply in filename order and tests for this table won't exercise insert/update/delete
  -- until the function exists, the deployment order works: we define the function in
  -- a later migration. *Important:* if you try to apply only this migration in isolation,
  -- insert/update/delete policies will fail to compile. Apply migrations as a batch
  -- (db:reset), or move the helper into this file. For clarity, this plan keeps the
  -- helper with meal_plans (it's the gate for writes there too).
  ```

  > **Order-of-application note:** Because the policies above reference `is_active_owner_or_maid`, the migration must apply **after** the helper is defined. Two options:
  > - **(a) Move the helper into this migration** (cleanest; the helper is shared by meal_plans too).
  > - **(b) Define the policies later** (in `20260520_001_meal_plans.sql`).
  >
  > **Choose (a).** Add the helper at the bottom of this file:
  >
  > ```sql
  > -- Helper used by recipes + meal_plans writes.
  > create or replace function public.is_active_owner_or_maid(p_household uuid)
  >   returns boolean
  >   language sql stable security definer
  >   set search_path = public
  >   as $$
  >     select exists (
  >       select 1 from public.household_memberships hm
  >       join public.profiles p on p.id = hm.profile_id
  >       where hm.household_id = p_household
  >         and hm.status = 'active'
  >         and hm.role in ('owner', 'maid')
  >         and p.clerk_user_id = (auth.jwt() ->> 'sub')
  >     );
  >   $$;
  > ```
  >
  > Then Task 5's migration (`20260520_001`) is solely about `meal_plans` and references the existing helper. Update the file structure recap and Task 5 accordingly.

- [ ] **Step 5: Apply the migration**

  ```bash
  pnpm db:reset
  ```

  Expected: prints applied migration filenames including `20260517_001_recipes.sql`. If it errors, inspect the SQL — most likely the `is_active_owner_or_maid` helper definition.

- [ ] **Step 6: Rerun the test**

  ```bash
  pnpm test tests/db/recipes.test.ts
  ```

  Expected: 7 tests pass.

- [ ] **Step 7: Commit**

  ```bash
  git add supabase/migrations/20260517_001_recipes.sql tests/factories.ts tests/db/recipes.test.ts
  git commit -m "Add recipes table + meal_slot enum + RLS + invariants"
  ```

---

## Task 3: Migration — `recipe_ingredients` + `recipe_steps` + RLS, with tests

**Files:**

- Create: `supabase/migrations/20260518_001_recipe_subtables.sql`
- Modify: `tests/factories.ts` (add `insertRecipeIngredient`, `insertRecipeStep`)
- Create: `tests/db/recipe-subtables.test.ts`

- [ ] **Step 1: Extend factories**

  Append to `tests/factories.ts`:

  ```ts
  export type RecipeIngredientRow = {
    id: string;
    recipe_id: string;
    position: number;
    item_name: string;
    quantity: string | null;     // numeric serialises as string in pg
    unit: string | null;
  };

  export async function insertRecipeIngredient(
    client: Client,
    overrides: Partial<RecipeIngredientRow> & { recipe_id: string },
  ): Promise<RecipeIngredientRow> {
    const row = {
      id: overrides.id ?? randomUUID(),
      recipe_id: overrides.recipe_id,
      position: overrides.position ?? 1,
      item_name: overrides.item_name ?? "Salt",
      quantity: overrides.quantity ?? null,
      unit: overrides.unit ?? null,
    };
    await client.query(
      `insert into recipe_ingredients (id, recipe_id, position, item_name, quantity, unit)
       values ($1,$2,$3,$4,$5,$6)`,
      [row.id, row.recipe_id, row.position, row.item_name, row.quantity, row.unit],
    );
    return row;
  }

  export type RecipeStepRow = {
    id: string;
    recipe_id: string;
    position: number;
    instruction: string;
  };

  export async function insertRecipeStep(
    client: Client,
    overrides: Partial<RecipeStepRow> & { recipe_id: string },
  ): Promise<RecipeStepRow> {
    const row = {
      id: overrides.id ?? randomUUID(),
      recipe_id: overrides.recipe_id,
      position: overrides.position ?? 1,
      instruction: overrides.instruction ?? "Do the thing.",
    };
    await client.query(
      `insert into recipe_steps (id, recipe_id, position, instruction)
       values ($1,$2,$3,$4)`,
      [row.id, row.recipe_id, row.position, row.instruction],
    );
    return row;
  }
  ```

- [ ] **Step 2: Write failing tests**

  Create `tests/db/recipe-subtables.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { setJwtClaims, withTransaction } from "../setup";
  import {
    insertHousehold, insertMembership, insertProfile, insertRecipe,
    insertRecipeIngredient, insertRecipeStep,
  } from "../factories";

  describe("recipe_ingredients + recipe_steps RLS", () => {
    it("ingredients/steps for a starter recipe are readable to authenticated users", async () => {
      await withTransaction(async (c) => {
        const starter = await insertRecipe(c, { household_id: null });
        await insertRecipeIngredient(c, { recipe_id: starter.id, item_name: "Rice" });
        await insertRecipeStep(c, { recipe_id: starter.id, instruction: "Cook rice." });
        const me = await insertProfile(c);

        await setJwtClaims(c, { sub: me.clerk_user_id });
        const ing = await c.query(
          "select item_name from recipe_ingredients where recipe_id=$1",
          [starter.id],
        );
        const stp = await c.query(
          "select instruction from recipe_steps where recipe_id=$1",
          [starter.id],
        );
        expect(ing.rows).toHaveLength(1);
        expect(stp.rows).toHaveLength(1);
      });
    });

    it("ingredients for a household recipe are invisible to outsiders", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const outsider = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });
        const r = await insertRecipe(c, {
          household_id: hh.id, created_by_profile_id: owner.id,
        });
        await insertRecipeIngredient(c, { recipe_id: r.id, item_name: "Secret sauce" });

        await setJwtClaims(c, { sub: outsider.clerk_user_id });
        const res = await c.query(
          "select item_name from recipe_ingredients where recipe_id=$1",
          [r.id],
        );
        expect(res.rows).toHaveLength(0);
      });
    });

    it("owner can write ingredients on household recipe; family cannot", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const family = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });
        await insertMembership(c, {
          household_id: hh.id, profile_id: family.id, role: "family_member",
        });
        const r = await insertRecipe(c, {
          household_id: hh.id, created_by_profile_id: owner.id,
        });

        await setJwtClaims(c, { sub: owner.clerk_user_id });
        await expect(
          c.query(
            `insert into recipe_ingredients (recipe_id, position, item_name)
             values ($1, 1, 'Rice')`,
            [r.id],
          ),
        ).resolves.toBeTruthy();

        await setJwtClaims(c, { sub: family.clerk_user_id });
        await expect(
          c.query(
            `insert into recipe_ingredients (recipe_id, position, item_name)
             values ($1, 2, 'Spice')`,
            [r.id],
          ),
        ).rejects.toThrow(/row-level security/);
      });
    });

    it("cascades delete: dropping a recipe drops its ingredients and steps", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });
        const r = await insertRecipe(c, {
          household_id: hh.id, created_by_profile_id: owner.id,
        });
        await insertRecipeIngredient(c, { recipe_id: r.id });
        await insertRecipeStep(c, { recipe_id: r.id });

        await c.query("delete from recipes where id=$1", [r.id]);
        const ing = await c.query("select 1 from recipe_ingredients where recipe_id=$1", [r.id]);
        const stp = await c.query("select 1 from recipe_steps where recipe_id=$1", [r.id]);
        expect(ing.rows).toHaveLength(0);
        expect(stp.rows).toHaveLength(0);
      });
    });
  });
  ```

- [ ] **Step 3: Run failing tests**

  ```bash
  pnpm test tests/db/recipe-subtables.test.ts
  ```

  Expected: fails with `relation "recipe_ingredients" does not exist`.

- [ ] **Step 4: Write the migration**

  Create `supabase/migrations/20260518_001_recipe_subtables.sql`:

  ```sql
  -- Slice 2a — Structured ingredients + steps for recipes.

  create table public.recipe_ingredients (
    id        uuid primary key default gen_random_uuid(),
    recipe_id uuid not null references public.recipes(id) on delete cascade,
    position  int  not null check (position >= 1),
    item_name text not null check (length(item_name) between 1 and 120),
    quantity  numeric,
    unit      text check (unit is null or length(unit) between 1 and 24),
    unique (recipe_id, position)
  );
  create index recipe_ingredients_recipe_id_idx on public.recipe_ingredients (recipe_id);

  create table public.recipe_steps (
    id          uuid primary key default gen_random_uuid(),
    recipe_id   uuid not null references public.recipes(id) on delete cascade,
    position    int  not null check (position >= 1),
    instruction text not null check (length(instruction) between 1 and 2000),
    unique (recipe_id, position)
  );
  create index recipe_steps_recipe_id_idx on public.recipe_steps (recipe_id);

  alter table public.recipe_ingredients enable row level security;
  alter table public.recipe_steps       enable row level security;

  -- Piggy-back on recipes RLS: ingredients/steps inherit visibility/writability.
  create policy recipe_ingredients_read on public.recipe_ingredients
    for select to authenticated
    using (
      exists (select 1 from public.recipes r
              where r.id = recipe_id
                and (
                  (r.household_id is null and (auth.jwt() ->> 'sub') is not null)
                  or public.has_active_membership(r.household_id)
                ))
    );

  create policy recipe_ingredients_write on public.recipe_ingredients
    for all to authenticated
    using (
      exists (select 1 from public.recipes r
              where r.id = recipe_id
                and r.household_id is not null
                and public.is_active_owner_or_maid(r.household_id))
    )
    with check (
      exists (select 1 from public.recipes r
              where r.id = recipe_id
                and r.household_id is not null
                and public.is_active_owner_or_maid(r.household_id))
    );

  create policy recipe_steps_read on public.recipe_steps
    for select to authenticated
    using (
      exists (select 1 from public.recipes r
              where r.id = recipe_id
                and (
                  (r.household_id is null and (auth.jwt() ->> 'sub') is not null)
                  or public.has_active_membership(r.household_id)
                ))
    );

  create policy recipe_steps_write on public.recipe_steps
    for all to authenticated
    using (
      exists (select 1 from public.recipes r
              where r.id = recipe_id
                and r.household_id is not null
                and public.is_active_owner_or_maid(r.household_id))
    )
    with check (
      exists (select 1 from public.recipes r
              where r.id = recipe_id
                and r.household_id is not null
                and public.is_active_owner_or_maid(r.household_id))
    );
  ```

- [ ] **Step 5: Apply + rerun tests**

  ```bash
  pnpm db:reset && pnpm test tests/db/recipe-subtables.test.ts
  ```

  Expected: 4 tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add supabase/migrations/20260518_001_recipe_subtables.sql tests/factories.ts tests/db/recipe-subtables.test.ts
  git commit -m "Add recipe_ingredients + recipe_steps with cascading RLS"
  ```

---

## Task 4: Migration — `household_recipe_hides` + RLS, with tests

**Files:**

- Create: `supabase/migrations/20260519_001_household_recipe_hides.sql`
- Modify: `tests/factories.ts` (add `insertHouseholdRecipeHide`)
- Create: `tests/db/household-recipe-hides.test.ts`

- [ ] **Step 1: Extend factories**

  Append to `tests/factories.ts`:

  ```ts
  export async function insertHouseholdRecipeHide(
    client: Client,
    args: { household_id: string; recipe_id: string; hidden_by_profile_id: string },
  ): Promise<void> {
    await client.query(
      `insert into household_recipe_hides (household_id, recipe_id, hidden_by_profile_id)
       values ($1,$2,$3)`,
      [args.household_id, args.recipe_id, args.hidden_by_profile_id],
    );
  }
  ```

- [ ] **Step 2: Write failing tests**

  Create `tests/db/household-recipe-hides.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { setJwtClaims, withTransaction } from "../setup";
  import {
    insertHousehold, insertMembership, insertProfile, insertRecipe,
  } from "../factories";

  describe("household_recipe_hides", () => {
    it("owner can hide a starter recipe", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });
        const starter = await insertRecipe(c, { household_id: null });

        await setJwtClaims(c, { sub: owner.clerk_user_id });
        await c.query(
          `insert into household_recipe_hides
            (household_id, recipe_id, hidden_by_profile_id)
            values ($1,$2,$3)`,
          [hh.id, starter.id, owner.id],
        );
        const res = await c.query(
          `select 1 from household_recipe_hides
           where household_id=$1 and recipe_id=$2`,
          [hh.id, starter.id],
        );
        expect(res.rows).toHaveLength(1);
      });
    });

    it("rejects hiding a non-starter recipe", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });
        const customRecipe = await insertRecipe(c, {
          household_id: hh.id, created_by_profile_id: owner.id,
        });

        await setJwtClaims(c, { sub: owner.clerk_user_id });
        await expect(
          c.query(
            `insert into household_recipe_hides
              (household_id, recipe_id, hidden_by_profile_id)
              values ($1,$2,$3)`,
            [hh.id, customRecipe.id, owner.id],
          ),
        ).rejects.toThrow(/can only hide starter recipes|row-level security/);
      });
    });

    it("family member cannot hide; owner can; maid can", async () => {
      await withTransaction(async (c) => {
        const owner  = await insertProfile(c);
        const maid   = await insertProfile(c);
        const family = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id,  role: "owner" });
        await insertMembership(c, { household_id: hh.id, profile_id: maid.id,   role: "maid" });
        await insertMembership(c, { household_id: hh.id, profile_id: family.id, role: "family_member" });
        const starter1 = await insertRecipe(c, { household_id: null });
        const starter2 = await insertRecipe(c, { household_id: null });
        const starter3 = await insertRecipe(c, { household_id: null });

        await setJwtClaims(c, { sub: owner.clerk_user_id });
        await expect(c.query(
          `insert into household_recipe_hides (household_id, recipe_id, hidden_by_profile_id)
           values ($1,$2,$3)`,
          [hh.id, starter1.id, owner.id],
        )).resolves.toBeTruthy();

        await setJwtClaims(c, { sub: maid.clerk_user_id });
        await expect(c.query(
          `insert into household_recipe_hides (household_id, recipe_id, hidden_by_profile_id)
           values ($1,$2,$3)`,
          [hh.id, starter2.id, maid.id],
        )).resolves.toBeTruthy();

        await setJwtClaims(c, { sub: family.clerk_user_id });
        await expect(c.query(
          `insert into household_recipe_hides (household_id, recipe_id, hidden_by_profile_id)
           values ($1,$2,$3)`,
          [hh.id, starter3.id, family.id],
        )).rejects.toThrow(/row-level security/);
      });
    });
  });
  ```

- [ ] **Step 3: Run failing tests**

  ```bash
  pnpm test tests/db/household-recipe-hides.test.ts
  ```

  Expected: fails with `relation "household_recipe_hides" does not exist`.

- [ ] **Step 4: Write the migration**

  Create `supabase/migrations/20260519_001_household_recipe_hides.sql`:

  ```sql
  -- Slice 2a — Per-household hide of starter recipes.
  -- Households can "hide" starter recipes they don't want to see; forks live in `recipes` itself.

  create table public.household_recipe_hides (
    household_id          uuid not null references public.households(id) on delete cascade,
    recipe_id             uuid not null references public.recipes(id) on delete cascade,
    hidden_at             timestamptz not null default now(),
    hidden_by_profile_id  uuid not null references public.profiles(id) on delete set null,
    primary key (household_id, recipe_id)
  );

  -- Enforce: only starter recipes can be hidden.
  create or replace function public.household_recipe_hides_check_starter()
    returns trigger language plpgsql as $$
    declare v_household_id uuid;
    begin
      select household_id into v_household_id from public.recipes where id = new.recipe_id;
      if v_household_id is not null then
        raise exception 'can only hide starter recipes' using errcode = '23514';
      end if;
      return new;
    end;
    $$;

  create trigger household_recipe_hides_check_starter
    before insert on public.household_recipe_hides
    for each row execute function public.household_recipe_hides_check_starter();

  alter table public.household_recipe_hides enable row level security;

  create policy hrh_read on public.household_recipe_hides
    for select to authenticated
    using (public.has_active_membership(household_id));

  create policy hrh_insert on public.household_recipe_hides
    for insert to authenticated
    with check (public.is_active_owner_or_maid(household_id));

  create policy hrh_delete on public.household_recipe_hides
    for delete to authenticated
    using (public.is_active_owner_or_maid(household_id));
  ```

- [ ] **Step 5: Apply + rerun**

  ```bash
  pnpm db:reset && pnpm test tests/db/household-recipe-hides.test.ts
  ```

  Expected: 3 tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add supabase/migrations/20260519_001_household_recipe_hides.sql tests/factories.ts tests/db/household-recipe-hides.test.ts
  git commit -m "Add household_recipe_hides with starter-only check"
  ```

---

## Task 5: Migration — `meal_plans` table + RLS, with tests

> Note: the `is_active_owner_or_maid` helper used by this table's policies was defined in Task 2's migration (alongside the recipes table). This task is solely the `meal_plans` table.

**Files:**

- Create: `supabase/migrations/20260520_001_meal_plans.sql`
- Modify: `tests/factories.ts` (add `insertMealPlan`)
- Create: `tests/db/meal-plans.test.ts`

- [ ] **Step 1: Extend factories**

  Append to `tests/factories.ts`:

  ```ts
  export type MealPlanRow = {
    id: string;
    household_id: string;
    plan_date: string;          // YYYY-MM-DD
    slot: RecipeSlot;
    recipe_id: string | null;
    set_by_profile_id: string | null;
  };

  export async function insertMealPlan(
    client: Client,
    overrides: Partial<MealPlanRow> & { household_id: string; plan_date: string; slot: RecipeSlot },
  ): Promise<MealPlanRow> {
    const row: MealPlanRow = {
      id: overrides.id ?? randomUUID(),
      household_id: overrides.household_id,
      plan_date: overrides.plan_date,
      slot: overrides.slot,
      recipe_id: overrides.recipe_id ?? null,
      set_by_profile_id: overrides.set_by_profile_id ?? null,
    };
    await client.query(
      `insert into meal_plans
         (id, household_id, plan_date, slot, recipe_id, set_by_profile_id)
       values ($1,$2,$3,$4,$5,$6)`,
      [row.id, row.household_id, row.plan_date, row.slot, row.recipe_id, row.set_by_profile_id],
    );
    return row;
  }
  ```

- [ ] **Step 2: Write failing tests**

  Create `tests/db/meal-plans.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { setJwtClaims, withTransaction } from "../setup";
  import {
    insertHousehold, insertMealPlan, insertMembership, insertProfile, insertRecipe,
  } from "../factories";

  describe("meal_plans RLS + invariants", () => {
    it("members can read; outsiders cannot", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const outsider = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });
        const r = await insertRecipe(c, {
          household_id: hh.id, created_by_profile_id: owner.id,
        });
        await insertMealPlan(c, {
          household_id: hh.id, plan_date: "2026-05-12", slot: "lunch", recipe_id: r.id,
        });

        await setJwtClaims(c, { sub: owner.clerk_user_id });
        let res = await c.query("select count(*)::int n from meal_plans where household_id=$1", [hh.id]);
        expect(res.rows[0].n).toBe(1);

        await setJwtClaims(c, { sub: outsider.clerk_user_id });
        res = await c.query("select count(*)::int n from meal_plans where household_id=$1", [hh.id]);
        expect(res.rows[0].n).toBe(0);
      });
    });

    it("owner + maid can write; family cannot", async () => {
      await withTransaction(async (c) => {
        const owner  = await insertProfile(c);
        const maid   = await insertProfile(c);
        const family = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id,  role: "owner" });
        await insertMembership(c, { household_id: hh.id, profile_id: maid.id,   role: "maid" });
        await insertMembership(c, { household_id: hh.id, profile_id: family.id, role: "family_member" });
        const r = await insertRecipe(c, {
          household_id: hh.id, created_by_profile_id: owner.id,
        });

        await setJwtClaims(c, { sub: owner.clerk_user_id });
        await expect(c.query(
          `insert into meal_plans (household_id, plan_date, slot, recipe_id, set_by_profile_id)
           values ($1,$2,'breakfast',$3,$4)`,
          [hh.id, "2026-05-12", r.id, owner.id],
        )).resolves.toBeTruthy();

        await setJwtClaims(c, { sub: maid.clerk_user_id });
        await expect(c.query(
          `insert into meal_plans (household_id, plan_date, slot, recipe_id, set_by_profile_id)
           values ($1,$2,'lunch',$3,$4)`,
          [hh.id, "2026-05-12", r.id, maid.id],
        )).resolves.toBeTruthy();

        await setJwtClaims(c, { sub: family.clerk_user_id });
        await expect(c.query(
          `insert into meal_plans (household_id, plan_date, slot, recipe_id, set_by_profile_id)
           values ($1,$2,'dinner',$3,$4)`,
          [hh.id, "2026-05-12", r.id, family.id],
        )).rejects.toThrow(/row-level security/);
      });
    });

    it("UNIQUE (household_id, plan_date, slot) prevents duplicates", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });
        const r = await insertRecipe(c, { household_id: hh.id, created_by_profile_id: owner.id });

        await insertMealPlan(c, {
          household_id: hh.id, plan_date: "2026-05-12", slot: "lunch", recipe_id: r.id,
        });
        await expect(
          insertMealPlan(c, {
            household_id: hh.id, plan_date: "2026-05-12", slot: "lunch", recipe_id: null,
          }),
        ).rejects.toThrow(/duplicate key|unique/);
      });
    });

    it("ON DELETE SET NULL clears recipe_id when recipe is hard-deleted", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });
        const r = await insertRecipe(c, { household_id: hh.id, created_by_profile_id: owner.id });
        const mp = await insertMealPlan(c, {
          household_id: hh.id, plan_date: "2026-05-12", slot: "lunch", recipe_id: r.id,
        });

        await c.query("delete from recipes where id=$1", [r.id]);
        const res = await c.query("select recipe_id from meal_plans where id=$1", [mp.id]);
        expect(res.rows[0].recipe_id).toBeNull();
      });
    });
  });
  ```

- [ ] **Step 3: Run failing tests**

  ```bash
  pnpm test tests/db/meal-plans.test.ts
  ```

  Expected: fails with `relation "meal_plans" does not exist`.

- [ ] **Step 4: Write the migration**

  Create `supabase/migrations/20260520_001_meal_plans.sql`:

  ```sql
  -- Slice 2a — Meal plan rows (one per household × date × slot).
  -- The `is_active_owner_or_maid` helper used by these policies is defined in
  -- 20260517_001_recipes.sql (shared with the recipes table writes).

  create table public.meal_plans (
    id                 uuid primary key default gen_random_uuid(),
    household_id       uuid not null references public.households(id) on delete cascade,
    plan_date          date not null,
    slot               public.meal_slot not null,
    recipe_id          uuid references public.recipes(id) on delete set null,
    set_by_profile_id  uuid references public.profiles(id) on delete set null,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    unique (household_id, plan_date, slot)
  );

  create index meal_plans_household_date_idx
    on public.meal_plans (household_id, plan_date desc);
  create index meal_plans_household_slot_date_idx
    on public.meal_plans (household_id, slot, plan_date desc);

  create trigger meal_plans_touch_updated_at
    before update on public.meal_plans
    for each row execute function public.touch_updated_at();

  alter table public.meal_plans enable row level security;

  create policy meal_plans_read on public.meal_plans
    for select to authenticated
    using (public.has_active_membership(household_id));

  create policy meal_plans_insert on public.meal_plans
    for insert to authenticated
    with check (public.is_active_owner_or_maid(household_id));

  create policy meal_plans_update on public.meal_plans
    for update to authenticated
    using (public.is_active_owner_or_maid(household_id))
    with check (public.is_active_owner_or_maid(household_id));

  create policy meal_plans_delete on public.meal_plans
    for delete to authenticated
    using (public.is_active_owner_or_maid(household_id));
  ```

- [ ] **Step 5: Apply + rerun**

  ```bash
  pnpm db:reset && pnpm test tests/db/meal-plans.test.ts
  ```

  Expected: 4 tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add supabase/migrations/20260520_001_meal_plans.sql tests/factories.ts tests/db/meal-plans.test.ts
  git commit -m "Add meal_plans table + owner/maid-write RLS"
  ```

---

## Task 6: Migration — `effective_recipes()` function, with tests

**Files:**

- Create: `supabase/migrations/20260521_001_effective_recipes.sql`
- Create: `tests/db/effective-recipes.test.ts`

- [ ] **Step 1: Write failing tests**

  Create `tests/db/effective-recipes.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { setJwtClaims, withTransaction } from "../setup";
  import {
    insertHousehold, insertHouseholdRecipeHide, insertMembership,
    insertProfile, insertRecipe,
  } from "../factories";

  describe("effective_recipes(household)", () => {
    it("returns starters + household-owned, minus forks/hides/archived", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });

        // Starters
        const s1 = await insertRecipe(c, { household_id: null, name: "Nasi Lemak", slot: "breakfast" });
        const s2 = await insertRecipe(c, { household_id: null, name: "Chicken Rice", slot: "lunch" });
        const s3 = await insertRecipe(c, { household_id: null, name: "Curry", slot: "dinner" });
        const s4 = await insertRecipe(c, { household_id: null, name: "Kueh", slot: "snacks" });

        // Hide s4
        await insertHouseholdRecipeHide(c, {
          household_id: hh.id, recipe_id: s4.id, hidden_by_profile_id: owner.id,
        });
        // Fork s1
        const fork = await insertRecipe(c, {
          household_id: hh.id, parent_recipe_id: s1.id,
          created_by_profile_id: owner.id, name: "Our Nasi Lemak", slot: "breakfast",
        });
        // Custom (non-fork)
        const custom = await insertRecipe(c, {
          household_id: hh.id, created_by_profile_id: owner.id,
          name: "Family Curry", slot: "dinner",
        });
        // Archived custom
        await insertRecipe(c, {
          household_id: hh.id, created_by_profile_id: owner.id,
          name: "Old Recipe", slot: "lunch",
          archived_at: new Date().toISOString(),
        });

        await setJwtClaims(c, { sub: owner.clerk_user_id });
        const { rows } = await c.query(
          `select id, name from effective_recipes($1) order by name`,
          [hh.id],
        );
        const names = rows.map((r: { name: string }) => r.name);

        expect(names).toContain("Chicken Rice");        // s2 still visible
        expect(names).toContain("Curry");               // s3 visible
        expect(names).toContain("Our Nasi Lemak");      // fork replaces s1
        expect(names).toContain("Family Curry");        // custom
        expect(names).not.toContain("Nasi Lemak");      // s1 replaced by fork
        expect(names).not.toContain("Kueh");            // s4 hidden
        expect(names).not.toContain("Old Recipe");      // archived
      });
    });

    it("returns empty for a household with no membership and no public starters", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });

        await setJwtClaims(c, { sub: owner.clerk_user_id });
        const { rows } = await c.query(
          "select id from effective_recipes($1)",
          [hh.id],
        );
        // Whatever starters exist from prior tests rolled back; result should equal
        // whatever starters this transaction introduced (zero) + household-owned (zero).
        expect(rows).toHaveLength(0);
      });
    });
  });
  ```

- [ ] **Step 2: Run failing tests**

  ```bash
  pnpm test tests/db/effective-recipes.test.ts
  ```

  Expected: fails with `function effective_recipes(uuid) does not exist`.

- [ ] **Step 3: Write the migration**

  Create `supabase/migrations/20260521_001_effective_recipes.sql`:

  ```sql
  -- Slice 2a — effective_recipes(household): the single source of truth for
  -- "what recipes does this household see." Used by library browse + suggestion engine.

  create or replace function public.effective_recipes(p_household uuid)
    returns setof public.recipes
    language sql stable security invoker
    set search_path = public
    as $$
      -- Starter recipes not forked and not hidden by p_household.
      select r.* from public.recipes r
      where r.household_id is null
        and r.archived_at is null
        and not exists (
          select 1 from public.recipes f
          where f.household_id = p_household
            and f.parent_recipe_id = r.id
        )
        and not exists (
          select 1 from public.household_recipe_hides h
          where h.household_id = p_household
            and h.recipe_id = r.id
        )
      union all
      -- Household-owned recipes (forks and customs).
      select r.* from public.recipes r
      where r.household_id = p_household
        and r.archived_at is null;
    $$;

  grant execute on function public.effective_recipes(uuid) to authenticated;
  ```

- [ ] **Step 4: Apply + rerun**

  ```bash
  pnpm db:reset && pnpm test tests/db/effective-recipes.test.ts
  ```

  Expected: 2 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/20260521_001_effective_recipes.sql tests/db/effective-recipes.test.ts
  git commit -m "Add effective_recipes(household) function"
  ```

---

## Task 7: Migration — meal plan RPCs (`set_slot`, `regenerate_slot`, `suggest_for_date`), with tests

**Files:**

- Create: `supabase/migrations/20260522_001_meal_plan_rpcs.sql`
- Create: `tests/db/meal-plan-rpcs.test.ts`

- [ ] **Step 1: Write failing tests**

  Create `tests/db/meal-plan-rpcs.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { setJwtClaims, withTransaction } from "../setup";
  import {
    insertHousehold, insertMealPlan, insertMembership, insertProfile, insertRecipe,
  } from "../factories";

  describe("mealplan RPCs", () => {
    it("mealplan_set_slot upserts and records set_by_profile_id", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });
        const r = await insertRecipe(c, { household_id: hh.id, created_by_profile_id: owner.id, slot: "lunch" });

        await setJwtClaims(c, { sub: owner.clerk_user_id });
        await c.query(`select mealplan_set_slot($1::date, $2::meal_slot, $3::uuid)`,
          ["2026-05-12", "lunch", r.id]);
        const res = await c.query(
          `select recipe_id, set_by_profile_id from meal_plans
           where household_id=$1 and plan_date='2026-05-12' and slot='lunch'`,
          [hh.id],
        );
        expect(res.rows[0].recipe_id).toBe(r.id);
        expect(res.rows[0].set_by_profile_id).toBe(owner.id);
      });
    });

    it("mealplan_regenerate_slot picks a recipe not used in the previous 4 days", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });

        const r1 = await insertRecipe(c, { household_id: hh.id, created_by_profile_id: owner.id, slot: "lunch", name: "R1" });
        const r2 = await insertRecipe(c, { household_id: hh.id, created_by_profile_id: owner.id, slot: "lunch", name: "R2" });
        const r3 = await insertRecipe(c, { household_id: hh.id, created_by_profile_id: owner.id, slot: "lunch", name: "R3" });
        const r4 = await insertRecipe(c, { household_id: hh.id, created_by_profile_id: owner.id, slot: "lunch", name: "R4" });
        const r5 = await insertRecipe(c, { household_id: hh.id, created_by_profile_id: owner.id, slot: "lunch", name: "R5" });

        // Fill the last 4 days with r1..r4
        await insertMealPlan(c, { household_id: hh.id, plan_date: "2026-05-08", slot: "lunch", recipe_id: r1.id });
        await insertMealPlan(c, { household_id: hh.id, plan_date: "2026-05-09", slot: "lunch", recipe_id: r2.id });
        await insertMealPlan(c, { household_id: hh.id, plan_date: "2026-05-10", slot: "lunch", recipe_id: r3.id });
        await insertMealPlan(c, { household_id: hh.id, plan_date: "2026-05-11", slot: "lunch", recipe_id: r4.id });

        await setJwtClaims(c, { sub: owner.clerk_user_id });
        const { rows } = await c.query(
          `select recipe_id from mealplan_regenerate_slot('2026-05-12'::date, 'lunch'::meal_slot)`,
        );
        expect(rows[0].recipe_id).toBe(r5.id);
      });
    });

    it("mealplan_regenerate_slot falls back when library < window", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });

        const r1 = await insertRecipe(c, { household_id: hh.id, created_by_profile_id: owner.id, slot: "lunch", name: "R1" });
        const r2 = await insertRecipe(c, { household_id: hh.id, created_by_profile_id: owner.id, slot: "lunch", name: "R2" });

        await insertMealPlan(c, { household_id: hh.id, plan_date: "2026-05-08", slot: "lunch", recipe_id: r1.id });
        await insertMealPlan(c, { household_id: hh.id, plan_date: "2026-05-09", slot: "lunch", recipe_id: r2.id });
        await insertMealPlan(c, { household_id: hh.id, plan_date: "2026-05-10", slot: "lunch", recipe_id: r1.id });
        await insertMealPlan(c, { household_id: hh.id, plan_date: "2026-05-11", slot: "lunch", recipe_id: r2.id });

        await setJwtClaims(c, { sub: owner.clerk_user_id });
        const { rows } = await c.query(
          `select recipe_id from mealplan_regenerate_slot('2026-05-12'::date, 'lunch'::meal_slot)`,
        );
        // Must pick one of the two existing recipes (fallback)
        expect([r1.id, r2.id]).toContain(rows[0].recipe_id);
      });
    });

    it("mealplan_regenerate_slot returns NULL recipe when library empty for slot", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });
        // Only a breakfast recipe; nothing for lunch.
        await insertRecipe(c, { household_id: hh.id, created_by_profile_id: owner.id, slot: "breakfast" });

        await setJwtClaims(c, { sub: owner.clerk_user_id });
        const { rows } = await c.query(
          `select recipe_id from mealplan_regenerate_slot('2026-05-12'::date, 'lunch'::meal_slot)`,
        );
        expect(rows[0].recipe_id).toBeNull();
      });
    });

    it("mealplan_suggest_for_date is idempotent and skips existing rows", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });
        const rB = await insertRecipe(c, { household_id: hh.id, created_by_profile_id: owner.id, slot: "breakfast" });
        const rL = await insertRecipe(c, { household_id: hh.id, created_by_profile_id: owner.id, slot: "lunch" });
        const rS = await insertRecipe(c, { household_id: hh.id, created_by_profile_id: owner.id, slot: "snacks" });
        const rD = await insertRecipe(c, { household_id: hh.id, created_by_profile_id: owner.id, slot: "dinner" });

        // Pre-set one slot manually
        await insertMealPlan(c, {
          household_id: hh.id, plan_date: "2026-05-13", slot: "lunch",
          recipe_id: rL.id, set_by_profile_id: owner.id,
        });

        // Call as postgres role (no JWT set)
        await c.query(`select mealplan_suggest_for_date('2026-05-13'::date)`);

        const res = await c.query(
          `select slot, recipe_id, set_by_profile_id
           from meal_plans where household_id=$1 and plan_date='2026-05-13'
           order by slot`,
          [hh.id],
        );
        expect(res.rows).toHaveLength(4);
        const lunchRow = res.rows.find((r: { slot: string }) => r.slot === "lunch");
        // Manually-set lunch must remain
        expect(lunchRow.recipe_id).toBe(rL.id);
        expect(lunchRow.set_by_profile_id).toBe(owner.id);

        // Re-run; row count unchanged
        await c.query(`select mealplan_suggest_for_date('2026-05-13'::date)`);
        const res2 = await c.query(
          `select count(*)::int n from meal_plans
           where household_id=$1 and plan_date='2026-05-13'`,
          [hh.id],
        );
        expect(res2.rows[0].n).toBe(4);
      });
    });
  });
  ```

- [ ] **Step 2: Run failing tests**

  ```bash
  pnpm test tests/db/meal-plan-rpcs.test.ts
  ```

  Expected: fails with `function mealplan_set_slot does not exist`.

- [ ] **Step 3: Write the migration**

  Create `supabase/migrations/20260522_001_meal_plan_rpcs.sql`:

  ```sql
  -- Slice 2a — Meal plan RPCs.
  -- Helper to resolve caller's current household (most-recent active membership).
  create or replace function public.current_household_id_for_caller()
    returns uuid
    language sql stable security invoker
    set search_path = public
    as $$
      select hm.household_id
      from public.household_memberships hm
      join public.profiles p on p.id = hm.profile_id
      where p.clerk_user_id = (auth.jwt() ->> 'sub')
        and hm.status = 'active'
      order by hm.joined_at desc, hm.id desc
      limit 1;
    $$;

  -- Manual override / clear a slot.
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

  grant execute on function public.mealplan_set_slot(date, public.meal_slot, uuid) to authenticated;

  -- Pick a fresh recipe for one slot using the non-repeat rule.
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
      -- Try non-repeat eligible
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
      -- Fallback: any eligible regardless of history
      if v_recipe is null then
        select id into v_recipe
        from public.effective_recipes(v_household) r
        where r.slot = p_slot
        order by random()
        limit 1;
      end if;
      -- v_recipe may still be NULL (empty library for slot) — that's valid.
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

  grant execute on function public.mealplan_regenerate_slot(date, public.meal_slot) to authenticated;

  -- Batch suggest for a date across all active households. Called by pg_cron.
  create or replace function public.mealplan_suggest_for_date(p_date date)
    returns void
    language plpgsql security invoker
    set search_path = public
    as $$
    declare
      v_household uuid;
      v_slot      public.meal_slot;
      v_recipe    uuid;
    begin
      for v_household in
        select distinct household_id from public.household_memberships where status = 'active'
      loop
        foreach v_slot in array array['breakfast','lunch','snacks','dinner']::public.meal_slot[]
        loop
          if exists (
            select 1 from public.meal_plans
            where household_id = v_household and plan_date = p_date and slot = v_slot
          ) then
            continue;
          end if;
          -- Non-repeat eligible
          select id into v_recipe
          from public.effective_recipes(v_household) r
          where r.slot = v_slot
            and r.id not in (
              select recipe_id from public.meal_plans
              where household_id = v_household
                and slot = v_slot
                and plan_date between p_date - 4 and p_date - 1
                and recipe_id is not null
            )
          order by random()
          limit 1;
          -- Fallback
          if v_recipe is null then
            select id into v_recipe
            from public.effective_recipes(v_household) r
            where r.slot = v_slot
            order by random()
            limit 1;
          end if;
          insert into public.meal_plans
            (household_id, plan_date, slot, recipe_id, set_by_profile_id)
          values (v_household, p_date, v_slot, v_recipe, null)
          on conflict (household_id, plan_date, slot) do nothing;
          v_recipe := null;
        end loop;
      end loop;
    end;
    $$;

  revoke execute on function public.mealplan_suggest_for_date(date) from public;
  grant  execute on function public.mealplan_suggest_for_date(date) to postgres;
  ```

- [ ] **Step 4: Apply + rerun**

  ```bash
  pnpm db:reset && pnpm test tests/db/meal-plan-rpcs.test.ts
  ```

  Expected: 5 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/20260522_001_meal_plan_rpcs.sql tests/db/meal-plan-rpcs.test.ts
  git commit -m "Add meal plan RPCs (set_slot, regenerate_slot, suggest_for_date)"
  ```

---

## Task 8: Migration — pg_cron schedule

**Files:**

- Create: `supabase/migrations/20260523_001_meal_plan_cron.sql`
- Modify: `tests/db/meal-plan-rpcs.test.ts` (append schedule-presence test)

- [ ] **Step 1: Confirm pre-flight B**

  Pre-flight check B (top of this plan) must be green. If `pg_cron` is not available on the cloud Supabase project, **stop**: append a fallback design to this plan (Vercel Cron route → admin RPC) before continuing.

- [ ] **Step 2: Append a presence test**

  Append to `tests/db/meal-plan-rpcs.test.ts`:

  ```ts
  describe("mealplan cron schedule", () => {
    it("registers a nightly 22:00 SGT schedule", async () => {
      await withTransaction(async (c) => {
        const { rows } = await c.query(
          `select schedule, command from cron.job where jobname = 'mealplan-suggest-tomorrow'`,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].schedule).toBe("0 22 * * *");
        expect(rows[0].command).toMatch(/mealplan_suggest_for_date/);
      });
    });
  });
  ```

- [ ] **Step 3: Run — expect failure**

  ```bash
  pnpm test tests/db/meal-plan-rpcs.test.ts
  ```

  Expected: the new test fails (cron job not registered).

- [ ] **Step 4: Write the migration**

  Create `supabase/migrations/20260523_001_meal_plan_cron.sql`:

  ```sql
  -- Slice 2a — pg_cron schedule for nightly meal plan suggestions.
  -- DB timezone is Asia/Singapore (per foundations); 0 22 * * * = 22:00 SGT.

  create extension if not exists pg_cron;

  do $$ begin
    if exists (select 1 from cron.job where jobname = 'mealplan-suggest-tomorrow') then
      perform cron.unschedule('mealplan-suggest-tomorrow');
    end if;
    perform cron.schedule(
      'mealplan-suggest-tomorrow',
      '0 22 * * *',
      $cmd$ select public.mealplan_suggest_for_date(current_date + 1); $cmd$
    );
  end $$;
  ```

- [ ] **Step 5: Apply + rerun**

  ```bash
  pnpm db:reset && pnpm test tests/db/meal-plan-rpcs.test.ts
  ```

  Expected: 6 tests pass (the new presence test + 5 existing).

- [ ] **Step 6: Commit**

  ```bash
  git add supabase/migrations/20260523_001_meal_plan_cron.sql tests/db/meal-plan-rpcs.test.ts
  git commit -m "Schedule nightly meal-plan suggestion via pg_cron (22:00 SGT)"
  ```

---

## Task 9: Migration — Storage buckets + RLS, with tests

**Files:**

- Create: `supabase/migrations/20260524_001_recipe_storage.sql`
- Create: `tests/db/recipe-storage-rls.test.ts`

- [ ] **Step 1: Confirm pre-flight C**

  Pre-flight check C must be green.

- [ ] **Step 2: Write failing tests**

  Create `tests/db/recipe-storage-rls.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { setJwtClaims, withTransaction } from "../setup";
  import { insertHousehold, insertMembership, insertProfile } from "../factories";

  describe("recipe storage buckets RLS", () => {
    it("both buckets exist", async () => {
      await withTransaction(async (c) => {
        const { rows } = await c.query(
          "select id, public from storage.buckets where id in ('recipe-images-public','recipe-images-household') order by id",
        );
        expect(rows).toEqual([
          { id: "recipe-images-household", public: false },
          { id: "recipe-images-public",    public: true  },
        ]);
      });
    });

    it("member can insert into recipe-images-household under own household prefix", async () => {
      await withTransaction(async (c) => {
        const owner = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });

        await setJwtClaims(c, { sub: owner.clerk_user_id });
        await expect(c.query(
          `insert into storage.objects (bucket_id, name, owner, metadata)
           values ('recipe-images-household', $1, null, '{}'::jsonb)`,
          [`${hh.id}/test.jpg`],
        )).resolves.toBeTruthy();
      });
    });

    it("outsider cannot insert into another household's prefix", async () => {
      await withTransaction(async (c) => {
        const owner    = await insertProfile(c);
        const outsider = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id, role: "owner" });

        await setJwtClaims(c, { sub: outsider.clerk_user_id });
        await expect(c.query(
          `insert into storage.objects (bucket_id, name, owner, metadata)
           values ('recipe-images-household', $1, null, '{}'::jsonb)`,
          [`${hh.id}/sneaky.jpg`],
        )).rejects.toThrow(/row-level security|permission/);
      });
    });

    it("family member cannot insert; owner + maid can", async () => {
      await withTransaction(async (c) => {
        const owner  = await insertProfile(c);
        const maid   = await insertProfile(c);
        const family = await insertProfile(c);
        const hh = await insertHousehold(c, { created_by_profile_id: owner.id });
        await insertMembership(c, { household_id: hh.id, profile_id: owner.id,  role: "owner" });
        await insertMembership(c, { household_id: hh.id, profile_id: maid.id,   role: "maid" });
        await insertMembership(c, { household_id: hh.id, profile_id: family.id, role: "family_member" });

        await setJwtClaims(c, { sub: family.clerk_user_id });
        await expect(c.query(
          `insert into storage.objects (bucket_id, name, owner, metadata)
           values ('recipe-images-household', $1, null, '{}'::jsonb)`,
          [`${hh.id}/family.jpg`],
        )).rejects.toThrow(/row-level security|permission/);
      });
    });
  });
  ```

- [ ] **Step 3: Run failing tests**

  ```bash
  pnpm test tests/db/recipe-storage-rls.test.ts
  ```

  Expected: fails with bucket-not-found / policy missing.

- [ ] **Step 4: Write the migration**

  Create `supabase/migrations/20260524_001_recipe_storage.sql`:

  ```sql
  -- Slice 2a — Recipe image storage buckets + RLS.

  insert into storage.buckets (id, name, public)
    values ('recipe-images-public', 'recipe-images-public', true)
    on conflict (id) do nothing;

  insert into storage.buckets (id, name, public)
    values ('recipe-images-household', 'recipe-images-household', false)
    on conflict (id) do nothing;

  -- Public bucket: anyone may read; only service_role writes.
  create policy storage_recipe_public_read
    on storage.objects for select to public
    using (bucket_id = 'recipe-images-public');

  create policy storage_recipe_public_write
    on storage.objects for insert to public
    with check (
      bucket_id = 'recipe-images-public'
      and auth.role() = 'service_role'
    );

  create policy storage_recipe_public_modify
    on storage.objects for update to public
    using (bucket_id = 'recipe-images-public' and auth.role() = 'service_role')
    with check (bucket_id = 'recipe-images-public' and auth.role() = 'service_role');

  create policy storage_recipe_public_delete
    on storage.objects for delete to public
    using (bucket_id = 'recipe-images-public' and auth.role() = 'service_role');

  -- Household bucket: path is "<household_id>/<recipe_id>.<ext>".
  -- Read = any active member; Write = active owner or maid.
  create policy storage_recipe_hh_read
    on storage.objects for select to authenticated
    using (
      bucket_id = 'recipe-images-household'
      and public.has_active_membership((split_part(name, '/', 1))::uuid)
    );

  create policy storage_recipe_hh_insert
    on storage.objects for insert to authenticated
    with check (
      bucket_id = 'recipe-images-household'
      and public.is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
    );

  create policy storage_recipe_hh_update
    on storage.objects for update to authenticated
    using (
      bucket_id = 'recipe-images-household'
      and public.is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
    )
    with check (
      bucket_id = 'recipe-images-household'
      and public.is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
    );

  create policy storage_recipe_hh_delete
    on storage.objects for delete to authenticated
    using (
      bucket_id = 'recipe-images-household'
      and public.is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
    );
  ```

- [ ] **Step 5: Apply + rerun**

  ```bash
  pnpm db:reset && pnpm test tests/db/recipe-storage-rls.test.ts
  ```

  Expected: 4 tests pass.

- [ ] **Step 6: Commit**

  ```bash
  git add supabase/migrations/20260524_001_recipe_storage.sql tests/db/recipe-storage-rls.test.ts
  git commit -m "Add recipe-images-public + recipe-images-household storage buckets with RLS"
  ```

---

## Task 10: Migration — Starter pack seed (~30 SG recipes)

**Files:**

- Create: `supabase/migrations/20260525_001_starter_pack_seed.sql`

> **Scope note:** v1 ships 30 recipes with name + slot only (no ingredients/steps/photos). Ingredients and steps for each starter, and licensed photos, are a separate workstream (§12 spec risk). The migration is additive — a later migration can fill `recipe_ingredients` and `recipe_steps` for the same recipe ids.

- [ ] **Step 1: Write the migration**

  Create `supabase/migrations/20260525_001_starter_pack_seed.sql`:

  ```sql
  -- Slice 2a — Starter pack: 30 common SG household recipes.
  -- v1 carries name + slot only. Ingredients/steps/photos to follow in a later migration.

  insert into public.recipes (id, household_id, parent_recipe_id, name, slot, created_by_profile_id) values
    -- Breakfast (8)
    (gen_random_uuid(), null, null, 'Kaya Toast with Soft-Boiled Eggs', 'breakfast', null),
    (gen_random_uuid(), null, null, 'Nasi Lemak',                       'breakfast', null),
    (gen_random_uuid(), null, null, 'Roti Prata with Dhal',              'breakfast', null),
    (gen_random_uuid(), null, null, 'Mee Goreng',                        'breakfast', null),
    (gen_random_uuid(), null, null, 'Idli with Sambar',                  'breakfast', null),
    (gen_random_uuid(), null, null, 'Bee Hoon Soup',                     'breakfast', null),
    (gen_random_uuid(), null, null, 'Congee with Pork Floss',            'breakfast', null),
    (gen_random_uuid(), null, null, 'Oats with Banana',                  'breakfast', null),
    -- Lunch (8)
    (gen_random_uuid(), null, null, 'Hainanese Chicken Rice',            'lunch', null),
    (gen_random_uuid(), null, null, 'Char Kway Teow',                    'lunch', null),
    (gen_random_uuid(), null, null, 'Laksa',                             'lunch', null),
    (gen_random_uuid(), null, null, 'Fried Rice with Egg',               'lunch', null),
    (gen_random_uuid(), null, null, 'Bak Kut Teh',                       'lunch', null),
    (gen_random_uuid(), null, null, 'Wonton Noodles',                    'lunch', null),
    (gen_random_uuid(), null, null, 'Vegetable Briyani',                 'lunch', null),
    (gen_random_uuid(), null, null, 'Hokkien Mee',                       'lunch', null),
    -- Snacks (6)
    (gen_random_uuid(), null, null, 'Ondeh-Ondeh',                       'snacks', null),
    (gen_random_uuid(), null, null, 'Kueh Lapis',                        'snacks', null),
    (gen_random_uuid(), null, null, 'Fresh Fruit Bowl',                  'snacks', null),
    (gen_random_uuid(), null, null, 'Curry Puffs',                       'snacks', null),
    (gen_random_uuid(), null, null, 'Coconut Pancakes',                  'snacks', null),
    (gen_random_uuid(), null, null, 'Yam Cake',                          'snacks', null),
    -- Dinner (8)
    (gen_random_uuid(), null, null, 'Sambal Kangkong with Rice',         'dinner', null),
    (gen_random_uuid(), null, null, 'Steamed Fish with Ginger',          'dinner', null),
    (gen_random_uuid(), null, null, 'Black Pepper Beef',                 'dinner', null),
    (gen_random_uuid(), null, null, 'Dhal Curry with Roti',              'dinner', null),
    (gen_random_uuid(), null, null, 'Sweet & Sour Pork',                 'dinner', null),
    (gen_random_uuid(), null, null, 'Stir-fried Tofu and Vegetables',    'dinner', null),
    (gen_random_uuid(), null, null, 'Chicken Curry with Rice',           'dinner', null),
    (gen_random_uuid(), null, null, 'Mee Soto',                          'dinner', null);
  ```

- [ ] **Step 2: Apply**

  ```bash
  pnpm db:reset
  ```

  Expected: applies cleanly. Verify with:

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" \
    -c "select slot, count(*) from recipes where household_id is null group by slot order by slot;"
  ```

  Expected: 8 breakfast, 8 lunch, 6 snacks, 8 dinner — total 30.

- [ ] **Step 3: Smoke-check via effective_recipes (no auth — runs as postgres)**

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" \
    -c "select count(*) from public.recipes where household_id is null;"
  ```

  Expected: `30`.

- [ ] **Step 4: Run the entire DB test suite to confirm nothing broke**

  ```bash
  pnpm test tests/db
  ```

  Expected: all DB tests still pass (including foundations).

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/20260525_001_starter_pack_seed.sql
  git commit -m "Seed 30 SG starter pack recipes (name + slot only; details + photos to follow)"
  ```

---

## Task 11: Extend `src/lib/db/types.ts` with slice 2a types

**Files:**

- Modify: `src/lib/db/types.ts`

- [ ] **Step 1: Read the existing file**

  Run:

  ```bash
  grep -c "household_memberships" src/lib/db/types.ts
  ```

  Expected: at least 1 match (the foundations types).

- [ ] **Step 2: Add new table types**

  Append to `src/lib/db/types.ts`, **inside the existing `public.Tables` object** (not at the file end). For each new table, follow the shape used by foundations tables. The exact text to insert depends on the existing layout — use the household_memberships entry as the template. For each of `recipes`, `recipe_ingredients`, `recipe_steps`, `household_recipe_hides`, `meal_plans`, add a `{ Row, Insert, Update, Relationships: [] }` block.

  Skeleton (apply analogously to all five new tables; full text shown for one as a worked example):

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
    };
    Update: Partial<Database["public"]["Tables"]["recipes"]["Insert"]>;
    Relationships: [];
  };
  ```

  Apply the same pattern for `recipe_ingredients` (id/recipe_id/position/item_name/quantity/unit), `recipe_steps` (id/recipe_id/position/instruction), `household_recipe_hides` (composite key, no `id`), and `meal_plans` (id/household_id/plan_date/slot/recipe_id/set_by_profile_id/created_at/updated_at).

- [ ] **Step 3: Add the enum to `Enums`**

  In the same file, find the `Enums` block (foundations defines membership role/status/privilege enums). Add:

  ```ts
  meal_slot: "breakfast" | "lunch" | "snacks" | "dinner";
  ```

- [ ] **Step 4: Add function types to `Functions`**

  ```ts
  effective_recipes: {
    Args: { p_household: string };
    Returns: Database["public"]["Tables"]["recipes"]["Row"][];
  };
  mealplan_set_slot: {
    Args: { p_date: string; p_slot: "breakfast" | "lunch" | "snacks" | "dinner"; p_recipe_id: string | null };
    Returns: Database["public"]["Tables"]["meal_plans"]["Row"];
  };
  mealplan_regenerate_slot: {
    Args: { p_date: string; p_slot: "breakfast" | "lunch" | "snacks" | "dinner" };
    Returns: Database["public"]["Tables"]["meal_plans"]["Row"];
  };
  is_active_owner_or_maid: {
    Args: { p_household: string };
    Returns: boolean;
  };
  ```

- [ ] **Step 5: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: passes. If errors, the most likely cause is missing trailing semicolons or a mistyped enum value.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/db/types.ts
  git commit -m "Extend Database types for slice 2a tables, enum, RPCs"
  ```

---

## Task 12: Add shadcn UI primitives needed by the slice

**Files:**

- Create: `src/components/ui/sheet.tsx`
- Create: `src/components/ui/textarea.tsx`
- Create: `src/components/ui/dropdown-menu.tsx`
- Create: `src/components/ui/dialog.tsx`

- [ ] **Step 1: Install the shadcn primitives**

  ```bash
  pnpm dlx shadcn@latest add sheet textarea dropdown-menu dialog
  ```

  Expected: creates four files under `src/components/ui/`. Lockfile updates with `@radix-ui/*` packages.

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: passes.

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/ui/sheet.tsx src/components/ui/textarea.tsx src/components/ui/dropdown-menu.tsx src/components/ui/dialog.tsx package.json pnpm-lock.yaml
  git commit -m "Add shadcn primitives needed by slice 2a (sheet, textarea, dropdown-menu, dialog)"
  ```

---

## Task 13: Server actions — recipes (createRecipe, updateRecipe, archive, hide)

**Files:**

- Create: `src/app/recipes/actions.ts`
- Create: `tests/actions/recipes-actions.test.ts`

- [ ] **Step 1: Write failing tests (skeleton — flesh out with the existing helpers)**

  Create `tests/actions/recipes-actions.test.ts` using the helpers from `tests/helpers/{clerk,next,supabase-test-client}.ts` that foundations landed (HANDOFF "Deferred from review" §1 documents the pattern). At minimum, cover:

  - `createRecipe` happy path inserts a row in the caller's household.
  - `createRecipe` fails for a family-member caller (RLS).
  - `updateRecipe` on a starter recipe id returns a new fork id; ingredients/steps deep-copied.
  - `updateRecipe` on a household recipe updates in place.
  - `archiveRecipe` sets archived_at; subsequent reads via `effective_recipes` exclude it.
  - `hideStarterRecipe` rejects a non-starter recipe.

  (Test code omitted for brevity; follow the same shape as `tests/actions/invites-actions.test.ts` once that lands or build off the helpers directly.)

- [ ] **Step 2: Write `src/app/recipes/actions.ts`**

  ```ts
  "use server";

  import { revalidatePath } from "next/cache";
  import { z } from "zod";
  import { createClient } from "@/lib/supabase/server";
  import { requireHousehold } from "@/lib/auth/require";

  const SlotEnum = z.enum(["breakfast", "lunch", "snacks", "dinner"]);
  const IngredientSchema = z.object({
    item_name: z.string().min(1).max(120),
    quantity: z.number().positive().optional().nullable(),
    unit: z.string().min(1).max(24).optional().nullable(),
  });
  const StepSchema = z.object({
    instruction: z.string().min(1).max(2000),
  });
  const PhotoConstraints = {
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "image/webp"] as const,
  };

  export type RecipeActionResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string> } };

  function validatePhoto(file: File | null): { ok: true } | { ok: false; code: "RECIPE_PHOTO_TOO_LARGE" | "RECIPE_PHOTO_BAD_TYPE"; message: string } {
    if (!file) return { ok: true };
    if (file.size > PhotoConstraints.maxBytes) return { ok: false, code: "RECIPE_PHOTO_TOO_LARGE", message: "Photo exceeds 5 MB." };
    if (!(PhotoConstraints.mimeTypes as readonly string[]).includes(file.type)) {
      return { ok: false, code: "RECIPE_PHOTO_BAD_TYPE", message: "Only JPEG, PNG, or WebP photos are allowed." };
    }
    return { ok: true };
  }

  async function uploadPhoto(supabase: Awaited<ReturnType<typeof createClient>>, householdId: string, recipeId: string, file: File): Promise<string> {
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${householdId}/${recipeId}.${ext}`;
    const { error } = await supabase.storage
      .from("recipe-images-household")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw new Error(error.message);
    return path;
  }

  const CreateRecipeSchema = z.object({
    name: z.string().min(1).max(120),
    slot: SlotEnum,
    prepTimeMinutes: z.number().int().positive().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    ingredients: z.array(IngredientSchema),
    steps: z.array(StepSchema),
  });

  export async function createRecipe(formData: FormData): Promise<RecipeActionResult<{ recipeId: string }>> {
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const photoFile = formData.get("photoFile") as File | null;
    const photoCheck = validatePhoto(photoFile);
    if (!photoCheck.ok) return { ok: false, error: { code: photoCheck.code, message: photoCheck.message } };

    const raw = {
      name: formData.get("name"),
      slot: formData.get("slot"),
      prepTimeMinutes: formData.get("prepTimeMinutes") ? Number(formData.get("prepTimeMinutes")) : null,
      notes: formData.get("notes") || null,
      ingredients: JSON.parse((formData.get("ingredients") as string) || "[]"),
      steps: JSON.parse((formData.get("steps") as string) || "[]"),
    };
    const parsed = CreateRecipeSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: { code: "RECIPE_INVALID", message: "Invalid recipe input", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string> } };
    }

    const { data: recipeRow, error: rErr } = await supabase
      .from("recipes")
      .insert({
        household_id: ctx.household.id,
        name: parsed.data.name,
        slot: parsed.data.slot,
        prep_time_minutes: parsed.data.prepTimeMinutes ?? null,
        notes: parsed.data.notes ?? null,
        created_by_profile_id: ctx.profile.id,
      })
      .select("id")
      .single();
    if (rErr || !recipeRow) return { ok: false, error: { code: "RECIPE_FORBIDDEN", message: rErr?.message ?? "Insert failed" } };

    const ingredientRows = parsed.data.ingredients.map((ing, i) => ({
      recipe_id: recipeRow.id, position: i + 1,
      item_name: ing.item_name, quantity: ing.quantity ?? null, unit: ing.unit ?? null,
    }));
    if (ingredientRows.length > 0) {
      const { error } = await supabase.from("recipe_ingredients").insert(ingredientRows);
      if (error) return { ok: false, error: { code: "RECIPE_FORBIDDEN", message: error.message } };
    }
    const stepRows = parsed.data.steps.map((s, i) => ({
      recipe_id: recipeRow.id, position: i + 1, instruction: s.instruction,
    }));
    if (stepRows.length > 0) {
      const { error } = await supabase.from("recipe_steps").insert(stepRows);
      if (error) return { ok: false, error: { code: "RECIPE_FORBIDDEN", message: error.message } };
    }

    if (photoFile && photoFile.size > 0) {
      const path = await uploadPhoto(supabase, ctx.household.id, recipeRow.id, photoFile);
      await supabase.from("recipes").update({ photo_path: path }).eq("id", recipeRow.id);
    }

    revalidatePath("/recipes");
    revalidatePath("/plan");
    return { ok: true, data: { recipeId: recipeRow.id } };
  }

  const UpdateRecipeSchema = CreateRecipeSchema.partial().extend({
    recipeId: z.string().uuid(),
  });

  export async function updateRecipe(formData: FormData): Promise<RecipeActionResult<{ recipeId: string }>> {
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const photoFile = formData.get("photoFile") as File | null;
    const photoCheck = validatePhoto(photoFile);
    if (!photoCheck.ok) return { ok: false, error: { code: photoCheck.code, message: photoCheck.message } };

    const raw = {
      recipeId: formData.get("recipeId"),
      name: formData.get("name") || undefined,
      slot: formData.get("slot") || undefined,
      prepTimeMinutes: formData.get("prepTimeMinutes") ? Number(formData.get("prepTimeMinutes")) : undefined,
      notes: formData.get("notes") || undefined,
      ingredients: formData.get("ingredients") ? JSON.parse(formData.get("ingredients") as string) : undefined,
      steps: formData.get("steps") ? JSON.parse(formData.get("steps") as string) : undefined,
    };
    const parsed = UpdateRecipeSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: { code: "RECIPE_INVALID", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string> } };

    const { data: target, error: tErr } = await supabase
      .from("recipes")
      .select("id, household_id, parent_recipe_id")
      .eq("id", parsed.data.recipeId)
      .single();
    if (tErr || !target) return { ok: false, error: { code: "RECIPE_NOT_FOUND", message: "Recipe not found" } };

    let effectiveRecipeId = target.id;
    // Fork-on-edit if target is a starter.
    if (target.household_id === null) {
      // Deep-copy starter -> household fork
      const { data: forkRow, error: fErr } = await supabase
        .from("recipes")
        .insert({
          household_id: ctx.household.id,
          parent_recipe_id: target.id,
          name: parsed.data.name ?? "Forked recipe", // will be overwritten below if name provided
          slot: parsed.data.slot ?? "lunch",         // ditto
          created_by_profile_id: ctx.profile.id,
        })
        .select("id")
        .single();
      if (fErr || !forkRow) return { ok: false, error: { code: "RECIPE_FORBIDDEN", message: fErr?.message ?? "Fork failed" } };
      effectiveRecipeId = forkRow.id;
      // Deep-copy ingredients/steps from starter into fork
      const { data: srcIngs } = await supabase.from("recipe_ingredients").select("position,item_name,quantity,unit").eq("recipe_id", target.id);
      if (srcIngs && srcIngs.length > 0) {
        await supabase.from("recipe_ingredients").insert(srcIngs.map((i) => ({ ...i, recipe_id: effectiveRecipeId })));
      }
      const { data: srcSteps } = await supabase.from("recipe_steps").select("position,instruction").eq("recipe_id", target.id);
      if (srcSteps && srcSteps.length > 0) {
        await supabase.from("recipe_steps").insert(srcSteps.map((s) => ({ ...s, recipe_id: effectiveRecipeId })));
      }
    }

    // Apply scalar updates
    const patch: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.slot !== undefined) patch.slot = parsed.data.slot;
    if (parsed.data.prepTimeMinutes !== undefined) patch.prep_time_minutes = parsed.data.prepTimeMinutes;
    if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from("recipes").update(patch).eq("id", effectiveRecipeId);
      if (error) return { ok: false, error: { code: "RECIPE_FORBIDDEN", message: error.message } };
    }

    // Replace ingredients / steps if arrays were provided
    if (parsed.data.ingredients !== undefined) {
      await supabase.from("recipe_ingredients").delete().eq("recipe_id", effectiveRecipeId);
      if (parsed.data.ingredients.length > 0) {
        await supabase.from("recipe_ingredients").insert(parsed.data.ingredients.map((i, idx) => ({
          recipe_id: effectiveRecipeId, position: idx + 1,
          item_name: i.item_name, quantity: i.quantity ?? null, unit: i.unit ?? null,
        })));
      }
    }
    if (parsed.data.steps !== undefined) {
      await supabase.from("recipe_steps").delete().eq("recipe_id", effectiveRecipeId);
      if (parsed.data.steps.length > 0) {
        await supabase.from("recipe_steps").insert(parsed.data.steps.map((s, idx) => ({
          recipe_id: effectiveRecipeId, position: idx + 1, instruction: s.instruction,
        })));
      }
    }

    if (photoFile && photoFile.size > 0) {
      const path = await uploadPhoto(supabase, ctx.household.id, effectiveRecipeId, photoFile);
      await supabase.from("recipes").update({ photo_path: path }).eq("id", effectiveRecipeId);
    }

    revalidatePath("/recipes");
    revalidatePath(`/recipes/${effectiveRecipeId}`);
    revalidatePath("/plan");
    return { ok: true, data: { recipeId: effectiveRecipeId } };
  }

  export async function archiveRecipe(input: { recipeId: string }): Promise<RecipeActionResult<{ recipeId: string }>> {
    await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase.from("recipes").update({ archived_at: new Date().toISOString() }).eq("id", input.recipeId);
    if (error) return { ok: false, error: { code: "RECIPE_FORBIDDEN", message: error.message } };
    revalidatePath("/recipes");
    return { ok: true, data: { recipeId: input.recipeId } };
  }

  export async function unarchiveRecipe(input: { recipeId: string }): Promise<RecipeActionResult<{ recipeId: string }>> {
    await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase.from("recipes").update({ archived_at: null }).eq("id", input.recipeId);
    if (error) return { ok: false, error: { code: "RECIPE_FORBIDDEN", message: error.message } };
    revalidatePath("/recipes");
    return { ok: true, data: { recipeId: input.recipeId } };
  }

  export async function hideStarterRecipe(input: { recipeId: string }): Promise<RecipeActionResult<{ recipeId: string }>> {
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase.from("household_recipe_hides").insert({
      household_id: ctx.household.id, recipe_id: input.recipeId, hidden_by_profile_id: ctx.profile.id,
    });
    if (error) return { ok: false, error: { code: "RECIPE_FORBIDDEN", message: error.message } };
    revalidatePath("/recipes");
    return { ok: true, data: { recipeId: input.recipeId } };
  }

  export async function unhideStarterRecipe(input: { recipeId: string }): Promise<RecipeActionResult<{ recipeId: string }>> {
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase.from("household_recipe_hides")
      .delete()
      .eq("household_id", ctx.household.id)
      .eq("recipe_id", input.recipeId);
    if (error) return { ok: false, error: { code: "RECIPE_FORBIDDEN", message: error.message } };
    revalidatePath("/recipes");
    return { ok: true, data: { recipeId: input.recipeId } };
  }
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: passes. If errors, the most common are missing imports or mismatched Database types from Task 11.

- [ ] **Step 4: Run any landing action tests (skip if you opted not to write them yet)**

  ```bash
  pnpm test tests/actions/recipes-actions.test.ts
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add src/app/recipes/actions.ts tests/actions/recipes-actions.test.ts
  git commit -m "Add recipe server actions (create/update with fork-on-edit/archive/hide)"
  ```

---

## Task 14: Server actions — meal plan (setMealPlanSlot, regenerateMealPlanSlot)

**Files:**

- Create: `src/app/plan/actions.ts`
- Create: `tests/actions/plan-actions.test.ts`

- [ ] **Step 1: Write `src/app/plan/actions.ts`**

  ```ts
  "use server";

  import { revalidatePath } from "next/cache";
  import { z } from "zod";
  import { createClient } from "@/lib/supabase/server";
  import { requireHousehold } from "@/lib/auth/require";

  const SlotEnum = z.enum(["breakfast", "lunch", "snacks", "dinner"]);
  const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

  export type PlanActionResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string } };

  const SetSchema = z.object({
    planDate: DateString,
    slot: SlotEnum,
    recipeId: z.string().uuid().nullable(),
  });

  export async function setMealPlanSlot(input: z.infer<typeof SetSchema>): Promise<PlanActionResult<{ recipeId: string | null }>> {
    const parsed = SetSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "PLAN_INVALID", message: "Invalid input" } };
    await requireHousehold();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("mealplan_set_slot", {
      p_date: parsed.data.planDate,
      p_slot: parsed.data.slot,
      p_recipe_id: parsed.data.recipeId,
    });
    if (error) return { ok: false, error: { code: "PLAN_FORBIDDEN", message: error.message } };
    revalidatePath("/plan");
    revalidatePath(`/plan/${parsed.data.planDate}`);
    return { ok: true, data: { recipeId: data?.recipe_id ?? null } };
  }

  const RegenerateSchema = z.object({
    planDate: DateString,
    slot: SlotEnum,
  });

  export async function regenerateMealPlanSlot(input: z.infer<typeof RegenerateSchema>): Promise<PlanActionResult<{ recipeId: string | null }>> {
    const parsed = RegenerateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "PLAN_INVALID", message: "Invalid input" } };
    await requireHousehold();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("mealplan_regenerate_slot", {
      p_date: parsed.data.planDate,
      p_slot: parsed.data.slot,
    });
    if (error) return { ok: false, error: { code: "PLAN_FORBIDDEN", message: error.message } };
    if (!data?.recipe_id) {
      return { ok: false, error: { code: "MEAL_PLAN_NO_ELIGIBLE_RECIPE", message: "No recipes available for this slot." } };
    }
    revalidatePath("/plan");
    revalidatePath(`/plan/${parsed.data.planDate}`);
    return { ok: true, data: { recipeId: data.recipe_id } };
  }
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: passes.

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/plan/actions.ts tests/actions/plan-actions.test.ts
  git commit -m "Add meal plan server actions (set/regenerate slot)"
  ```

---

## Task 15: UI components for plan (today list, slot row, week strip, action sheet, recipe picker)

**Files:**

- Create: `src/components/plan/today-list.tsx`
- Create: `src/components/plan/slot-row.tsx`
- Create: `src/components/plan/week-strip.tsx`
- Create: `src/components/plan/slot-action-sheet.tsx`
- Create: `src/components/plan/recipe-picker.tsx`

- [ ] **Step 1: Write `slot-row.tsx`**

  ```tsx
  "use client";
  import Image from "next/image";
  import { cn } from "@/lib/utils";

  export type SlotRowProps = {
    slot: "breakfast" | "lunch" | "snacks" | "dinner";
    recipeId: string | null;
    recipeName: string | null;
    photoUrl: string | null;
    setBySystem: boolean;          // true if set_by_profile_id was NULL
    onTap: () => void;
    readOnly: boolean;
  };

  const SLOT_LABEL: Record<SlotRowProps["slot"], string> = {
    breakfast: "Breakfast", lunch: "Lunch", snacks: "Snacks", dinner: "Dinner",
  };

  export function SlotRow({ slot, recipeId, recipeName, photoUrl, setBySystem, onTap, readOnly }: SlotRowProps) {
    return (
      <button
        type="button"
        onClick={onTap}
        className={cn(
          "flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left",
          "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          readOnly && "cursor-default hover:bg-transparent",
        )}
      >
        <div className="size-12 shrink-0 overflow-hidden rounded-md bg-muted">
          {photoUrl ? (
            <Image src={photoUrl} alt={recipeName ?? ""} width={48} height={48} className="size-12 object-cover" />
          ) : (
            <div className="flex size-12 items-center justify-center text-xs text-muted-foreground">no photo</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{SLOT_LABEL[slot]}</div>
          {recipeId === null ? (
            <div className="italic text-muted-foreground">
              {setBySystem ? "No suggestion (library empty)" : "Cleared"}
            </div>
          ) : (
            <div className="truncate font-medium">{recipeName}</div>
          )}
        </div>
      </button>
    );
  }
  ```

- [ ] **Step 2: Write `week-strip.tsx`**

  ```tsx
  "use client";
  import Link from "next/link";
  import { cn } from "@/lib/utils";

  function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

  export function WeekStrip({ activeDate }: { activeDate: string }) {
    const active = new Date(`${activeDate}T00:00:00+08:00`);
    const today = isoDate(new Date());
    const days: { date: string; label: string }[] = [];
    for (let i = -3; i <= 3; i++) {
      const d = new Date(active);
      d.setDate(d.getDate() + i);
      const iso = isoDate(d);
      days.push({ date: iso, label: d.toLocaleDateString("en-SG", { weekday: "narrow" }) });
    }
    return (
      <nav aria-label="Week" className="flex gap-1 border-t border-border px-2 py-2">
        {days.map((d) => (
          <Link
            key={d.date}
            href={`/plan/${d.date}`}
            className={cn(
              "flex-1 rounded-md px-1 py-2 text-center text-xs",
              d.date === activeDate ? "bg-primary text-primary-foreground font-semibold"
                : d.date === today ? "bg-muted font-medium"
                : "hover:bg-muted/60",
            )}
          >
            {d.label}
            <div className="text-[10px] opacity-80">{d.date.slice(8)}</div>
          </Link>
        ))}
      </nav>
    );
  }
  ```

- [ ] **Step 3: Write `recipe-picker.tsx`**

  ```tsx
  "use client";
  import { useState } from "react";
  import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
  import { Input } from "@/components/ui/input";
  import { Button } from "@/components/ui/button";

  export type Recipe = { id: string; name: string; slot: string; photo_url: string | null };

  export function RecipePicker({
    slot, recipes, onPick, trigger,
  }: { slot: string; recipes: Recipe[]; onPick: (recipeId: string) => void; trigger: React.ReactNode }) {
    const [q, setQ] = useState("");
    const filtered = recipes
      .filter((r) => r.slot === slot)
      .filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
    return (
      <Dialog>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Pick a {slot} recipe</DialogTitle></DialogHeader>
          <Input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="max-h-80 overflow-y-auto">
            {filtered.map((r) => (
              <li key={r.id} className="border-b border-border last:border-0">
                <Button variant="ghost" className="w-full justify-start" onClick={() => onPick(r.id)}>
                  {r.name}
                </Button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="py-4 text-center text-sm text-muted-foreground">No recipes match</li>
            )}
          </ul>
        </DialogContent>
      </Dialog>
    );
  }
  ```

- [ ] **Step 4: Write `slot-action-sheet.tsx`**

  ```tsx
  "use client";
  import { useTransition } from "react";
  import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
  import { Button } from "@/components/ui/button";
  import { RecipePicker, type Recipe } from "./recipe-picker";
  import { setMealPlanSlot, regenerateMealPlanSlot } from "@/app/plan/actions";

  export type SlotActionSheetProps = {
    planDate: string;
    slot: "breakfast" | "lunch" | "snacks" | "dinner";
    currentRecipeId: string | null;
    currentRecipeName: string | null;
    recipes: Recipe[];
    readOnly: boolean;
    trigger: React.ReactNode;
  };

  export function SlotActionSheet(props: SlotActionSheetProps) {
    const [pending, start] = useTransition();
    const onPick = (recipeId: string) => {
      start(async () => { await setMealPlanSlot({ planDate: props.planDate, slot: props.slot, recipeId }); });
    };
    const onRegenerate = () => {
      start(async () => { await regenerateMealPlanSlot({ planDate: props.planDate, slot: props.slot }); });
    };
    const onClear = () => {
      start(async () => { await setMealPlanSlot({ planDate: props.planDate, slot: props.slot, recipeId: null }); });
    };

    return (
      <Sheet>
        <SheetTrigger asChild>{props.trigger}</SheetTrigger>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>{props.currentRecipeName ?? "No recipe set"}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-2 py-4">
            {props.currentRecipeId && (
              <Button variant="outline" asChild>
                <a href={`/recipes/${props.currentRecipeId}`}>View recipe</a>
              </Button>
            )}
            {!props.readOnly && (
              <>
                <RecipePicker
                  slot={props.slot}
                  recipes={props.recipes}
                  onPick={onPick}
                  trigger={<Button variant="outline" disabled={pending}>Pick different</Button>}
                />
                <Button variant="outline" disabled={pending} onClick={onRegenerate}>Regenerate</Button>
                <Button variant="ghost" disabled={pending} onClick={onClear}>Clear</Button>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    );
  }
  ```

- [ ] **Step 5: Write `today-list.tsx`**

  ```tsx
  "use client";
  import { SlotRow } from "./slot-row";
  import { SlotActionSheet } from "./slot-action-sheet";
  import type { Recipe } from "./recipe-picker";

  type Slot = "breakfast" | "lunch" | "snacks" | "dinner";
  const ORDER: Slot[] = ["breakfast", "lunch", "snacks", "dinner"];

  export type TodayListProps = {
    planDate: string;
    rows: Record<Slot, { recipeId: string | null; recipeName: string | null; photoUrl: string | null; setBySystem: boolean }>;
    recipes: Recipe[];
    readOnly: boolean;
  };

  export function TodayList({ planDate, rows, recipes, readOnly }: TodayListProps) {
    return (
      <div className="flex flex-col">
        {ORDER.map((s) => {
          const row = rows[s];
          return (
            <SlotActionSheet
              key={s}
              planDate={planDate}
              slot={s}
              currentRecipeId={row.recipeId}
              currentRecipeName={row.recipeName}
              recipes={recipes}
              readOnly={readOnly}
              trigger={
                <div role="button">
                  <SlotRow
                    slot={s}
                    recipeId={row.recipeId}
                    recipeName={row.recipeName}
                    photoUrl={row.photoUrl}
                    setBySystem={row.setBySystem}
                    onTap={() => {}}
                    readOnly={readOnly}
                  />
                </div>
              }
            />
          );
        })}
      </div>
    );
  }
  ```

- [ ] **Step 6: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: passes. If errors, most commonly missing utility imports (`@/lib/utils`'s `cn`) or shadcn primitives not yet installed (verify Task 12).

- [ ] **Step 7: Commit**

  ```bash
  git add src/components/plan
  git commit -m "Add plan UI components (today list, slot row, week strip, action sheet, recipe picker)"
  ```

---

## Task 16: Pages `/plan` and `/plan/[date]`

**Files:**

- Create: `src/app/plan/page.tsx`
- Create: `src/app/plan/[date]/page.tsx`

- [ ] **Step 1: Write `src/app/plan/page.tsx`**

  ```tsx
  import { redirect } from "next/navigation";

  export default function PlanIndex() {
    const today = new Date().toISOString().slice(0, 10);
    redirect(`/plan/${today}`);
  }
  ```

- [ ] **Step 2: Write `src/app/plan/[date]/page.tsx`**

  ```tsx
  import { requireHousehold } from "@/lib/auth/require";
  import { createClient } from "@/lib/supabase/server";
  import { TodayList } from "@/components/plan/today-list";
  import { WeekStrip } from "@/components/plan/week-strip";
  import type { Recipe } from "@/components/plan/recipe-picker";

  type Slot = "breakfast" | "lunch" | "snacks" | "dinner";
  const ALL_SLOTS: Slot[] = ["breakfast", "lunch", "snacks", "dinner"];

  export default async function PlanForDate({ params }: { params: Promise<{ date: string }> }) {
    const { date } = await params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return <main className="p-4">Invalid date.</main>;
    }
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const readOnly = ctx.membership.role === "family_member";

    const { data: rawRows } = await supabase
      .from("meal_plans")
      .select("slot, recipe_id, set_by_profile_id, recipes(name, photo_path, household_id)")
      .eq("household_id", ctx.household.id)
      .eq("plan_date", date);

    // Sequential awaits via for-of because Supabase signed URLs are async.
    const rows = {} as TodayListProps["rows"];
    for (const s of ALL_SLOTS) {
      const r = rawRows?.find((x: any) => x.slot === s);
      const recipe = r?.recipes as { name: string; photo_path: string | null; household_id: string | null } | null;
      let photoUrl: string | null = null;
      if (recipe?.photo_path) {
        if (recipe.household_id === null) {
          photoUrl = supabase.storage.from("recipe-images-public").getPublicUrl(recipe.photo_path).data.publicUrl;
        } else {
          const { data } = await supabase.storage.from("recipe-images-household").createSignedUrl(recipe.photo_path, 3600);
          photoUrl = data?.signedUrl ?? null;
        }
      }
      rows[s] = {
        recipeId: r?.recipe_id ?? null,
        recipeName: recipe?.name ?? null,
        photoUrl,
        setBySystem: r?.set_by_profile_id === null,
      };
    }

    const { data: effectiveRecipes } = await supabase
      .rpc("effective_recipes", { p_household: ctx.household.id });
    const recipes: Recipe[] = (effectiveRecipes ?? []).map((r: any) => ({
      id: r.id, name: r.name, slot: r.slot, photo_url: null,
    }));

    return (
      <main className="mx-auto max-w-md">
        <header className="px-4 py-3">
          <h1 className="text-lg font-semibold">{date === new Date().toISOString().slice(0, 10) ? "Today" : "Plan"} · {date}</h1>
        </header>
        <TodayList planDate={date} rows={rows} recipes={recipes} readOnly={readOnly} />
        <WeekStrip activeDate={date} />
      </main>
    );
  }

  type TodayListProps = React.ComponentProps<typeof TodayList>;
  ```

- [ ] **Step 3: Start the dev server and smoke-check**

  ```bash
  pnpm dev
  ```

  Visit `http://localhost:3000/plan`. Expected: redirects to `/plan/<today>`. Page shows 4 slot rows (some may say "No suggestion (library empty)" until the seed pack is reachable via your household's effective library). Week strip renders with 7 days, today highlighted.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/plan/page.tsx src/app/plan/\[date\]/page.tsx
  git commit -m "Add /plan and /plan/[date] pages with today list + week strip"
  ```

---

## Task 17: UI components for recipes (card + detail)

**Files:**

- Create: `src/components/recipes/recipe-card.tsx`
- Create: `src/components/recipes/recipe-detail.tsx`

- [ ] **Step 1: Write `recipe-card.tsx`**

  ```tsx
  import Link from "next/link";
  import Image from "next/image";
  import { Card, CardContent } from "@/components/ui/card";

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
              {photoUrl ? (
                <Image src={photoUrl} alt={name} width={64} height={64} className="size-16 object-cover" />
              ) : null}
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

- [ ] **Step 2: Write `recipe-detail.tsx`**

  ```tsx
  import Image from "next/image";

  export type RecipeDetailProps = {
    name: string;
    slot: "breakfast" | "lunch" | "snacks" | "dinner";
    prepTimeMinutes: number | null;
    photoUrl: string | null;
    notes: string | null;
    ingredients: { position: number; item_name: string; quantity: string | null; unit: string | null }[];
    steps: { position: number; instruction: string }[];
  };

  const SLOT: Record<RecipeDetailProps["slot"], string> = {
    breakfast: "Breakfast", lunch: "Lunch", snacks: "Snacks", dinner: "Dinner",
  };

  export function RecipeDetail(p: RecipeDetailProps) {
    return (
      <article className="mx-auto max-w-2xl">
        {p.photoUrl && (
          <div className="aspect-video w-full overflow-hidden bg-muted">
            <Image src={p.photoUrl} alt={p.name} width={1280} height={720} className="size-full object-cover" />
          </div>
        )}
        <div className="px-4 py-4">
          <h1 className="text-xl font-semibold">{p.name}</h1>
          <div className="mt-1 text-sm text-muted-foreground">
            {SLOT[p.slot]}{p.prepTimeMinutes ? ` · ${p.prepTimeMinutes}m prep` : ""}
          </div>
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

- [ ] **Step 3: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: passes.

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/recipes/recipe-card.tsx src/components/recipes/recipe-detail.tsx
  git commit -m "Add recipe card + recipe detail components"
  ```

---

## Task 18: Page `/recipes` (library browse)

**Files:**

- Create: `src/app/recipes/page.tsx`

- [ ] **Step 1: Write the page**

  ```tsx
  import Link from "next/link";
  import { requireHousehold } from "@/lib/auth/require";
  import { createClient } from "@/lib/supabase/server";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { RecipeCard } from "@/components/recipes/recipe-card";

  type Slot = "breakfast" | "lunch" | "snacks" | "dinner";
  const ALL_SLOTS: Slot[] = ["breakfast", "lunch", "snacks", "dinner"];

  export default async function RecipesIndex({ searchParams }: { searchParams: Promise<{ q?: string; slot?: string }> }) {
    const sp = await searchParams;
    const ctx = await requireHousehold();
    const supabase = await createClient();

    const { data: effective } = await supabase.rpc("effective_recipes", { p_household: ctx.household.id });
    const filtered = (effective ?? [])
      .filter((r: any) => !sp.slot || r.slot === sp.slot)
      .filter((r: any) => !sp.q || r.name.toLowerCase().includes(sp.q.toLowerCase()))
      .filter((r: any) => r.archived_at === null);

    // Compute photo URL per row (public bucket for starter, signed URL for household).
    const cards = await Promise.all(filtered.map(async (r: any) => {
      let photoUrl: string | null = null;
      if (r.photo_path) {
        if (r.household_id === null) {
          photoUrl = supabase.storage.from("recipe-images-public").getPublicUrl(r.photo_path).data.publicUrl;
        } else {
          const { data } = await supabase.storage.from("recipe-images-household").createSignedUrl(r.photo_path, 3600);
          photoUrl = data?.signedUrl ?? null;
        }
      }
      return {
        id: r.id, name: r.name, slot: r.slot, prepTimeMinutes: r.prep_time_minutes,
        photoUrl, isFork: !!r.parent_recipe_id,
      };
    }));

    return (
      <main className="mx-auto max-w-2xl px-4 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Recipes</h1>
          <Link href="/recipes/new"><Button>+ Add</Button></Link>
        </div>
        <form className="mt-4 flex gap-2" action="/recipes" method="get">
          <Input name="q" placeholder="Search" defaultValue={sp.q ?? ""} />
          <select name="slot" defaultValue={sp.slot ?? ""} className="rounded-md border bg-background px-3 text-sm">
            <option value="">All</option>
            {ALL_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <Button type="submit" variant="outline">Filter</Button>
        </form>
        <div className="mt-4 grid gap-2">
          {cards.length === 0 && <p className="py-8 text-center text-muted-foreground">No recipes match.</p>}
          {cards.map((c) => <RecipeCard key={c.id} {...c} />)}
        </div>
      </main>
    );
  }
  ```

- [ ] **Step 2: Smoke-check**

  ```bash
  pnpm dev
  ```

  Visit `/recipes`. Expected: 30 starter cards render; filter by slot works; search narrows.

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/recipes/page.tsx
  git commit -m "Add /recipes library browse with slot filter + search"
  ```

---

## Task 19: Page `/recipes/[id]` (recipe detail)

**Files:**

- Create: `src/app/recipes/[id]/page.tsx`

- [ ] **Step 1: Write the page**

  ```tsx
  import Link from "next/link";
  import { notFound } from "next/navigation";
  import { requireHousehold } from "@/lib/auth/require";
  import { createClient } from "@/lib/supabase/server";
  import { Button, buttonVariants } from "@/components/ui/button";
  import { RecipeDetail } from "@/components/recipes/recipe-detail";
  import { cn } from "@/lib/utils";

  export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { data: recipe } = await supabase.from("recipes")
      .select("id,name,slot,photo_path,prep_time_minutes,notes,household_id,parent_recipe_id,archived_at")
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
      <>
        <header className="flex items-center justify-between border-b border-border px-4 py-2">
          <Link href="/recipes" className="text-sm">← Back</Link>
          {canEdit && (
            <Link href={`/recipes/${id}/edit`} className={cn(buttonVariants({ size: "sm", variant: "outline" }))}>Edit</Link>
          )}
        </header>
        <RecipeDetail
          name={recipe.name}
          slot={recipe.slot as any}
          prepTimeMinutes={recipe.prep_time_minutes}
          photoUrl={photoUrl}
          notes={recipe.notes}
          ingredients={(ingredients ?? []).map((i: any) => ({ ...i, quantity: i.quantity?.toString() ?? null }))}
          steps={steps ?? []}
        />
      </>
    );
  }
  ```

- [ ] **Step 2: Smoke-check**

  Visit `/recipes/<id>` for any starter card from `/recipes`. Expected: detail renders; ingredients/steps sections empty (starter pack v1 ships names only); "Edit" button appears for owner/maid.

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/recipes/\[id\]/page.tsx
  git commit -m "Add /recipes/[id] detail page"
  ```

---

## Task 20: `recipe-form` component + `/recipes/[id]/edit` page

**Files:**

- Create: `src/components/recipes/recipe-form.tsx`
- Create: `src/app/recipes/[id]/edit/page.tsx`

- [ ] **Step 1: Write `recipe-form.tsx`**

  ```tsx
  "use client";
  import { useState, useTransition } from "react";
  import { useRouter } from "next/navigation";
  import imageCompression from "browser-image-compression";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { Textarea } from "@/components/ui/textarea";
  import { createRecipe, updateRecipe } from "@/app/recipes/actions";

  type Slot = "breakfast" | "lunch" | "snacks" | "dinner";

  export type RecipeFormProps = {
    mode: "create" | "edit";
    recipeId?: string;
    initial?: {
      name: string;
      slot: Slot;
      prepTimeMinutes: number | null;
      notes: string | null;
      ingredients: { item_name: string; quantity: number | null; unit: string | null }[];
      steps: { instruction: string }[];
    };
  };

  export function RecipeForm({ mode, recipeId, initial }: RecipeFormProps) {
    const router = useRouter();
    const [pending, start] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [name, setName] = useState(initial?.name ?? "");
    const [slot, setSlot] = useState<Slot>(initial?.slot ?? "lunch");
    const [prep, setPrep] = useState<string>(initial?.prepTimeMinutes?.toString() ?? "");
    const [notes, setNotes] = useState(initial?.notes ?? "");
    const [ingredients, setIngredients] = useState(initial?.ingredients ?? [{ item_name: "", quantity: null, unit: null }]);
    const [steps, setSteps] = useState(initial?.steps ?? [{ instruction: "" }]);
    const [photoFile, setPhotoFile] = useState<File | null>(null);

    async function compressAndSet(file: File) {
      const out = await imageCompression(file, { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true });
      setPhotoFile(out);
    }

    function onSubmit(e: React.FormEvent) {
      e.preventDefault();
      setError(null);
      start(async () => {
        const fd = new FormData();
        if (mode === "edit" && recipeId) fd.append("recipeId", recipeId);
        fd.append("name", name);
        fd.append("slot", slot);
        if (prep) fd.append("prepTimeMinutes", prep);
        fd.append("notes", notes);
        fd.append("ingredients", JSON.stringify(ingredients.filter((i) => i.item_name.trim().length > 0)));
        fd.append("steps", JSON.stringify(steps.filter((s) => s.instruction.trim().length > 0)));
        if (photoFile) fd.append("photoFile", photoFile);
        const res = await (mode === "create" ? createRecipe(fd) : updateRecipe(fd));
        if (!res.ok) { setError(res.error.message); return; }
        router.push(`/recipes/${res.data.recipeId}`);
      });
    }

    return (
      <form className="mx-auto max-w-md space-y-4 p-4" onSubmit={onSubmit}>
        <div>
          <Label htmlFor="photo">Photo</Label>
          <input id="photo" type="file" accept="image/jpeg,image/png,image/webp"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void compressAndSet(f); }} />
        </div>
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </div>
        <div>
          <Label htmlFor="slot">Slot</Label>
          <select id="slot" value={slot} onChange={(e) => setSlot(e.target.value as Slot)}
            className="block w-full rounded-md border bg-background px-3 py-2 text-sm">
            <option value="breakfast">Breakfast</option>
            <option value="lunch">Lunch</option>
            <option value="snacks">Snacks</option>
            <option value="dinner">Dinner</option>
          </select>
        </div>
        <div>
          <Label htmlFor="prep">Prep time (minutes)</Label>
          <Input id="prep" type="number" min={1} value={prep} onChange={(e) => setPrep(e.target.value)} />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Ingredients</legend>
          {ingredients.map((ing, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_5rem_2rem] gap-2">
              <Input placeholder="Item" value={ing.item_name}
                onChange={(e) => setIngredients(ingredients.map((x, idx) => idx === i ? { ...x, item_name: e.target.value } : x))} />
              <Input placeholder="Qty" type="number" value={ing.quantity ?? ""}
                onChange={(e) => setIngredients(ingredients.map((x, idx) => idx === i ? { ...x, quantity: e.target.value ? Number(e.target.value) : null } : x))} />
              <Input placeholder="Unit" value={ing.unit ?? ""}
                onChange={(e) => setIngredients(ingredients.map((x, idx) => idx === i ? { ...x, unit: e.target.value || null } : x))} />
              <Button type="button" variant="ghost" onClick={() => setIngredients(ingredients.filter((_, idx) => idx !== i))}>×</Button>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => setIngredients([...ingredients, { item_name: "", quantity: null, unit: null }])}>+ Add ingredient</Button>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Steps</legend>
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              <Textarea placeholder={`Step ${i + 1}`} value={s.instruction}
                onChange={(e) => setSteps(steps.map((x, idx) => idx === i ? { instruction: e.target.value } : x))} />
              <Button type="button" variant="ghost" onClick={() => setSteps(steps.filter((_, idx) => idx !== i))}>×</Button>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => setSteps([...steps, { instruction: "" }])}>+ Add step</Button>
        </fieldset>
        <div>
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending}>{mode === "create" ? "Create recipe" : "Save changes"}</Button>
      </form>
    );
  }
  ```

- [ ] **Step 2: Write `src/app/recipes/[id]/edit/page.tsx`**

  ```tsx
  import { notFound } from "next/navigation";
  import { requireHousehold } from "@/lib/auth/require";
  import { createClient } from "@/lib/supabase/server";
  import { RecipeForm } from "@/components/recipes/recipe-form";

  export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    await requireHousehold();
    const supabase = await createClient();
    const { data: r } = await supabase.from("recipes")
      .select("id,name,slot,prep_time_minutes,notes").eq("id", id).maybeSingle();
    if (!r) notFound();
    const { data: ingredients } = await supabase.from("recipe_ingredients")
      .select("item_name,quantity,unit").eq("recipe_id", id).order("position");
    const { data: steps } = await supabase.from("recipe_steps")
      .select("instruction").eq("recipe_id", id).order("position");

    return (
      <RecipeForm
        mode="edit"
        recipeId={id}
        initial={{
          name: r.name, slot: r.slot as any, prepTimeMinutes: r.prep_time_minutes, notes: r.notes,
          ingredients: (ingredients ?? []).map((i: any) => ({ item_name: i.item_name, quantity: i.quantity ?? null, unit: i.unit ?? null })),
          steps: (steps ?? []).map((s: any) => ({ instruction: s.instruction })),
        }}
      />
    );
  }
  ```

- [ ] **Step 3: Typecheck + smoke**

  ```bash
  pnpm typecheck && pnpm dev
  ```

  Visit `/recipes/<starter-id>/edit`. Expected: form prefilled; saving creates a fork and redirects to the new (fork) detail.

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/recipes/recipe-form.tsx src/app/recipes/\[id\]/edit/page.tsx
  git commit -m "Add recipe edit form with fork-on-edit + client-side photo compression"
  ```

---

## Task 21: Page `/recipes/new`

**Files:**

- Create: `src/app/recipes/new/page.tsx`

- [ ] **Step 1: Write the page**

  ```tsx
  import { requireHousehold } from "@/lib/auth/require";
  import { RecipeForm } from "@/components/recipes/recipe-form";

  export default async function NewRecipePage() {
    await requireHousehold();
    return <RecipeForm mode="create" />;
  }
  ```

- [ ] **Step 2: Smoke**

  Visit `/recipes/new`. Expected: empty form. Filling it and submitting redirects to `/recipes/<new id>`.

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/recipes/new/page.tsx
  git commit -m "Add /recipes/new create page"
  ```

---

## Task 22: Activate the dashboard's "Recipes & meal plan" card

**Files:**

- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Read the current dashboard**

  ```bash
  cat src/app/dashboard/page.tsx
  ```

  Locate the `["Recipes & meal plan", "Plan today's breakfast, lunch, dinner."]` tuple.

- [ ] **Step 2: Replace the placeholder cards block**

  In `src/app/dashboard/page.tsx`, replace the entire `<section>...Coming soon...</section>` block with:

  ```tsx
  <section className="mt-8">
    <h2 className="text-lg font-medium">What's next</h2>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Recipes &amp; meal plan</CardTitle>
          <CardDescription>Plan today's breakfast, lunch, snacks, dinner.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/plan" className={cn(buttonVariants({ variant: "default" }), "w-full")}>Open plan</Link>
        </CardContent>
      </Card>
      {[
        ["Inventory & bills", "Scan grocery bills, track items."],
        ["Fridge", "Track what's inside, when it expires."],
        ["Tasks", "Recurring household tasks with reminders."],
      ].map(([title, desc]) => (
        <Card key={title} aria-disabled className="opacity-60">
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{desc}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button disabled variant="outline" className="w-full">Soon</Button>
          </CardContent>
        </Card>
      ))}
    </div>
  </section>
  ```

- [ ] **Step 3: Smoke-check**

  ```bash
  pnpm dev
  ```

  Visit `/dashboard`. Expected: "Recipes & meal plan" card has "Open plan" button linking to `/plan`. Other three cards still disabled with "Soon".

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/dashboard/page.tsx
  git commit -m "Activate Recipes & meal plan card on dashboard"
  ```

---

## Task 23: Playwright smoke E2E

**Files:**

- Create: `tests/e2e/recipes-plan.spec.ts`

- [ ] **Step 1: Write a smoke spec**

  Create `tests/e2e/recipes-plan.spec.ts`:

  ```ts
  import { test, expect } from "@playwright/test";

  test.describe("slice 2a smoke (unauthenticated)", () => {
    test("/plan redirects unauthenticated users to /onboarding via proxy.ts", async ({ page }) => {
      await page.goto("/plan");
      // Foundations proxy should send unauthenticated users to /onboarding or sign-in.
      await expect(page).toHaveURL(/\/(onboarding|sign-in)/);
    });

    test("/recipes is also gated", async ({ page }) => {
      await page.goto("/recipes");
      await expect(page).toHaveURL(/\/(onboarding|sign-in)/);
    });

    test("/dashboard shows the Recipes card with an active button when authenticated (manual)", async () => {
      test.skip(true, "Authenticated smoke requires Clerk test mode setup — covered in manual checklist.");
    });
  });
  ```

  > Authenticated E2E coverage depends on Clerk test mode setup that foundations punted on. The smoke here verifies the routes exist and are gated; the manual walkthrough (Task 24) covers the rest.

- [ ] **Step 2: Run**

  ```bash
  pnpm test:e2e -- recipes-plan
  ```

  Expected: 2 tests pass (the skipped test is reported as skipped).

- [ ] **Step 3: Commit**

  ```bash
  git add tests/e2e/recipes-plan.spec.ts
  git commit -m "Add Playwright smoke for /plan and /recipes route gating"
  ```

---

## Task 24: Manual walkthrough + HANDOFF update

**Files:**

- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Run the full local verification gate**

  ```bash
  pnpm db:reset && pnpm typecheck && pnpm test && pnpm test:e2e
  ```

  Expected: DB migrations apply cleanly; typecheck clean; vitest passes (foundations + slice 2a totals); Playwright passes (foundations smoke + slice 2a smoke).

- [ ] **Step 2: Manual walkthrough (mobile viewport + desktop)**

  In two browser sessions (one owner, one maid in the same household):

  1. **Owner adds a custom recipe.** `/recipes/new` → fill name, slot=lunch, ingredients (3 rows), steps (3 rows), upload a JPEG. Submit. Lands on `/recipes/<new id>`; refreshes to show the new card on `/recipes`.

  2. **Owner edits a starter recipe.** Pick any starter from `/recipes` → tap **Edit**. Change the name to "<original> (our way)" → save. Lands on a NEW id (the fork). `/recipes` now shows the customized version with a "Customized" pill; the original starter has disappeared from the list.

  3. **Owner overrides today's lunch.** `/plan` → tap lunch slot → **Pick different** → choose one of the household recipes. Slot updates immediately.

  4. **Maid logs in (different browser).** `/plan` shows the override owner set in step 3. **Regenerate** breakfast → different recipe each click (until library < window).

  5. **Family member logs in.** `/plan` shows the rows; tapping a slot opens the sheet but only **View recipe** is visible. **+ Add** is not on `/recipes`.

  6. **Cron simulation.** Run `psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "select mealplan_suggest_for_date(current_date + 1);"`. Visit `/plan/<tomorrow>` as the maid → all four slots are pre-filled. Override one → it's preserved when re-running the function.

- [ ] **Step 3: Update `docs/HANDOFF.md`**

  Append a new section under "Status" capturing slice 2a's completion (mirroring the foundations entries). Use this template:

  ```markdown
  ### Slice 2a — Recipes & meal plan (done)

  - 9 migrations: recipes / subtables / hides / meal_plans / effective_recipes / RPCs / cron / storage / seed
  - effective_recipes(household), is_active_owner_or_maid(household)
  - pg_cron job `mealplan-suggest-tomorrow` at 22:00 SGT
  - Server actions: recipes (create/update with fork-on-edit, archive, hide), plan (set/regenerate slot)
  - UI: /plan, /plan/[date], /recipes, /recipes/[id], /recipes/[id]/edit, /recipes/new; dashboard card now active
  - 30 starter recipes seeded (names only — ingredients/steps/photos pending in a follow-up)
  - Family is read-only in v1 (meal_modify privilege parked)

  Verified locally on 2026-MM-DD: `pnpm db:reset && pnpm test && pnpm test:e2e` all green.
  ```

  Also append a "Deferred" entry:

  ```markdown
  - **Slice 2a deferred**: starter pack ingredients/steps/photos; server-action tests (per user instruction to revisit tests later); admin starter-pack UI (slice 7).
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add docs/HANDOFF.md
  git commit -m "Update HANDOFF: slice 2a complete"
  ```

- [ ] **Step 5: Push (when ready)**

  ```bash
  git push origin main
  ```

---

## Verification gate (final)

- [ ] **Run the full test suite**

  ```bash
  pnpm db:reset && pnpm typecheck && pnpm test && pnpm test:e2e
  ```

  Expected: typecheck clean; vitest passes (foundations + new slice 2a totals); Playwright smoke passes.

- [ ] **Verify the prod build**

  ```bash
  pnpm build
  ```

  Expected: builds cleanly. Slice 2a uses Next 16 App Router server components and one `"use client"` component per UI file — no edge runtime tricks.

- [ ] **(Cloud-only) verify pg_cron is enabled on the prod Supabase project**

  Supabase Dashboard → Database → Extensions → `pg_cron` is enabled. The migration `20260523_001_meal_plan_cron.sql` runs `create extension if not exists` — but the dashboard toggle may also be required depending on Supabase tier.

When all three are green, slice 2a is ready to push and consider for production cutover (modulo the deferred starter-pack content workstream).
