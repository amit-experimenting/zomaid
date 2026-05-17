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
      // Push meal times far into the future so the lock check doesn't reject regenerate.
      await c.query(`update household_meal_times set meal_time = '23:00'::time where household_id = $1`, [h.id]);
      // Regenerate now refuses to run when the household has no diet preference
      // (gate added 20260712_002). Set the most permissive value.
      await c.query(`update households set diet_preference = 'non_vegetarian' where id = $1`, [h.id]);
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

      await c.query(
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
