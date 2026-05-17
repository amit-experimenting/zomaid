import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { setJwtClaims, withTransaction } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";
import type { Client } from "pg";

async function hideAllStarters(c: Client, householdId: string, profileId: string) {
  const { rows } = await c.query<{ id: string }>(
    "select id from recipes where household_id is null and archived_at is null",
  );
  for (const r of rows) {
    await c.query(
      `insert into household_recipe_hides (household_id, recipe_id, hidden_by_profile_id)
         values ($1, $2, $3) on conflict do nothing`,
      [householdId, r.id, profileId],
    );
  }
}

async function makeBasicLunchRecipe(c: Client, householdId: string, profileId: string) {
  const id = randomUUID();
  await c.query(
    `insert into recipes (id, household_id, name, slot, diet, default_servings, created_by_profile_id)
       values ($1, $2, 'Vegan Bowl', 'lunch', 'vegan', 4, $3)`,
    [id, householdId, profileId],
  );
  await c.query(
    `insert into recipe_ingredients (recipe_id, position, item_name, quantity, unit)
       values ($1, 1, 'rice', 2, 'cup')`,
    [id],
  );
  await c.query(
    `insert into inventory_items (household_id, item_name, quantity, unit)
       values ($1, 'rice', 100, 'cup')`,
    [householdId],
  );
  return id;
}

describe("household_has_diet_preference", () => {
  it("returns false when neither household nor any non-maid member has a preference", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner", status: "active",
      });
      const { rows } = await c.query<{ has: boolean }>(
        "select public.household_has_diet_preference($1) as has",
        [h.id],
      );
      expect(rows[0].has).toBe(false);
    });
  });

  it("returns true when the household column is set", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner", status: "active",
      });
      await c.query(
        "update households set diet_preference = 'vegan' where id = $1",
        [h.id],
      );
      const { rows } = await c.query<{ has: boolean }>(
        "select public.household_has_diet_preference($1) as has",
        [h.id],
      );
      expect(rows[0].has).toBe(true);
    });
  });

  it("returns true when a non-maid active member has a preference", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      const m = await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner", status: "active",
      });
      await c.query(
        "update household_memberships set diet_preference = 'vegetarian' where id = $1",
        [m.id],
      );
      const { rows } = await c.query<{ has: boolean }>(
        "select public.household_has_diet_preference($1) as has",
        [h.id],
      );
      expect(rows[0].has).toBe(true);
    });
  });

  it("ignores maid-only preferences", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const maid = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner", status: "active",
      });
      const maidMem = await insertMembership(c, {
        household_id: h.id, profile_id: maid.id, role: "maid", status: "active",
      });
      await c.query(
        "update household_memberships set diet_preference = 'vegan' where id = $1",
        [maidMem.id],
      );
      const { rows } = await c.query<{ has: boolean }>(
        "select public.household_has_diet_preference($1) as has",
        [h.id],
      );
      expect(rows[0].has).toBe(false);
    });
  });
});

describe("mealplan gate: no diet preference → no plan", () => {
  it("autofill returns 0 and writes no rows when no preference is set", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner", status: "active",
      });
      await c.query(
        "update household_meal_times set meal_time = '23:00'::time where household_id = $1",
        [h.id],
      );
      await setJwtClaims(c, { sub: owner.clerk_user_id });
      await hideAllStarters(c, h.id, owner.id);
      await makeBasicLunchRecipe(c, h.id, owner.id);

      const { rows } = await c.query<{ mealplan_autofill_date_for_household: number }>(
        "select public.mealplan_autofill_date_for_household($1, current_date)",
        [h.id],
      );
      expect(rows[0].mealplan_autofill_date_for_household).toBe(0);

      const after = await c.query(
        "select count(*)::int as n from meal_plans where household_id = $1 and recipe_id is not null",
        [h.id],
      );
      expect(after.rows[0].n).toBe(0);
    });
  });

  it("autofill fills slots once a household-level preference is set", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner", status: "active",
      });
      await c.query(
        "update household_meal_times set meal_time = '23:00'::time where household_id = $1",
        [h.id],
      );
      await c.query(
        "update households set diet_preference = 'vegan' where id = $1",
        [h.id],
      );
      await setJwtClaims(c, { sub: owner.clerk_user_id });
      await hideAllStarters(c, h.id, owner.id);
      await makeBasicLunchRecipe(c, h.id, owner.id);

      const { rows } = await c.query<{ mealplan_autofill_date_for_household: number }>(
        "select public.mealplan_autofill_date_for_household($1, current_date)",
        [h.id],
      );
      expect(rows[0].mealplan_autofill_date_for_household).toBeGreaterThanOrEqual(1);
    });
  });

  it("regenerate raises diet_preference_required when no preference is set", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner", status: "active",
      });
      await c.query(
        "update household_meal_times set meal_time = '23:00'::time where household_id = $1",
        [h.id],
      );
      await setJwtClaims(c, { sub: owner.clerk_user_id });

      await expect(
        c.query("select public.mealplan_regenerate_slot(current_date, 'lunch'::public.meal_slot)"),
      ).rejects.toThrow(/diet_preference_required/);
    });
  });
});
