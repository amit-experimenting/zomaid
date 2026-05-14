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
  // Push all meal times to 23:00 UTC so no slot is "locked" during normal test runs
  // (the lock check is now() >= meal_time - 1h). Tests that want to test the lock
  // behavior override meal_time explicitly before calling autofill.
  await c.query(
    `update household_meal_times set meal_time = '23:00'::time where household_id = $1`,
    [h.id],
  );
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
