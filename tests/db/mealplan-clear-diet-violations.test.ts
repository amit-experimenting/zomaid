import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { withTransaction } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";
import type { Client } from "pg";

type Diet = "vegan" | "vegetarian" | "eggitarian" | "non_vegetarian";

async function makeRecipe(
  c: Client,
  householdId: string,
  profileId: string,
  diet: Diet,
  slot: "breakfast" | "lunch" | "snacks" | "dinner" = "lunch",
) {
  const id = randomUUID();
  await c.query(
    `insert into recipes (id, household_id, parent_recipe_id, name, slot, diet, default_servings, created_by_profile_id)
       values ($1, $2, null, $3, $4, $5, 4, $6)`,
    [id, householdId, `R-${diet}-${slot}`, slot, diet, profileId],
  );
  return id;
}

async function planSlot(
  c: Client,
  householdId: string,
  profileId: string,
  slot: "breakfast" | "lunch" | "snacks" | "dinner",
  recipeId: string,
) {
  await c.query(
    `insert into meal_plans (household_id, plan_date, slot, recipe_id, set_by_profile_id)
       values ($1, current_date, $2, $3, $4)`,
    [householdId, slot, recipeId, profileId],
  );
}

async function bootstrap(c: Client) {
  const owner = await insertProfile(c);
  const h = await insertHousehold(c, { created_by_profile_id: owner.id });
  await insertMembership(c, {
    household_id: h.id, profile_id: owner.id, role: "owner", status: "active",
  });
  // Push every meal time far into the future so is_meal_slot_locked is false.
  await c.query(
    `update household_meal_times set meal_time = '23:00'::time where household_id = $1`,
    [h.id],
  );
  return { householdId: h.id, profileId: owner.id };
}

describe("mealplan_clear_diet_violations", () => {
  it("nulls recipe_id on rows whose recipe violates the new household diet", async () => {
    await withTransaction(async (c) => {
      const { householdId, profileId } = await bootstrap(c);
      await c.query(
        "update households set diet_preference = 'vegetarian' where id = $1",
        [householdId],
      );
      const vegRecipe = await makeRecipe(c, householdId, profileId, "vegetarian", "breakfast");
      const nonVegRecipe = await makeRecipe(c, householdId, profileId, "non_vegetarian", "dinner");
      await planSlot(c, householdId, profileId, "breakfast", vegRecipe);
      await planSlot(c, householdId, profileId, "dinner", nonVegRecipe);

      const { rows } = await c.query<{ mealplan_clear_diet_violations: number }>(
        "select public.mealplan_clear_diet_violations($1)",
        [householdId],
      );
      expect(rows[0].mealplan_clear_diet_violations).toBe(1);

      const after = await c.query(
        `select slot, recipe_id from meal_plans
           where household_id = $1 and plan_date = current_date order by slot`,
        [householdId],
      );
      const bySlot = Object.fromEntries(after.rows.map((r) => [r.slot, r.recipe_id]));
      expect(bySlot.breakfast).toBe(vegRecipe);
      expect(bySlot.dinner).toBeNull();
    });
  });

  it("leaves cooked rows alone", async () => {
    await withTransaction(async (c) => {
      const { householdId, profileId } = await bootstrap(c);
      await c.query(
        "update households set diet_preference = 'vegan' where id = $1",
        [householdId],
      );
      const nonVeg = await makeRecipe(c, householdId, profileId, "non_vegetarian", "lunch");
      await planSlot(c, householdId, profileId, "lunch", nonVeg);
      await c.query(
        `update meal_plans set cooked_at = now()
           where household_id = $1 and plan_date = current_date and slot = 'lunch'`,
        [householdId],
      );

      const { rows } = await c.query<{ mealplan_clear_diet_violations: number }>(
        "select public.mealplan_clear_diet_violations($1)",
        [householdId],
      );
      expect(rows[0].mealplan_clear_diet_violations).toBe(0);

      const after = await c.query(
        "select recipe_id from meal_plans where household_id = $1 and slot = 'lunch'",
        [householdId],
      );
      expect(after.rows[0].recipe_id).toBe(nonVeg);
    });
  });

  it("leaves locked rows alone", async () => {
    await withTransaction(async (c) => {
      const { householdId, profileId } = await bootstrap(c);
      await c.query(
        "update households set diet_preference = 'vegetarian' where id = $1",
        [householdId],
      );
      const nonVeg = await makeRecipe(c, householdId, profileId, "non_vegetarian", "lunch");
      await planSlot(c, householdId, profileId, "lunch", nonVeg);
      // Lock fires when now() >= (plan_date + meal_time) - 1h. Pick a meal_time
      // 30 minutes ago in this Postgres session so the slot is solidly locked
      // regardless of the test's connection timezone vs SGT.
      await c.query(
        `update household_meal_times
            set meal_time = (now() - interval '30 minutes')::time
          where household_id = $1 and slot = 'lunch'`,
        [householdId],
      );

      const locked = await c.query<{ is_meal_slot_locked: boolean }>(
        "select public.is_meal_slot_locked($1, current_date, 'lunch'::public.meal_slot)",
        [householdId],
      );
      expect(locked.rows[0].is_meal_slot_locked).toBe(true);

      const { rows } = await c.query<{ mealplan_clear_diet_violations: number }>(
        "select public.mealplan_clear_diet_violations($1)",
        [householdId],
      );
      expect(rows[0].mealplan_clear_diet_violations).toBe(0);

      const after = await c.query(
        "select recipe_id from meal_plans where household_id = $1 and slot = 'lunch'",
        [householdId],
      );
      expect(after.rows[0].recipe_id).toBe(nonVeg);
    });
  });

  it("does nothing when effective diet is non_vegetarian", async () => {
    await withTransaction(async (c) => {
      const { householdId, profileId } = await bootstrap(c);
      // No household pref, no member pref → defaults to non_vegetarian.
      const veg = await makeRecipe(c, householdId, profileId, "vegan", "breakfast");
      const meat = await makeRecipe(c, householdId, profileId, "non_vegetarian", "dinner");
      await planSlot(c, householdId, profileId, "breakfast", veg);
      await planSlot(c, householdId, profileId, "dinner", meat);

      const { rows } = await c.query<{ mealplan_clear_diet_violations: number }>(
        "select public.mealplan_clear_diet_violations($1)",
        [householdId],
      );
      expect(rows[0].mealplan_clear_diet_violations).toBe(0);
    });
  });

  it("eggitarian household clears non_vegetarian but keeps eggitarian", async () => {
    await withTransaction(async (c) => {
      const { householdId, profileId } = await bootstrap(c);
      await c.query(
        "update households set diet_preference = 'eggitarian' where id = $1",
        [householdId],
      );
      const egg = await makeRecipe(c, householdId, profileId, "eggitarian", "breakfast");
      const meat = await makeRecipe(c, householdId, profileId, "non_vegetarian", "dinner");
      await planSlot(c, householdId, profileId, "breakfast", egg);
      await planSlot(c, householdId, profileId, "dinner", meat);

      await c.query("select public.mealplan_clear_diet_violations($1)", [householdId]);

      const after = await c.query(
        `select slot, recipe_id from meal_plans
           where household_id = $1 and plan_date = current_date order by slot`,
        [householdId],
      );
      const bySlot = Object.fromEntries(after.rows.map((r) => [r.slot, r.recipe_id]));
      expect(bySlot.breakfast).toBe(egg);
      expect(bySlot.dinner).toBeNull();
    });
  });

  it("ignores past-dated rows", async () => {
    await withTransaction(async (c) => {
      const { householdId, profileId } = await bootstrap(c);
      await c.query(
        "update households set diet_preference = 'vegetarian' where id = $1",
        [householdId],
      );
      const meat = await makeRecipe(c, householdId, profileId, "non_vegetarian", "dinner");
      await planSlot(c, householdId, profileId, "dinner", meat);
      await c.query(
        `update meal_plans set plan_date = current_date - 1
           where household_id = $1 and slot = 'dinner'`,
        [householdId],
      );

      await c.query("select public.mealplan_clear_diet_violations($1)", [householdId]);

      const after = await c.query(
        "select recipe_id from meal_plans where household_id = $1 and slot = 'dinner'",
        [householdId],
      );
      expect(after.rows[0].recipe_id).toBe(meat);
    });
  });
});
