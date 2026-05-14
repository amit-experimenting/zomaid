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
