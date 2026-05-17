import { describe, it, expect } from "vitest";
import { setJwtClaims, withTransaction } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";

async function newHousehold(c: import("pg").Client) {
  const owner = await insertProfile(c);
  const h = await insertHousehold(c, { created_by_profile_id: owner.id });
  await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
  return { owner, householdId: h.id };
}

async function newMember(c: import("pg").Client, householdId: string, role: "owner" | "family_member" | "maid") {
  const p = await insertProfile(c);
  await insertMembership(c, { household_id: householdId, profile_id: p.id, role });
  return p;
}

const INSERT_PROFILE_SQL = `insert into public.household_profiles
  (household_id, age_groups, pets, work_hours, school_children,
   has_indoor_plants, has_balcony, has_ac, has_polishables)
 values ($1, $2::text[], $3, $4, $5, $6, $7, $8, $9)`;

describe("household_profiles RLS", () => {
  it("active owner can insert", async () => {
    await withTransaction(async (c) => {
      const { owner, householdId } = await newHousehold(c);
      await setJwtClaims(c, { sub: owner.clerk_user_id });
      const r = await c.query(INSERT_PROFILE_SQL, [
        householdId, ["adults"], "none", "mixed", "none_school_age",
        false, false, false, false,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("active maid can insert", async () => {
    await withTransaction(async (c) => {
      const { householdId } = await newHousehold(c);
      const maid = await newMember(c, householdId, "maid");
      await setJwtClaims(c, { sub: maid.clerk_user_id });
      const r = await c.query(INSERT_PROFILE_SQL, [
        householdId, ["adults"], "dog", "wfh", "none_school_age",
        true, false, true, false,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("family_member cannot write (RLS blocks)", async () => {
    await withTransaction(async (c) => {
      const { householdId } = await newHousehold(c);
      const fam = await newMember(c, householdId, "family_member");
      await setJwtClaims(c, { sub: fam.clerk_user_id });
      await expect(
        c.query(INSERT_PROFILE_SQL, [
          householdId, ["adults"], "none", "mixed", "none_school_age",
          false, false, false, false,
        ]),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("non-member cannot write", async () => {
    await withTransaction(async (c) => {
      const { householdId } = await newHousehold(c);
      const stranger = await insertProfile(c);  // no membership
      await setJwtClaims(c, { sub: stranger.clerk_user_id });
      await expect(
        c.query(INSERT_PROFILE_SQL, [
          householdId, ["adults"], "none", "mixed", "none_school_age",
          false, false, false, false,
        ]),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("rejects empty age_groups (check constraint)", async () => {
    await withTransaction(async (c) => {
      const { owner, householdId } = await newHousehold(c);
      await setJwtClaims(c, { sub: owner.clerk_user_id });
      await expect(
        c.query(INSERT_PROFILE_SQL, [
          householdId, [], "none", "mixed", "none_school_age",
          false, false, false, false,
        ]),
      ).rejects.toThrow(/check constraint|household_profiles_age_groups_check/);
    });
  });

  it("rejects invalid pets value", async () => {
    await withTransaction(async (c) => {
      const { owner, householdId } = await newHousehold(c);
      await setJwtClaims(c, { sub: owner.clerk_user_id });
      await expect(
        c.query(INSERT_PROFILE_SQL, [
          householdId, ["adults"], "unicorn", "mixed", "none_school_age",
          false, false, false, false,
        ]),
      ).rejects.toThrow(/check constraint|household_profiles_pets_check/);
    });
  });
});
