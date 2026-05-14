import { describe, expect, it } from "vitest";
import { setJwtClaims, withTransaction } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";

describe("meal plan lock window (1h before slot start)", () => {
  it("mealplan_set_slot rejects when within 1h of slot time", async () => {
    await withTransaction(async (c) => {
      const me = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: me.id });
      await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
      await setJwtClaims(c, { sub: me.clerk_user_id });

      // Set lunch time = right now (so lock window covers now).
      // Use UTC hours to match PostgreSQL's now() which is UTC-based.
      const nowH = new Date().getUTCHours();
      const lunchHour = (nowH + 1) % 24;
      await c.query(
        `update household_meal_times set meal_time = ($1 || ':00')::time where household_id = $2 and slot = 'lunch'`,
        [String(lunchHour).padStart(2, "0"), h.id],
      );
      // Actually we want a slot whose time is in the next hour. Lunch slot = nowH+1 means
      // lock window = lunch_time - 1h = nowH, which is "now". So now() is inside the lock window.

      await expect(
        c.query(`select public.mealplan_set_slot(current_date, 'lunch'::public.meal_slot, null)`),
      ).rejects.toThrow(/locked|cannot_modify_after_lock/i);
    });
  });

  it("mealplan_set_slot accepts when more than 1h before slot time", async () => {
    await withTransaction(async (c) => {
      const me = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: me.id });
      await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
      await setJwtClaims(c, { sub: me.clerk_user_id });

      // Set lunch time = nowH+3 so lock window starts at nowH+2 — well in the future.
      // Use UTC hours to match PostgreSQL's now() which is UTC-based.
      const nowH = new Date().getUTCHours();
      const lunchHour = (nowH + 3) % 24;
      await c.query(
        `update household_meal_times set meal_time = ($1 || ':00')::time where household_id = $2 and slot = 'lunch'`,
        [String(lunchHour).padStart(2, "0"), h.id],
      );

      const { rows } = await c.query(`select public.mealplan_set_slot(current_date, 'lunch'::public.meal_slot, null)`);
      expect(rows[0]).toBeTruthy();
    });
  });

  it("mealplan_set_people_eating respects the same lock", async () => {
    await withTransaction(async (c) => {
      const me = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: me.id });
      await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
      await setJwtClaims(c, { sub: me.clerk_user_id });

      // Lock window covers now.
      // Use UTC hours to match PostgreSQL's now() which is UTC-based.
      const nowH = new Date().getUTCHours();
      const lunchHour = (nowH + 1) % 24;
      await c.query(
        `update household_meal_times set meal_time = ($1 || ':00')::time where household_id = $2 and slot = 'lunch'`,
        [String(lunchHour).padStart(2, "0"), h.id],
      );

      await expect(
        c.query(`select public.mealplan_set_people_eating(current_date, 'lunch'::public.meal_slot, 3)`),
      ).rejects.toThrow(/locked|cannot_modify_after_lock/i);
    });
  });
});
