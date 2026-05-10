import { describe, expect, it } from "vitest";
import { setJwtClaims, withTransaction } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";

describe("household_memberships invariants & RLS", () => {
  it("rejects two active maids in one household", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const maid1 = await insertProfile(c);
      const maid2 = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, { household_id: h.id, profile_id: maid1.id, role: "maid" });
      await expect(
        insertMembership(c, { household_id: h.id, profile_id: maid2.id, role: "maid" }),
      ).rejects.toThrow();
    });
  });

  it("rejects two active owners in one household", async () => {
    await withTransaction(async (c) => {
      const o1 = await insertProfile(c);
      const o2 = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: o1.id });
      await insertMembership(c, { household_id: h.id, profile_id: o1.id, role: "owner" });
      await expect(
        insertMembership(c, { household_id: h.id, profile_id: o2.id, role: "owner" }),
      ).rejects.toThrow();
    });
  });

  it("allows multiple family members in one household", async () => {
    await withTransaction(async (c) => {
      const o = await insertProfile(c);
      const f1 = await insertProfile(c);
      const f2 = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: o.id });
      await insertMembership(c, { household_id: h.id, profile_id: o.id, role: "owner" });
      await insertMembership(c, { household_id: h.id, profile_id: f1.id, role: "family_member" });
      await insertMembership(c, { household_id: h.id, profile_id: f2.id, role: "family_member" });
    });
  });

  it("members of household see each other; non-members see nothing", async () => {
    await withTransaction(async (c) => {
      const o = await insertProfile(c);
      const m = await insertProfile(c);
      const stranger = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: o.id });
      await insertMembership(c, { household_id: h.id, profile_id: o.id, role: "owner" });
      await insertMembership(c, { household_id: h.id, profile_id: m.id, role: "maid" });

      await setJwtClaims(c, { sub: o.clerk_user_id });
      const seen = await c.query(
        "select profile_id from household_memberships where household_id = $1",
        [h.id],
      );
      expect(seen.rows.map((r) => r.profile_id).sort()).toEqual([o.id, m.id].sort());

      await setJwtClaims(c, { sub: stranger.clerk_user_id });
      const blind = await c.query(
        "select profile_id from household_memberships where household_id = $1",
        [h.id],
      );
      expect(blind.rows).toHaveLength(0);
    });
  });

  it("active owner can update any membership in their household", async () => {
    await withTransaction(async (c) => {
      const o = await insertProfile(c);
      const f = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: o.id });
      await insertMembership(c, { household_id: h.id, profile_id: o.id, role: "owner" });
      const fm = await insertMembership(c, {
        household_id: h.id,
        profile_id: f.id,
        role: "family_member",
        privilege: "view_only",
      });
      await setJwtClaims(c, { sub: o.clerk_user_id });
      await c.query(
        "update household_memberships set privilege = 'meal_modify' where id = $1",
        [fm.id],
      );
      const { rows } = await c.query(
        "select privilege from household_memberships where id = $1",
        [fm.id],
      );
      expect(rows[0].privilege).toBe("meal_modify");
    });
  });

  it("member can self-leave (status -> removed)", async () => {
    await withTransaction(async (c) => {
      const o = await insertProfile(c);
      const f = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: o.id });
      await insertMembership(c, { household_id: h.id, profile_id: o.id, role: "owner" });
      const fm = await insertMembership(c, {
        household_id: h.id,
        profile_id: f.id,
        role: "family_member",
      });
      await setJwtClaims(c, { sub: f.clerk_user_id });
      await c.query(
        "update household_memberships set status = 'removed', removed_at = now() where id = $1",
        [fm.id],
      );
      const { rows } = await c.query(
        "select status from household_memberships where id = $1",
        [fm.id],
      );
      expect(rows[0].status).toBe("removed");
    });
  });

  it("non-owner cannot remove someone else", async () => {
    await withTransaction(async (c) => {
      const o = await insertProfile(c);
      const f = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: o.id });
      await insertMembership(c, { household_id: h.id, profile_id: o.id, role: "owner" });
      const fm = await insertMembership(c, {
        household_id: h.id,
        profile_id: f.id,
        role: "family_member",
      });
      // f tries to remove the owner
      await setJwtClaims(c, { sub: f.clerk_user_id });
      await c.query(
        "update household_memberships set status = 'removed' where role = 'owner'",
      );
      const { rows } = await c.query(
        "select status from household_memberships where role = 'owner'",
      );
      expect(rows[0].status).toBe("active");
    });
  });
});
