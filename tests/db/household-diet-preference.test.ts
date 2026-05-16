import { describe, expect, it } from "vitest";
import { withTransaction } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";

describe("household_effective_diet helper", () => {
  it("returns 'non_vegetarian' when neither household nor any member has a preference", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner",
      });
      const { rows } = await c.query<{ d: string }>(
        "select public.household_effective_diet($1) as d", [h.id]);
      expect(rows[0].d).toBe("non_vegetarian");
    });
  });

  it("returns the strictest non-maid member pref when household column is null", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const fam = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner",
      });
      await insertMembership(c, {
        household_id: h.id, profile_id: fam.id, role: "family_member",
      });
      // Owner = eggitarian, family = vegetarian → strictest = vegetarian.
      await c.query(
        `update household_memberships set diet_preference='eggitarian'
          where household_id=$1 and profile_id=$2`, [h.id, owner.id]);
      await c.query(
        `update household_memberships set diet_preference='vegetarian'
          where household_id=$1 and profile_id=$2`, [h.id, fam.id]);
      const { rows } = await c.query<{ d: string }>(
        "select public.household_effective_diet($1) as d", [h.id]);
      expect(rows[0].d).toBe("vegetarian");
    });
  });

  it("ignores maid preference in the member aggregation", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const maid = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner",
      });
      await insertMembership(c, {
        household_id: h.id, profile_id: maid.id, role: "maid",
      });
      // Owner has no pref; maid = vegan. Maid is excluded → fallback default.
      await c.query(
        `update household_memberships set diet_preference='vegan'
          where household_id=$1 and profile_id=$2`, [h.id, maid.id]);
      const { rows } = await c.query<{ d: string }>(
        "select public.household_effective_diet($1) as d", [h.id]);
      expect(rows[0].d).toBe("non_vegetarian");
    });
  });

  it("household column overrides member preferences when set", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const fam = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner",
      });
      await insertMembership(c, {
        household_id: h.id, profile_id: fam.id, role: "family_member",
      });
      // Members say non_vegetarian; household column says vegetarian.
      await c.query(
        `update household_memberships set diet_preference='non_vegetarian'
          where household_id=$1`, [h.id]);
      await c.query(
        "update households set diet_preference='vegetarian' where id=$1", [h.id]);
      const { rows } = await c.query<{ d: string }>(
        "select public.household_effective_diet($1) as d", [h.id]);
      expect(rows[0].d).toBe("vegetarian");
    });
  });

  it("household column wins even when it is less strict than members", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner",
      });
      await c.query(
        `update household_memberships set diet_preference='vegan'
          where household_id=$1 and profile_id=$2`, [h.id, owner.id]);
      await c.query(
        "update households set diet_preference='non_vegetarian' where id=$1", [h.id]);
      const { rows } = await c.query<{ d: string }>(
        "select public.household_effective_diet($1) as d", [h.id]);
      expect(rows[0].d).toBe("non_vegetarian");
    });
  });
});
