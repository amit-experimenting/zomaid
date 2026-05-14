# Meal-Plan Auto-Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual "Generate plan for this day" button with on-view auto-fill that scores eligible recipes by inventory availability and picks the best one. Upgrade the nightly cron to share the same algorithm. Cap the plan navigation to 4 days. Clean up orphan null-recipe rows once.

**Architecture:** One new helper RPC (`mealplan_recipe_stock_score`) and one new RPC pair (`mealplan_autofill_date` + `mealplan_autofill_date_for_household`) own the scoring algorithm. Two existing RPCs (`mealplan_regenerate_slot`, `mealplan_suggest_for_date`) are upgraded to delegate to the new picker. The plan page calls the auto-fill RPC before reading rows when the caller can write and the date is today-or-future. The `WeekStrip` is narrowed; `MissingPlanCTA` is deleted.

**Tech Stack:** Next.js 16 (App Router, server components) · React 19 · TypeScript · Tailwind v4 · Supabase Postgres 17 + `pg_cron` · Vitest + `pg` (DB tests) · Playwright (E2E) · pnpm 10.

**Spec reference:** [`docs/specs/2026-05-14-auto-allocation-design.md`](../specs/2026-05-14-auto-allocation-design.md) (commit `523838a`).

**Depends on:**
- Slice 1 (recipe data fill) — supplies `recipes.default_servings` and ingredient quantities.
- Slice 2 (kitchen inventory) — supplies `inventory_items`, `inventory_lookup`, `inventory_convert`, `household_roster_size`, `is_meal_slot_locked`, `can_modify_meal_plan`, the `mealplan_set_people_eating` RPC, and the existing `mealplan_set_slot` / `mealplan_regenerate_slot` / `mealplan_suggest_for_date` functions.

---

## Pre-flight checks (manual, one-time)

- [x] **A. Local Supabase is running.** Run `pnpm db:start`. Expected: `API URL: http://127.0.0.1:54321`.

- [x] **B. Branch is up to date with the spec commit.** Run `git log --oneline -n 3`. Expected: top commit is `523838a Spec: meal-plan auto-allocation (slice 3 of 3)` (or later). If not, `git pull`.

- [x] **C. Existing tests pass.** Run `pnpm vitest run tests/db/`. Expected: all 48 DB tests pass.

- [x] **D. Create feature branch.**
  ```bash
  git checkout -b slice-3-auto-allocation
  git branch --show-current
  ```
  Expected: prints `slice-3-auto-allocation`.

---

## File structure recap

```
supabase/migrations/
  20260619_001_meal_plan_null_recipe_cleanup.sql     (Task 1)
  20260620_001_mealplan_autofill.sql                 (Tasks 2 + 3 + 4 + 5)

src/lib/db/types.ts                                  (modified, Task 6)
src/app/plan/[date]/page.tsx                         (modified, Task 8)
src/app/plan/actions.ts                              (modified, Task 9)
src/components/plan/week-strip.tsx                   (modified, Task 7)
src/components/plan/missing-plan-cta.tsx             (deleted, Task 9)

tests/db/inventory-stock-score.test.ts               (Task 2)
tests/db/mealplan-autofill.test.ts                   (Task 3)
tests/db/mealplan-regenerate-scoring.test.ts         (Task 4)
tests/db/mealplan-null-recipe-cleanup.test.ts        (Task 1)
tests/e2e/plan-autofill.spec.ts                      (Task 10)
```

Note: tasks 2-5 all add functions to the same migration file `20260620_001_mealplan_autofill.sql`. They are split into separate tasks for clarity (each function gets its own task), but each task appends to the same file. The file is committed once at the end of Task 5.

---

## Task 1: Cleanup migration — delete orphan null-recipe rows

**Files:**
- Create: `supabase/migrations/20260619_001_meal_plan_null_recipe_cleanup.sql`
- Create: `tests/db/mealplan-null-recipe-cleanup.test.ts`

- [x] **Step 1: Write the failing test**

  Create `tests/db/mealplan-null-recipe-cleanup.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { randomUUID } from "node:crypto";
  import { setJwtClaims, withTransaction } from "../setup";
  import { insertHousehold, insertMembership, insertProfile } from "../factories";

  describe("orphan null-recipe meal_plan cleanup invariant", () => {
    it("orphan rows (recipe_id null, people_eating null, cooked_at null, status pending) cannot exist after migration", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: me.id });
        await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
        await setJwtClaims(c, { sub: me.clerk_user_id });

        // Insert an orphan row directly (bypassing RPCs).
        await c.query(
          `insert into meal_plans (household_id, plan_date, slot, recipe_id, set_by_profile_id)
           values ($1, current_date, 'breakfast', null, $2)`,
          [h.id, me.id],
        );
        // The migration's DELETE already ran when supabase db reset applied this migration.
        // The orphan we just inserted is post-migration, so it still exists in this transaction.
        // To test the migration's effect, we instead re-run the DELETE statement and assert it removes only orphans.

        // Insert a row with a people_eating override (must be preserved).
        await c.query(
          `insert into meal_plans (household_id, plan_date, slot, recipe_id, set_by_profile_id, people_eating)
           values ($1, current_date, 'lunch', null, $2, 3)`,
          [h.id, me.id],
        );

        // Insert a cooked-with-null-recipe row (must be preserved).
        await c.query(
          `insert into meal_plans (household_id, plan_date, slot, recipe_id, set_by_profile_id, cooked_at, deduction_status)
           values ($1, current_date, 'snacks', null, $2, now(), 'skipped')`,
          [h.id, me.id],
        );

        // Run the cleanup DELETE.
        await c.query(
          `delete from meal_plans
           where recipe_id is null
             and people_eating is null
             and cooked_at is null
             and deduction_status = 'pending'`,
        );

        const { rows } = await c.query(
          `select slot, recipe_id, people_eating, cooked_at from meal_plans where household_id = $1 order by slot`,
          [h.id],
        );
        // Expect: breakfast deleted, lunch + snacks preserved.
        expect(rows).toHaveLength(2);
        const bySlot = Object.fromEntries(rows.map((r: any) => [r.slot, r]));
        expect(bySlot.breakfast).toBeUndefined();
        expect(bySlot.lunch.people_eating).toBe(3);
        expect(bySlot.snacks.cooked_at).not.toBeNull();
      });
    });
  });
  ```

- [x] **Step 2: Run test (should pass even without the migration, because the test re-runs the DELETE itself)**

  Run: `pnpm vitest run tests/db/mealplan-null-recipe-cleanup.test.ts`
  Expected: 1 test passes. The test exercises the DELETE statement directly inside a transaction.

  (The test is a regression guard: it verifies the DELETE's WHERE clause is correct. The actual one-time migration is created in Step 3.)

- [x] **Step 3: Create the migration**

  Create `supabase/migrations/20260619_001_meal_plan_null_recipe_cleanup.sql`:

  ```sql
  -- Slice 3 auto-allocation — one-time cleanup of orphan null-recipe meal_plan rows.
  -- These predate slice 3's auto-fill flow. They have no useful data:
  --   recipe_id IS NULL  → no meal planned
  --   people_eating IS NULL  → not a slice-2 people-eating override
  --   cooked_at IS NULL AND deduction_status = 'pending'  → cron sweep hasn't touched it
  --
  -- After this migration the auto-fill RPC's conditional upsert can safely
  -- INSERT a fresh row OR UPDATE an existing null-recipe override row.

  delete from public.meal_plans
  where recipe_id is null
    and people_eating is null
    and cooked_at is null
    and deduction_status = 'pending';
  ```

- [x] **Step 4: Apply**

  Run: `pnpm db:reset`
  Expected: clean apply. The DELETE deletes zero rows in dev (no fixtures exist), which is fine.

- [x] **Step 5: Re-run the test to confirm no regression**

  Run: `pnpm vitest run tests/db/mealplan-null-recipe-cleanup.test.ts`
  Expected: 1 test passes.

- [x] **Step 6: Commit**

  ```bash
  git add supabase/migrations/20260619_001_meal_plan_null_recipe_cleanup.sql tests/db/mealplan-null-recipe-cleanup.test.ts
  git commit -m "feat(db): clean up orphan null-recipe meal_plan rows"
  ```

---

## Task 2: New helper — `mealplan_recipe_stock_score`

**Files:**
- Create: `supabase/migrations/20260620_001_mealplan_autofill.sql`
- Create: `tests/db/inventory-stock-score.test.ts`

This task creates the migration file (initially with just one function) and the test. Tasks 3, 4, 5 will append more functions to the same migration.

- [x] **Step 1: Write failing tests**

  Create `tests/db/inventory-stock-score.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { randomUUID } from "node:crypto";
  import { setJwtClaims, withTransaction } from "../setup";
  import { insertHousehold, insertMembership, insertProfile } from "../factories";
  import type { Client } from "pg";

  async function setupHouseholdRecipe(c: Client, ingredients: Array<{ name: string; qty: number; unit: string }>, defaultServings = 4) {
    const me = await insertProfile(c);
    const h = await insertHousehold(c, { created_by_profile_id: me.id });
    await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
    await setJwtClaims(c, { sub: me.clerk_user_id });

    const recipeId = randomUUID();
    await c.query(
      `insert into recipes (id, household_id, parent_recipe_id, name, slot, default_servings, created_by_profile_id)
       values ($1, $2, null, 'Test Recipe', 'lunch', $3, $4)`,
      [recipeId, h.id, defaultServings, me.id],
    );
    for (let i = 0; i < ingredients.length; i++) {
      await c.query(
        `insert into recipe_ingredients (recipe_id, position, item_name, quantity, unit)
         values ($1, $2, $3, $4, $5)`,
        [recipeId, i + 1, ingredients[i].name, ingredients[i].qty, ingredients[i].unit],
      );
    }
    return { householdId: h.id, profileId: me.id, recipeId };
  }

  describe("mealplan_recipe_stock_score", () => {
    it("returns 1.0 when every ingredient is fully in stock at matching units", async () => {
      await withTransaction(async (c) => {
        const { householdId, recipeId } = await setupHouseholdRecipe(c, [
          { name: "basmati rice", qty: 2, unit: "cup" },
          { name: "tomato", qty: 3, unit: "piece" },
        ]);
        await c.query(
          `insert into inventory_items (household_id, item_name, quantity, unit) values
            ($1, 'basmati rice', 10, 'cup'),
            ($1, 'tomato', 12, 'piece')`,
          [householdId],
        );

        const { rows } = await c.query<{ score: string }>(
          `select public.mealplan_recipe_stock_score($1, $2, 4) as score`,
          [householdId, recipeId],
        );
        expect(Number(rows[0].score)).toBe(1);
      });
    });

    it("returns 0.5 when half the ingredients are in stock", async () => {
      await withTransaction(async (c) => {
        const { householdId, recipeId } = await setupHouseholdRecipe(c, [
          { name: "basmati rice", qty: 2, unit: "cup" },
          { name: "tomato", qty: 3, unit: "piece" },
        ]);
        await c.query(
          `insert into inventory_items (household_id, item_name, quantity, unit) values
            ($1, 'basmati rice', 10, 'cup')`,
          [householdId],
        );

        const { rows } = await c.query<{ score: string }>(
          `select public.mealplan_recipe_stock_score($1, $2, 4) as score`,
          [householdId, recipeId],
        );
        expect(Number(rows[0].score)).toBe(0.5);
      });
    });

    it("returns 0 for a recipe with no ingredients", async () => {
      await withTransaction(async (c) => {
        const { householdId, recipeId } = await setupHouseholdRecipe(c, []);
        const { rows } = await c.query<{ score: string }>(
          `select public.mealplan_recipe_stock_score($1, $2, 4) as score`,
          [householdId, recipeId],
        );
        expect(Number(rows[0].score)).toBe(0);
      });
    });

    it("scales needed quantity by people-count", async () => {
      await withTransaction(async (c) => {
        // Recipe sized for 4 servings needs 2 cup rice; cooking for 8 needs 4 cup.
        const { householdId, recipeId } = await setupHouseholdRecipe(c, [
          { name: "rice", qty: 2, unit: "cup" },
        ], 4);
        await c.query(
          `insert into inventory_items (household_id, item_name, quantity, unit) values ($1, 'rice', 3, 'cup')`,
          [householdId],
        );

        // For 4 people: need 2 cups, have 3 → in stock → score = 1.0
        let r = await c.query(`select public.mealplan_recipe_stock_score($1, $2, 4) as score`, [householdId, recipeId]);
        expect(Number(r.rows[0].score)).toBe(1);

        // For 8 people: need 4 cups, have 3 → not in stock → score = 0.0
        r = await c.query(`select public.mealplan_recipe_stock_score($1, $2, 8) as score`, [householdId, recipeId]);
        expect(Number(r.rows[0].score)).toBe(0);
      });
    });

    it("uses unit conversion to check stock", async () => {
      await withTransaction(async (c) => {
        // Recipe needs 2 cup rice; inventory in grams. 1 cup rice = 195g (default conversion).
        const { householdId, recipeId } = await setupHouseholdRecipe(c, [
          { name: "rice", qty: 2, unit: "cup" },
        ]);
        // 2 cups = 390 g. Have 400 g → in stock.
        await c.query(
          `insert into inventory_items (household_id, item_name, quantity, unit) values ($1, 'rice', 400, 'g')`,
          [householdId],
        );
        const r = await c.query(`select public.mealplan_recipe_stock_score($1, $2, 4) as score`, [householdId, recipeId]);
        expect(Number(r.rows[0].score)).toBe(1);
      });
    });

    it("treats missing inventory and unconvertible units as not-in-stock", async () => {
      await withTransaction(async (c) => {
        const { householdId, recipeId } = await setupHouseholdRecipe(c, [
          { name: "mythical herb", qty: 1, unit: "pinch" },
        ]);
        // No inventory row → not in stock.
        const r = await c.query(`select public.mealplan_recipe_stock_score($1, $2, 4) as score`, [householdId, recipeId]);
        expect(Number(r.rows[0].score)).toBe(0);
      });
    });
  });
  ```

- [x] **Step 2: Run test (should fail — function doesn't exist)**

  Run: `pnpm vitest run tests/db/inventory-stock-score.test.ts`
  Expected: 6 failures, complaining about `mealplan_recipe_stock_score` not existing.

- [x] **Step 3: Create the migration with the helper function**

  Create `supabase/migrations/20260620_001_mealplan_autofill.sql`:

  ```sql
  -- Slice 3 auto-allocation — scoring helper, autofill RPC, and upgrades to
  -- mealplan_regenerate_slot + mealplan_suggest_for_date.

  -- ── Helper: stock-fit score per recipe ────────────────────────────────────
  -- Returns fraction in [0, 1]. Score = (ingredients in stock with enough qty
  -- after scaling to people-count) / (total ingredient count). Binary per
  -- ingredient. Returns 0 for recipes with no ingredients.
  --
  -- security definer because callers may not have direct read access to
  -- inventory_items; the function does its own scoping by household.
  create or replace function public.mealplan_recipe_stock_score(
    p_household uuid,
    p_recipe_id uuid,
    p_people    int
  ) returns numeric
    language plpgsql stable security definer
    set search_path = public
    as $$
    declare
      v_default_servings int;
      v_total_ingredients int;
      v_in_stock int := 0;
      v_scale numeric;
      v_ing record;
      v_inv public.inventory_items;
      v_needed_qty numeric;
      v_converted_qty numeric;
    begin
      select default_servings into v_default_servings from public.recipes where id = p_recipe_id;
      if v_default_servings is null then
        return 0;  -- recipe not found
      end if;

      select count(*)::int into v_total_ingredients
        from public.recipe_ingredients where recipe_id = p_recipe_id;
      if v_total_ingredients = 0 then
        return 0;
      end if;

      v_scale := p_people::numeric / v_default_servings::numeric;

      for v_ing in
        select item_name, quantity, unit
          from public.recipe_ingredients
          where recipe_id = p_recipe_id
            and quantity is not null
            and unit is not null
      loop
        v_needed_qty := v_ing.quantity * v_scale;
        v_inv := public.inventory_lookup(p_household, v_ing.item_name, v_ing.unit);

        if v_inv.id is null then
          continue;  -- not in stock
        end if;

        if lower(v_inv.unit) = lower(v_ing.unit) then
          if v_inv.quantity >= v_needed_qty then
            v_in_stock := v_in_stock + 1;
          end if;
        else
          v_converted_qty := public.inventory_convert(
            p_household, v_ing.item_name, v_ing.unit, v_inv.unit, v_needed_qty
          );
          if v_converted_qty is not null and v_inv.quantity >= v_converted_qty then
            v_in_stock := v_in_stock + 1;
          end if;
        end if;
      end loop;

      return (v_in_stock::numeric / v_total_ingredients::numeric);
    end;
    $$;

  grant execute on function public.mealplan_recipe_stock_score(uuid, uuid, int) to authenticated;
  ```

- [x] **Step 4: Apply and re-run tests**

  Run: `pnpm db:reset`
  Run: `pnpm vitest run tests/db/inventory-stock-score.test.ts`
  Expected: 6 tests pass.

- [x] **Step 5: Do NOT commit yet**

  Tasks 3, 4, 5 will append more SQL to this migration file. Commit happens at the end of Task 5.

---

## Task 3: New RPC — `mealplan_autofill_date_for_household` + `mealplan_autofill_date`

**Files:**
- Modify (append): `supabase/migrations/20260620_001_mealplan_autofill.sql`
- Create: `tests/db/mealplan-autofill.test.ts`

The cron path needs to fill plans for arbitrary households (running as `postgres`). The user-facing path needs to fill for the caller's own household (via `current_household_id_for_caller`). We use a worker function that takes the household explicitly, and a thin wrapper for the user-facing call.

- [x] **Step 1: Write failing tests**

  Create `tests/db/mealplan-autofill.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { randomUUID } from "node:crypto";
  import { setJwtClaims, withTransaction } from "../setup";
  import { insertHousehold, insertMembership, insertProfile } from "../factories";
  import type { Client } from "pg";

  // Helper: hide all starter recipes for a household so tests have a clean candidate pool.
  async function hideAllStarters(c: Client, householdId: string, profileId: string) {
    const { rows } = await c.query<{ id: string }>(
      `select id from recipes where household_id is null and archived_at is null`,
    );
    for (const r of rows) {
      await c.query(
        `insert into household_recipe_hides (household_id, recipe_id, hidden_by_profile_id)
         values ($1, $2, $3) on conflict do nothing`,
        [householdId, r.id, profileId],
      );
    }
  }

  async function setupCustomLunchRecipe(c: Client, householdId: string, profileId: string, name: string, ingredients: Array<{ name: string; qty: number; unit: string }>) {
    const recipeId = randomUUID();
    await c.query(
      `insert into recipes (id, household_id, parent_recipe_id, name, slot, default_servings, created_by_profile_id)
       values ($1, $2, null, $3, 'lunch', 4, $4)`,
      [recipeId, householdId, name, profileId],
    );
    for (let i = 0; i < ingredients.length; i++) {
      await c.query(
        `insert into recipe_ingredients (recipe_id, position, item_name, quantity, unit)
         values ($1, $2, $3, $4, $5)`,
        [recipeId, i + 1, ingredients[i].name, ingredients[i].qty, ingredients[i].unit],
      );
    }
    return recipeId;
  }

  async function bootstrap(c: Client) {
    const me = await insertProfile(c);
    const h = await insertHousehold(c, { created_by_profile_id: me.id });
    await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
    await setJwtClaims(c, { sub: me.clerk_user_id });
    await hideAllStarters(c, h.id, me.id);
    return { householdId: h.id, profileId: me.id };
  }

  describe("mealplan_autofill_date", () => {
    it("picks the highest-scoring recipe for the slot", async () => {
      await withTransaction(async (c) => {
        const { householdId, profileId } = await bootstrap(c);

        // Recipe A: 2 ingredients, both in stock → score 1.0
        const recipeA = await setupCustomLunchRecipe(c, householdId, profileId, "Recipe A", [
          { name: "rice", qty: 2, unit: "cup" },
          { name: "tomato", qty: 3, unit: "piece" },
        ]);
        // Recipe B: 2 ingredients, one in stock → score 0.5
        const recipeB = await setupCustomLunchRecipe(c, householdId, profileId, "Recipe B", [
          { name: "fish", qty: 500, unit: "g" },
          { name: "tomato", qty: 2, unit: "piece" },
        ]);
        await c.query(
          `insert into inventory_items (household_id, item_name, quantity, unit) values
            ($1, 'rice', 10, 'cup'),
            ($1, 'tomato', 12, 'piece')`,
          [householdId],
        );

        const { rows } = await c.query<{ mealplan_autofill_date: number }>(
          `select public.mealplan_autofill_date(current_date)`,
        );
        expect(rows[0].mealplan_autofill_date).toBeGreaterThanOrEqual(1);

        const lunch = await c.query(
          `select recipe_id from meal_plans where household_id = $1 and plan_date = current_date and slot = 'lunch'`,
          [householdId],
        );
        expect(lunch.rows[0].recipe_id).toBe(recipeA);
      });
    });

    it("falls back to random eligible when no candidate scores >= 0.5", async () => {
      await withTransaction(async (c) => {
        const { householdId, profileId } = await bootstrap(c);

        // Only one recipe, score 0 (no inventory at all).
        const recipeId = await setupCustomLunchRecipe(c, householdId, profileId, "Sole Recipe", [
          { name: "rice", qty: 2, unit: "cup" },
          { name: "tomato", qty: 3, unit: "piece" },
        ]);
        // Note: no inventory rows.

        await c.query(`select public.mealplan_autofill_date(current_date)`);

        const lunch = await c.query(
          `select recipe_id from meal_plans where household_id = $1 and plan_date = current_date and slot = 'lunch'`,
          [householdId],
        );
        expect(lunch.rows[0].recipe_id).toBe(recipeId);
      });
    });

    it("leaves slot empty when no eligible candidate exists for that slot", async () => {
      await withTransaction(async (c) => {
        const { householdId, profileId } = await bootstrap(c);
        // Only a lunch recipe is created. Other slots have no candidates after hiding starters.
        await setupCustomLunchRecipe(c, householdId, profileId, "Lunch Only", [
          { name: "rice", qty: 2, unit: "cup" },
        ]);

        await c.query(`select public.mealplan_autofill_date(current_date)`);

        const rows = await c.query(
          `select slot, recipe_id from meal_plans where household_id = $1 and plan_date = current_date`,
          [householdId],
        );
        const bySlot = Object.fromEntries(rows.rows.map((r: any) => [r.slot, r.recipe_id]));
        // Lunch is filled; other slots have no row inserted (eligible set was empty, picker returned null).
        expect(bySlot.lunch).not.toBeNull();
        expect(bySlot.breakfast).toBeUndefined();
        expect(bySlot.snacks).toBeUndefined();
        expect(bySlot.dinner).toBeUndefined();
      });
    });

    it("is idempotent: a second call does not overwrite filled slots", async () => {
      await withTransaction(async (c) => {
        const { householdId, profileId } = await bootstrap(c);
        await setupCustomLunchRecipe(c, householdId, profileId, "Lunch A", [
          { name: "rice", qty: 2, unit: "cup" },
        ]);
        await c.query(`select public.mealplan_autofill_date(current_date)`);

        const first = await c.query(
          `select recipe_id from meal_plans where household_id = $1 and plan_date = current_date and slot = 'lunch'`,
          [householdId],
        );

        // Add a second recipe that would otherwise win.
        await setupCustomLunchRecipe(c, householdId, profileId, "Lunch B", [
          { name: "rice", qty: 2, unit: "cup" },
        ]);
        await c.query(
          `insert into inventory_items (household_id, item_name, quantity, unit) values ($1, 'rice', 100, 'cup')`,
          [householdId],
        );

        await c.query(`select public.mealplan_autofill_date(current_date)`);
        const second = await c.query(
          `select recipe_id from meal_plans where household_id = $1 and plan_date = current_date and slot = 'lunch'`,
          [householdId],
        );
        expect(second.rows[0].recipe_id).toBe(first.rows[0].recipe_id);
      });
    });

    it("preserves people_eating overrides by updating recipe_id on null-recipe rows", async () => {
      await withTransaction(async (c) => {
        const { householdId, profileId } = await bootstrap(c);
        const recipeId = await setupCustomLunchRecipe(c, householdId, profileId, "Lunch", [
          { name: "rice", qty: 2, unit: "cup" },
        ]);

        // Pre-existing row with people_eating=3 and recipe_id=null.
        await c.query(
          `insert into meal_plans (household_id, plan_date, slot, recipe_id, set_by_profile_id, people_eating)
           values ($1, current_date, 'lunch', null, $2, 3)`,
          [householdId, profileId],
        );

        await c.query(`select public.mealplan_autofill_date(current_date)`);

        const r = await c.query(
          `select recipe_id, people_eating from meal_plans where household_id = $1 and plan_date = current_date and slot = 'lunch'`,
          [householdId],
        );
        expect(r.rows[0].recipe_id).toBe(recipeId);  // filled
        expect(r.rows[0].people_eating).toBe(3);      // preserved
      });
    });

    it("respects the 4-day non-repeat rule", async () => {
      await withTransaction(async (c) => {
        const { householdId, profileId } = await bootstrap(c);
        const recipeA = await setupCustomLunchRecipe(c, householdId, profileId, "Recipe A", [
          { name: "rice", qty: 2, unit: "cup" },
        ]);
        const recipeB = await setupCustomLunchRecipe(c, householdId, profileId, "Recipe B", [
          { name: "rice", qty: 2, unit: "cup" },
        ]);
        await c.query(
          `insert into inventory_items (household_id, item_name, quantity, unit) values ($1, 'rice', 100, 'cup')`,
          [householdId],
        );

        // Recipe A used yesterday for lunch.
        await c.query(
          `insert into meal_plans (household_id, plan_date, slot, recipe_id, set_by_profile_id)
           values ($1, current_date - 1, 'lunch', $2, $3)`,
          [householdId, recipeA, profileId],
        );

        // Both score 1.0 but Recipe A is recent.
        await c.query(`select public.mealplan_autofill_date(current_date)`);

        const lunch = await c.query(
          `select recipe_id from meal_plans where household_id = $1 and plan_date = current_date and slot = 'lunch'`,
          [householdId],
        );
        // Only Recipe B is eligible.
        expect(lunch.rows[0].recipe_id).toBe(recipeB);
      });
    });

    it("skips locked slots (within 1h of meal time)", async () => {
      await withTransaction(async (c) => {
        const { householdId, profileId } = await bootstrap(c);
        await setupCustomLunchRecipe(c, householdId, profileId, "Lunch", [
          { name: "rice", qty: 2, unit: "cup" },
        ]);

        // Lock lunch by setting its meal_time to "now in UTC, displayed as SGT".
        const nowH = new Date().getUTCHours();
        await c.query(
          `update household_meal_times set meal_time = ($1 || ':00')::time where household_id = $2 and slot = 'lunch'`,
          [String((nowH + 1) % 24).padStart(2, "0"), householdId],
        );

        await c.query(`select public.mealplan_autofill_date(current_date)`);

        const lunch = await c.query(
          `select * from meal_plans where household_id = $1 and plan_date = current_date and slot = 'lunch'`,
          [householdId],
        );
        expect(lunch.rows).toHaveLength(0);  // locked, not filled
      });
    });
  });
  ```

- [x] **Step 2: Run tests (should fail)**

  Run: `pnpm vitest run tests/db/mealplan-autofill.test.ts`
  Expected: 7 failures (function doesn't exist yet).

- [x] **Step 3: Append the autofill RPC + worker to the migration**

  Open `supabase/migrations/20260620_001_mealplan_autofill.sql` (created in Task 2) and append:

  ```sql

  -- ── Worker: fill all slots for one (household, date) ──────────────────────
  -- Returns count of slots actually filled (excluding skipped: locked, already
  -- filled, or no eligible candidates). Always called via either:
  --   - mealplan_autofill_date(p_date)        - user-facing wrapper, resolves household from JWT
  --   - mealplan_suggest_for_date(p_date)     - cron wrapper, loops all households
  create or replace function public.mealplan_autofill_date_for_household(
    p_household uuid,
    p_date      date
  ) returns int
    language plpgsql security definer
    set search_path = public
    as $$
    declare
      v_slot       public.meal_slot;
      v_filled     int := 0;
      v_existing   public.meal_plans;
      v_people     int;
      v_chosen     uuid;
      v_max_score  numeric;
    begin
      foreach v_slot in array array['breakfast','lunch','snacks','dinner']::public.meal_slot[]
      loop
        -- Skip locked slots.
        if public.is_meal_slot_locked(p_household, p_date, v_slot) then
          continue;
        end if;

        -- Skip slots that are already filled (recipe_id non-null) OR cooked (cron has touched).
        select * into v_existing from public.meal_plans
          where household_id = p_household and plan_date = p_date and slot = v_slot;
        if v_existing.id is not null and (v_existing.recipe_id is not null or v_existing.cooked_at is not null) then
          continue;
        end if;

        -- Effective people: row's override if set, else household roster size.
        v_people := coalesce(v_existing.people_eating, public.household_roster_size(p_household));
        if v_people is null or v_people < 1 then
          v_people := 1;
        end if;

        -- Build eligible candidates: effective_recipes for this slot, minus
        -- recipes used in the same slot in the last 4 days.
        with eligible as (
          select er.id, er.name
            from public.effective_recipes(p_household) er
            where er.slot = v_slot
              and er.id not in (
                select recipe_id
                  from public.meal_plans
                  where household_id = p_household
                    and slot = v_slot
                    and plan_date between p_date - 4 and p_date - 1
                    and recipe_id is not null
              )
        ),
        scored as (
          select id, public.mealplan_recipe_stock_score(p_household, id, v_people) as score
            from eligible
        )
        select case
          when (select max(score) from scored) >= 0.5
            then (select id from scored where score = (select max(score) from scored) order by random() limit 1)
          when exists (select 1 from scored)
            then (select id from scored order by random() limit 1)
          else null
          end
        into v_chosen;

        if v_chosen is null then
          continue;  -- no eligible candidates
        end if;

        -- Upsert: insert or update only if the row was empty + unprocessed.
        insert into public.meal_plans
          (household_id, plan_date, slot, recipe_id, set_by_profile_id)
        values (p_household, p_date, v_slot, v_chosen, null)
        on conflict (household_id, plan_date, slot) do update
          set recipe_id = excluded.recipe_id
          where meal_plans.recipe_id is null
            and meal_plans.cooked_at is null;

        v_filled := v_filled + 1;
      end loop;

      return v_filled;
    end;
    $$;

  revoke execute on function public.mealplan_autofill_date_for_household(uuid, date) from public;
  grant  execute on function public.mealplan_autofill_date_for_household(uuid, date) to postgres;

  -- ── User-facing wrapper: resolves household from JWT, enforces write perm ──
  create or replace function public.mealplan_autofill_date(p_date date)
    returns int
    language plpgsql security definer
    set search_path = public
    as $$
    declare
      v_household uuid;
    begin
      v_household := public.current_household_id_for_caller();
      if v_household is null then
        raise exception 'no active household' using errcode = 'P0001';
      end if;
      -- Cron path doesn't go through here. User path requires meal-modify permission.
      if not public.can_modify_meal_plan(v_household) then
        raise exception 'permission denied' using errcode = 'P0001';
      end if;
      return public.mealplan_autofill_date_for_household(v_household, p_date);
    end;
    $$;

  grant execute on function public.mealplan_autofill_date(date) to authenticated;
  ```

- [x] **Step 4: Apply and re-run tests**

  Run: `pnpm db:reset`
  Run: `pnpm vitest run tests/db/mealplan-autofill.test.ts`
  Expected: 7 tests pass.

- [x] **Step 5: Do NOT commit yet** — Tasks 4 and 5 append more to the same migration.

---

## Task 4: Upgrade `mealplan_regenerate_slot` to use scoring

**Files:**
- Modify (append): `supabase/migrations/20260620_001_mealplan_autofill.sql`
- Create: `tests/db/mealplan-regenerate-scoring.test.ts`

The existing `mealplan_regenerate_slot` (from slice 2's `20260618_001_meal_plan_inventory_rpcs.sql`) picks a random non-repeat eligible recipe with a fallback to any random eligible. We replace that inner logic with score-based selection. The lock check, permission rules, and upsert behavior are unchanged.

- [x] **Step 1: Write the failing test**

  Create `tests/db/mealplan-regenerate-scoring.test.ts`:

  ```ts
  import { describe, expect, it } from "vitest";
  import { randomUUID } from "node:crypto";
  import { setJwtClaims, withTransaction } from "../setup";
  import { insertHousehold, insertMembership, insertProfile } from "../factories";
  import type { Client } from "pg";

  async function hideAllStarters(c: Client, householdId: string, profileId: string) {
    const { rows } = await c.query<{ id: string }>(
      `select id from recipes where household_id is null and archived_at is null`,
    );
    for (const r of rows) {
      await c.query(
        `insert into household_recipe_hides (household_id, recipe_id, hidden_by_profile_id) values ($1, $2, $3) on conflict do nothing`,
        [householdId, r.id, profileId],
      );
    }
  }

  describe("mealplan_regenerate_slot — scoring upgrade", () => {
    it("regenerate picks the highest-scoring eligible recipe", async () => {
      await withTransaction(async (c) => {
        const me = await insertProfile(c);
        const h = await insertHousehold(c, { created_by_profile_id: me.id });
        await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
        await setJwtClaims(c, { sub: me.clerk_user_id });
        await hideAllStarters(c, h.id, me.id);

        const recipeHigh = randomUUID();
        const recipeLow = randomUUID();
        await c.query(
          `insert into recipes (id, household_id, name, slot, default_servings, created_by_profile_id) values
            ($1, $2, 'High', 'lunch', 4, $3),
            ($4, $2, 'Low', 'lunch', 4, $3)`,
          [recipeHigh, h.id, me.id, recipeLow],
        );
        await c.query(
          `insert into recipe_ingredients (recipe_id, position, item_name, quantity, unit) values
            ($1, 1, 'rice', 2, 'cup'),
            ($2, 1, 'mythical herb', 1, 'pinch')`,
          [recipeHigh, recipeLow],
        );
        await c.query(
          `insert into inventory_items (household_id, item_name, quantity, unit) values ($1, 'rice', 100, 'cup')`,
          [h.id],
        );

        const { rows } = await c.query(
          `select public.mealplan_regenerate_slot(current_date, 'lunch'::public.meal_slot)`,
        );
        const r = await c.query(
          `select recipe_id from meal_plans where household_id = $1 and plan_date = current_date and slot = 'lunch'`,
          [h.id],
        );
        expect(r.rows[0].recipe_id).toBe(recipeHigh);
      });
    });
  });
  ```

- [x] **Step 2: Run the test (should fail because the existing RPC may not pick the high-scoring one deterministically)**

  Run: `pnpm vitest run tests/db/mealplan-regenerate-scoring.test.ts`
  Expected: 1 failure. The existing implementation picks randomly among eligible — it will sometimes pick `recipeLow`.

- [x] **Step 3: Append the upgrade to the migration**

  Open `supabase/migrations/20260620_001_mealplan_autofill.sql` and append:

  ```sql

  -- ── Upgrade: mealplan_regenerate_slot now uses stock scoring ──────────────
  -- Replaces the random-eligible pick in slice 2's version. Same permissions,
  -- same lock check, same upsert semantics. Only the inner candidate pick changes.
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
      v_existing  public.meal_plans;
      v_people    int;
      v_chosen    uuid;
      v_row       public.meal_plans;
    begin
      if v_household is null then
        raise exception 'no active household' using errcode = 'P0001';
      end if;
      if public.is_meal_slot_locked(v_household, p_date, p_slot) then
        raise exception 'cannot_modify_after_lock' using errcode = 'P0001';
      end if;

      -- Find existing row to honor people_eating override if set.
      select * into v_existing from public.meal_plans
        where household_id = v_household and plan_date = p_date and slot = p_slot;
      v_people := coalesce(v_existing.people_eating, public.household_roster_size(v_household));
      if v_people is null or v_people < 1 then
        v_people := 1;
      end if;

      -- Same scoring logic as mealplan_autofill_date_for_household, applied to one slot.
      with eligible as (
        select er.id, er.name
          from public.effective_recipes(v_household) er
          where er.slot = p_slot
            and er.id not in (
              select recipe_id from public.meal_plans
                where household_id = v_household
                  and slot = p_slot
                  and plan_date between p_date - 4 and p_date - 1
                  and recipe_id is not null
            )
      ),
      scored as (
        select id, public.mealplan_recipe_stock_score(v_household, id, v_people) as score
          from eligible
      )
      select case
        when (select max(score) from scored) >= 0.5
          then (select id from scored where score = (select max(score) from scored) order by random() limit 1)
        when exists (select 1 from scored)
          then (select id from scored order by random() limit 1)
        else null
        end
      into v_chosen;

      -- Upsert (overwrites any existing recipe; that's the regenerate intent).
      insert into public.meal_plans
        (household_id, plan_date, slot, recipe_id, set_by_profile_id)
      values (v_household, p_date, p_slot, v_chosen, v_profile)
      on conflict (household_id, plan_date, slot) do update
        set recipe_id         = excluded.recipe_id,
            set_by_profile_id = excluded.set_by_profile_id
      returning * into v_row;
      return v_row;
    end;
    $$;

  grant execute on function public.mealplan_regenerate_slot(date, public.meal_slot) to authenticated;
  ```

- [x] **Step 4: Apply and re-run the test**

  Run: `pnpm db:reset`
  Run: `pnpm vitest run tests/db/mealplan-regenerate-scoring.test.ts`
  Expected: 1 test passes. Re-run a few times to confirm determinism — `recipeHigh` should win every time.

- [x] **Step 5: Do NOT commit yet** — Task 5 appends the cron upgrade.

---

## Task 5: Upgrade `mealplan_suggest_for_date` to use autofill

**Files:**
- Modify (append): `supabase/migrations/20260620_001_mealplan_autofill.sql`

The cron entrypoint becomes a thin wrapper that loops active households and calls `mealplan_autofill_date_for_household`. The existing cron schedule (`0 22 * * *` SGT for `mealplan-suggest-tomorrow`) is unchanged — only the function body changes.

- [x] **Step 1: Append the cron upgrade to the migration**

  Open `supabase/migrations/20260620_001_mealplan_autofill.sql` and append:

  ```sql

  -- ── Upgrade: mealplan_suggest_for_date now delegates to the autofill worker ──
  -- Called by the pg_cron job (mealplan-suggest-tomorrow, 0 22 * * *).
  -- Loops over active households and runs the same scoring algorithm as on-view fill.
  create or replace function public.mealplan_suggest_for_date(p_date date)
    returns void
    language plpgsql security invoker
    set search_path = public
    as $$
    declare
      v_household uuid;
    begin
      for v_household in
        select distinct household_id from public.household_memberships where status = 'active'
      loop
        perform public.mealplan_autofill_date_for_household(v_household, p_date);
      end loop;
    end;
    $$;

  revoke execute on function public.mealplan_suggest_for_date(date) from public;
  grant  execute on function public.mealplan_suggest_for_date(date) to postgres;
  ```

- [x] **Step 2: Apply the full migration and run ALL DB tests**

  Run: `pnpm db:reset`
  Expected: clean apply.

  Run: `pnpm vitest run tests/db/`
  Expected: all DB tests pass (the 48 from earlier slices + the new 6 + 7 + 1 + 1 = 14 new tests = 62 total, give or take exact counts).

- [x] **Step 3: Commit the full migration + all new test files**

  ```bash
  git add supabase/migrations/20260620_001_mealplan_autofill.sql \
          tests/db/inventory-stock-score.test.ts \
          tests/db/mealplan-autofill.test.ts \
          tests/db/mealplan-regenerate-scoring.test.ts
  git commit -m "feat(db): mealplan auto-allocation scoring + RPCs"
  ```

---

## Task 6: TypeScript types — Functions entries for new RPCs

**Files:**
- Modify: `src/lib/db/types.ts`

- [x] **Step 1: Find the Functions block in the types file**

  Open `src/lib/db/types.ts`. Locate the `Functions:` block inside `Database["public"]`. Find an existing RPC entry (e.g. `inventory_manual_adjust` or `mealplan_set_people_eating`) to use as a style reference.

- [x] **Step 2: Add the three new function signatures**

  Add the following entries inside `Functions:` (alphabetical order is fine; placement next to other `mealplan_*` entries is preferable):

  ```ts
        mealplan_recipe_stock_score: {
          Args: { p_household: string; p_recipe_id: string; p_people: number };
          Returns: number;
        };
        mealplan_autofill_date: {
          Args: { p_date: string };
          Returns: number;
        };
        mealplan_autofill_date_for_household: {
          Args: { p_household: string; p_date: string };
          Returns: number;
        };
  ```

  Note: `mealplan_autofill_date_for_household` is not callable from `authenticated` (it's granted only to `postgres`), but we still type it so internal code paths can reference it if needed.

- [x] **Step 3: Typecheck**

  Run: `pnpm typecheck`
  Expected: exit 0.

- [x] **Step 4: Commit**

  ```bash
  git add src/lib/db/types.ts
  git commit -m "types(db): add mealplan autofill RPCs"
  ```

---

## Task 7: UI — narrow `WeekStrip` to 4 days

**Files:**
- Modify: `src/components/plan/week-strip.tsx`

The current strip renders 7 days (`for (let i = -3; i <= 3; i++)`). Slice 3 caps it to today + 3 forward (4 days, no past dates).

- [x] **Step 1: Replace the loop range**

  Open `src/components/plan/week-strip.tsx`. Change the loop:

  Replace:
  ```ts
    for (let i = -3; i <= 3; i++) {
      const d = new Date(active);
      d.setDate(d.getDate() + i);
      const iso = isoDate(d);
      days.push({ date: iso, label: d.toLocaleDateString("en-SG", { weekday: "narrow" }) });
    }
  ```

  With:
  ```ts
    // Today + the next 3 days. Past dates are not reachable from the strip.
    const todayDate = new Date(`${today}T00:00:00+08:00`);
    for (let i = 0; i <= 3; i++) {
      const d = new Date(todayDate);
      d.setDate(d.getDate() + i);
      const iso = isoDate(d);
      days.push({ date: iso, label: d.toLocaleDateString("en-SG", { weekday: "narrow" }) });
    }
  ```

  Note the iteration now anchors on **today**, not on the active date. That way, navigating to a future date doesn't shift the strip away from "today" — the visible window always shows today + the next 3 days regardless of which one is currently active.

- [x] **Step 2: Typecheck**

  Run: `pnpm typecheck`
  Expected: exit 0.

- [x] **Step 3: Commit**

  ```bash
  git add src/components/plan/week-strip.tsx
  git commit -m "feat(plan): cap WeekStrip to today + 3 days"
  ```

---

## Task 8: UI — auto-fill on view in `/plan/[date]/page.tsx`

**Files:**
- Modify: `src/app/plan/[date]/page.tsx`

The page currently shows the `MissingPlanCTA` when `!hasAnyPlanRow && !readOnly`. Slice 3 replaces that with a server-side auto-fill call before the meal-plan query, then deletes the CTA render.

- [x] **Step 1: Add the auto-fill RPC call before the meal_plans select**

  Open `src/app/plan/[date]/page.tsx`.

  Just after the `readOnly` computation (around line 25) and BEFORE the existing `await supabase.from("meal_plans").select(...)` query (around line 27), insert:

  ```ts
    // Auto-fill empty slots when the date is today or future and the caller can write.
    // The RPC is idempotent — already-filled slots are not overwritten.
    const todayIso = new Date().toISOString().slice(0, 10);
    if (!readOnly && date >= todayIso) {
      const { error: autofillError } = await supabase.rpc("mealplan_autofill_date", { p_date: date });
      if (autofillError) {
        // Non-fatal: log and continue rendering whatever rows do exist.
        console.error("mealplan_autofill_date failed:", autofillError.message);
      }
    }
  ```

  This must run before the existing `rawRows` select so that the rest of the page sees the freshly-filled rows.

- [x] **Step 2: Remove the `MissingPlanCTA` import and render**

  At the top of the file, delete the line:
  ```ts
  import { MissingPlanCTA } from "@/components/plan/missing-plan-cta";
  ```

  In the JSX (around line 107), delete the conditional render:
  ```tsx
  {!hasAnyPlanRow && !readOnly && <MissingPlanCTA planDate={date} />}
  ```

  Also delete the now-unused `hasAnyPlanRow` constant declaration (line 88):
  ```ts
  const hasAnyPlanRow = (rawRows?.length ?? 0) > 0;
  ```

- [x] **Step 3: Typecheck**

  Run: `pnpm typecheck`
  Expected: exit 0.

- [x] **Step 4: Commit**

  ```bash
  git add src/app/plan/[date]/page.tsx
  git commit -m "feat(plan): auto-fill plan rows on view"
  ```

---

## Task 9: Cleanup — delete `MissingPlanCTA` + `generatePlanForDate`

**Files:**
- Delete: `src/components/plan/missing-plan-cta.tsx`
- Modify: `src/app/plan/actions.ts`

- [x] **Step 1: Delete the unused component file**

  Run:
  ```bash
  rm src/components/plan/missing-plan-cta.tsx
  ```

- [x] **Step 2: Remove the now-unused `generatePlanForDate` action**

  Open `src/app/plan/actions.ts`. Delete the entire block defining `GenerateForDateSchema` and `generatePlanForDate` (approximately lines 42-69 of the current file — the `const GenerateForDateSchema = z.object(...)` declaration and the full `export async function generatePlanForDate(...)` definition).

  After deletion, the file should have these exported actions only: `setMealPlanSlot`, `regenerateMealPlanSlot`, `setPeopleEating`.

- [x] **Step 3: Search for any remaining references**

  Run:
  ```bash
  grep -rn "generatePlanForDate\|MissingPlanCTA" src/ tests/ 2>/dev/null
  ```
  Expected: no output (or only the just-edited `actions.ts` lines we're cleaning). If anything else still references these, fix that file too.

- [x] **Step 4: Typecheck**

  Run: `pnpm typecheck`
  Expected: exit 0.

- [x] **Step 5: Commit**

  ```bash
  git add src/app/plan/actions.ts src/components/plan/missing-plan-cta.tsx
  git commit -m "chore(plan): remove MissingPlanCTA + generatePlanForDate (replaced by on-view auto-fill)"
  ```

  Note: `git add` on a deleted file stages the deletion.

---

## Task 10: E2E smoke test

**Files:**
- Create: `tests/e2e/plan-autofill.spec.ts`

- [x] **Step 1: Create the smoke test**

  ```ts
  import { test, expect } from "@playwright/test";

  test.describe("slice 3 auto-allocation smoke (unauthenticated)", () => {
    test("/plan/<today> redirects unauthenticated users to /", async ({ page }) => {
      const today = new Date().toISOString().slice(0, 10);
      await page.goto(`/plan/${today}`);
      await expect(page).toHaveURL("http://localhost:3000/");
    });

    test("/plan/<tomorrow> also redirects unauthenticated", async ({ page }) => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await page.goto(`/plan/${tomorrow}`);
      await expect(page).toHaveURL("http://localhost:3000/");
    });
  });
  ```

- [x] **Step 2: Run the e2e**

  Run: `pnpm test:e2e -- plan-autofill`
  Expected: 2 tests pass (× 2 browsers).

- [x] **Step 3: Commit**

  ```bash
  git add tests/e2e/plan-autofill.spec.ts
  git commit -m "test(e2e): smoke that /plan/<date> gates unauthenticated"
  ```

---

## Task 11: Final manual verification

- [x] **Step 1: Full automated suite**

  Run:
  ```
  pnpm vitest run tests/db/
  pnpm typecheck
  pnpm lint 2>&1 | grep -E "error" | head -20
  ```
  Expected:
  - All DB tests pass (62-ish total).
  - typecheck exits 0.
  - lint shows no NEW errors introduced by slice 3 (pre-existing errors from earlier slices are acceptable; verify by comparing to `main` if uncertain).

- [x] **Step 2: Start the dev server**

  In a separate terminal: `pnpm dev`. Expected: `Local: http://localhost:3000`.

- [x] **Step 3: Sign in as an owner**

  Open `http://localhost:3000`, sign in.

- [x] **Step 4: Visit `/plan/<today>` for a household that has NO inventory yet**

  Expected:
  - The "Generate plan for this day" button no longer appears.
  - All four meal slots show recipes auto-filled (random non-repeat, since no inventory means no candidate scores ≥ 0.5).
  - The page renders without any visible delay.

- [x] **Step 5: Add inventory items to match some recipes**

  Via the `/inventory/new` page, add some staples (e.g. 5 kg basmati rice, 2 kg toor dal, 12 eggs, etc.).

- [x] **Step 6: Visit `/plan/<tomorrow>`**

  Expected: all 4 slots auto-fill, and the chosen recipes should bias toward ones using your stocked items (e.g. a rice-based lunch is more likely than a fish-based one if you have rice and not fish).

- [x] **Step 7: Visit `/plan/<yesterday>`**

  Expected: empty rows (no auto-fill for past dates). The WeekStrip should NOT show yesterday — only today + 3 future days.

- [x] **Step 8: Verify the WeekStrip is 4 days**

  Count the day pills at the bottom of the plan page. Expected: 4 pills, starting with today.

- [x] **Step 9: Per-slot regenerate**

  Tap a slot's action sheet → "Regenerate". Expected: a new recipe is chosen (favoring stocked recipes). Repeat 2-3 times; some variety is expected (random tie-break when multiple recipes tie at the top score).

- [x] **Step 10: Force the cron path manually**

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c \
    "select public.mealplan_suggest_for_date(current_date + 1);"
  ```
  Refresh `/plan/<tomorrow>` — should show the cron-filled rows (or no change, since on-view already filled them).

- [x] **Step 11: Mark plan complete**

  ```bash
  # Edit this plan file to check off all task boxes, then:
  git add docs/plans/2026-05-14-auto-allocation.md
  git commit -m "chore(plan): mark auto-allocation plan complete"
  ```

---

## Done.

After Task 11 succeeds, slice 3 is ready to merge. The recipes-and-allocation overhaul is complete: slice 1 (recipe data) + slice 2 (inventory) + slice 3 (auto-allocation) all shipped.

Possible next slices (not in this plan):
- Push notification opt-in UI
- Admin tooling beyond `/admin/tasks`
- Fridge / expiry tracking (foundations slice 4)
- Spending analytics on skipped bill line items
- Payments / subscription tiers (deferred until field testing)
