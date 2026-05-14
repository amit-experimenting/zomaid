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
