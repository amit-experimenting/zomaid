import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { withTransaction, setJwtClaims } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";

describe("inventory_sweep_due_meals", () => {
  it("deducts a meal whose next-slot lock window has passed", async () => {
    await withTransaction(async (c) => {
      const me = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: me.id });
      await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
      await setJwtClaims(c, { sub: me.clerk_user_id });

      // A recipe whose ingredient has a matching inventory item (so deduction succeeds cleanly).
      const recipeId = randomUUID();
      await c.query(
        `insert into recipes (id, household_id, parent_recipe_id, name, slot, default_servings, created_by_profile_id)
         values ($1, $2, null, 'Test', 'breakfast', 4, $3)`,
        [recipeId, h.id, me.id],
      );
      await c.query(
        `insert into recipe_ingredients (recipe_id, position, item_name, quantity, unit)
         values ($1, 1, 'rice', 1, 'cup')`,
        [recipeId],
      );
      await c.query(
        `insert into inventory_items (household_id, item_name, quantity, unit)
         values ($1, 'rice', 1000, 'g')`,
        [h.id],
      );

      // Set meal_plan for today's breakfast.
      const mpId = randomUUID();
      await c.query(
        `insert into meal_plans (id, household_id, plan_date, slot, recipe_id, set_by_profile_id)
         values ($1, $2, current_date, 'breakfast', $3, $4)`,
        [mpId, h.id, recipeId, me.id],
      );

      // Force breakfast time to "well in the past" so lock window has passed.
      await c.query(
        `update household_meal_times set meal_time = '00:01' where household_id = $1 and slot = 'breakfast'`,
        [h.id],
      );
      // Force lunch time (the next slot) to "right now" so the 1h-before window includes now().
      await c.query(
        `update household_meal_times set meal_time = ((extract(hour from now()))::int || ':00')::time where household_id = $1 and slot = 'lunch'`,
        [h.id],
      );

      const { rows } = await c.query<{ inventory_sweep_due_meals: number }>(
        `select public.inventory_sweep_due_meals()`,
      );
      expect(rows[0].inventory_sweep_due_meals).toBeGreaterThanOrEqual(1);

      const r = await c.query(`select deduction_status from meal_plans where id = $1`, [mpId]);
      expect(["deducted", "partial"]).toContain(r.rows[0].deduction_status);
    });
  });

  it("does nothing when lock window has not passed yet", async () => {
    await withTransaction(async (c) => {
      const me = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: me.id });
      await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
      await setJwtClaims(c, { sub: me.clerk_user_id });

      // Meal time set 6 hours in the future — window is not open yet.
      const future_hour = ((new Date().getHours() + 6) % 24);
      await c.query(
        `update household_meal_times set meal_time = ($1 || ':00')::time where household_id = $2 and slot = 'lunch'`,
        [String(future_hour).padStart(2, "0"), h.id],
      );

      const mpId = randomUUID();
      await c.query(
        `insert into meal_plans (household_id, plan_date, slot, recipe_id, set_by_profile_id)
         values ($1, current_date, 'breakfast', null, $2)
         returning id`,
        [h.id, me.id],
      );

      const r = await c.query(`select deduction_status from meal_plans where household_id = $1 and slot = 'breakfast'`, [h.id]);
      expect(r.rows[0].deduction_status).toBe("pending");
    });
  });
});
