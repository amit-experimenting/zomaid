import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { setJwtClaims, withTransaction } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";
import type { Client } from "pg";

async function setupInventoryAndRecipe(c: Client) {
  const me = await insertProfile(c);
  const h = await insertHousehold(c, { created_by_profile_id: me.id });
  await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
  await setJwtClaims(c, { sub: me.clerk_user_id });

  // Custom recipe with one ingredient (avoid global starter contention).
  const recipeId = randomUUID();
  await c.query(
    `insert into recipes (id, household_id, parent_recipe_id, name, slot, default_servings, created_by_profile_id)
     values ($1, $2, null, 'Test Curry', 'lunch', 4, $3)`,
    [recipeId, h.id, me.id],
  );
  await c.query(
    `insert into recipe_ingredients (recipe_id, position, item_name, quantity, unit)
     values ($1, 1, 'basmati rice', 2, 'cup')`,
    [recipeId],
  );

  // Inventory has 5 kg basmati rice (will require cup→g conversion: 195g/cup → 390g needed).
  const invId = randomUUID();
  await c.query(
    `insert into inventory_items (id, household_id, item_name, quantity, unit)
     values ($1, $2, 'basmati rice', 5000, 'g')`,
    [invId, h.id],
  );

  // Meal plan row for today's lunch using the recipe.
  const mpId = randomUUID();
  await c.query(
    `insert into meal_plans (id, household_id, plan_date, slot, recipe_id, set_by_profile_id)
     values ($1, $2, current_date, 'lunch', $3, $4)`,
    [mpId, h.id, recipeId, me.id],
  );

  return { householdId: h.id, profileId: me.id, recipeId, invId, mealPlanId: mpId };
}

describe("inventory_cook_deduct", () => {
  it("deducts scaled by default_servings; status='deducted'", async () => {
    await withTransaction(async (c) => {
      const { invId, mealPlanId } = await setupInventoryAndRecipe(c);
      // Roster size = 1 (just me). Default servings = 4. Scale = 1/4. Need 2 cup * 1/4 = 0.5 cup = 97.5g.
      const { rows } = await c.query<{ inventory_cook_deduct: unknown }>(
        `select public.inventory_cook_deduct($1)`,
        [mealPlanId],
      );
      expect(rows[0].inventory_cook_deduct).toMatchObject({ status: "deducted" });

      const r = await c.query(`select quantity from inventory_items where id = $1`, [invId]);
      expect(Number(r.rows[0].quantity)).toBeCloseTo(5000 - 97.5, 1);

      const status = await c.query(`select deduction_status, cooked_at from meal_plans where id = $1`, [mealPlanId]);
      expect(status.rows[0].deduction_status).toBe("deducted");
      expect(status.rows[0].cooked_at).not.toBeNull();
    });
  });

  it("clamps to zero and reports 'partial' when out of stock", async () => {
    await withTransaction(async (c) => {
      const { invId, mealPlanId } = await setupInventoryAndRecipe(c);
      // Drain to 50g so 97.5g needed is short.
      await c.query(`update inventory_items set quantity = 50 where id = $1`, [invId]);

      const { rows } = await c.query<{ inventory_cook_deduct: any }>(
        `select public.inventory_cook_deduct($1)`,
        [mealPlanId],
      );
      expect(rows[0].inventory_cook_deduct.status).toBe("partial");
      expect(rows[0].inventory_cook_deduct.warnings).toHaveLength(1);
      expect(rows[0].inventory_cook_deduct.warnings[0].reason).toBe("short");

      const r = await c.query(`select quantity from inventory_items where id = $1`, [invId]);
      expect(Number(r.rows[0].quantity)).toBe(0);
    });
  });

  it("is idempotent on re-run", async () => {
    await withTransaction(async (c) => {
      const { invId, mealPlanId } = await setupInventoryAndRecipe(c);
      await c.query(`select public.inventory_cook_deduct($1)`, [mealPlanId]);
      const r1 = await c.query(`select quantity from inventory_items where id = $1`, [invId]);
      // Re-run: should return early, no further deduction.
      await c.query(`select public.inventory_cook_deduct($1)`, [mealPlanId]);
      const r2 = await c.query(`select quantity from inventory_items where id = $1`, [invId]);
      expect(Number(r2.rows[0].quantity)).toBe(Number(r1.rows[0].quantity));
    });
  });

  it("marks as 'skipped' when meal_plan has no recipe", async () => {
    await withTransaction(async (c) => {
      const { householdId, profileId } = await setupInventoryAndRecipe(c);
      const mpId = randomUUID();
      await c.query(
        `insert into meal_plans (id, household_id, plan_date, slot, recipe_id, set_by_profile_id)
         values ($1, $2, current_date, 'breakfast', null, $3)`,
        [mpId, householdId, profileId],
      );
      const { rows } = await c.query<{ inventory_cook_deduct: any }>(
        `select public.inventory_cook_deduct($1)`,
        [mpId],
      );
      expect(rows[0].inventory_cook_deduct.status).toBe("skipped");
    });
  });

  it("warns when ingredient is not in stock (reason='not_in_stock')", async () => {
    await withTransaction(async (c) => {
      const { householdId, profileId } = await setupInventoryAndRecipe(c);
      const recipeId = randomUUID();
      await c.query(
        `insert into recipes (id, household_id, parent_recipe_id, name, slot, default_servings, created_by_profile_id)
         values ($1, $2, null, 'Unstocked Dish', 'dinner', 4, $3)`,
        [recipeId, householdId, profileId],
      );
      await c.query(
        `insert into recipe_ingredients (recipe_id, position, item_name, quantity, unit)
         values ($1, 1, 'mythical herb', 1, 'pinch')`,
        [recipeId],
      );
      const mpId = randomUUID();
      await c.query(
        `insert into meal_plans (id, household_id, plan_date, slot, recipe_id, set_by_profile_id)
         values ($1, $2, current_date, 'dinner', $3, $4)`,
        [mpId, householdId, recipeId, profileId],
      );

      const { rows } = await c.query<{ inventory_cook_deduct: any }>(
        `select public.inventory_cook_deduct($1)`,
        [mpId],
      );
      expect(rows[0].inventory_cook_deduct.status).toBe("partial");
      expect(rows[0].inventory_cook_deduct.warnings[0].reason).toBe("not_in_stock");
    });
  });
});
