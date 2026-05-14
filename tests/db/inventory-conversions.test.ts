import { describe, expect, it } from "vitest";
import { setJwtClaims, withTransaction } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";

describe("unit conversion lookup priority", () => {
  it("returns multiplier for global+generic conversion", async () => {
    await withTransaction(async (c) => {
      const me = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: me.id });
      await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
      await setJwtClaims(c, { sub: me.clerk_user_id });

      const { rows } = await c.query<{ inventory_convert: string | null }>(
        `select public.inventory_convert($1, null, 'cup', 'ml', 2)`,
        [h.id],
      );
      expect(rows[0].inventory_convert).not.toBeNull();
      // 2 cups * 240 ml/cup = 480 ml
      expect(Number(rows[0].inventory_convert)).toBe(480);
    });
  });

  it("item-specific override beats generic", async () => {
    await withTransaction(async (c) => {
      const me = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: me.id });
      await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
      await setJwtClaims(c, { sub: me.clerk_user_id });

      // basmati rice global default = 195 g/cup
      // 1 cup -> 195 g (not 240 ml which would be water-density)
      const { rows } = await c.query<{ inventory_convert: string | null }>(
        `select public.inventory_convert($1, 'basmati rice', 'cup', 'g', 1)`,
        [h.id],
      );
      expect(Number(rows[0].inventory_convert)).toBe(195);
    });
  });

  it("household-specific override beats global", async () => {
    await withTransaction(async (c) => {
      const me = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: me.id });
      await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
      await setJwtClaims(c, { sub: me.clerk_user_id });

      // Override basmati rice for this household: 1 cup = 250 g (instead of 195)
      await c.query(
        `insert into unit_conversions (household_id, item_name, from_unit, to_unit, multiplier)
         values ($1, 'basmati rice', 'cup', 'g', 250)`,
        [h.id],
      );

      const { rows } = await c.query<{ inventory_convert: string | null }>(
        `select public.inventory_convert($1, 'basmati rice', 'cup', 'g', 1)`,
        [h.id],
      );
      expect(Number(rows[0].inventory_convert)).toBe(250);
    });
  });

  it("returns null when no conversion exists", async () => {
    await withTransaction(async (c) => {
      const me = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: me.id });
      await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
      await setJwtClaims(c, { sub: me.clerk_user_id });

      const { rows } = await c.query<{ inventory_convert: string | null }>(
        `select public.inventory_convert($1, 'unobtanium', 'lump', 'kg', 1)`,
        [h.id],
      );
      expect(rows[0].inventory_convert).toBeNull();
    });
  });
});
