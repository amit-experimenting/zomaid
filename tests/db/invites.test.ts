import { describe, expect, it } from "vitest";
import { setJwtClaims, withTransaction } from "../setup";
import {
  insertHousehold, insertInvite, insertMembership, insertProfile,
} from "../factories";

describe("invites + redeem_invite RPC", () => {
  it("redeem creates an active membership and consumes the invite", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const family = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
      const inv = await insertInvite(c, {
        household_id: h.id,
        invited_by_profile_id: owner.id,
        intended_role: "family_member",
        intended_privilege: "meal_modify",
      });

      await setJwtClaims(c, { sub: family.clerk_user_id });
      const { rows } = await c.query("select * from redeem_invite($1)", [inv.token]);
      expect(rows).toHaveLength(1);
      expect(rows[0].profile_id).toBe(family.id);
      expect(rows[0].role).toBe("family_member");
      expect(rows[0].privilege).toBe("meal_modify");
      expect(rows[0].status).toBe("active");

      const after = await c.query("select consumed_at from invites where id = $1", [inv.id]);
      expect(after.rows[0].consumed_at).not.toBeNull();
    });
  });

  it("redeeming the same token twice fails on the second call", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const family = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
      const inv = await insertInvite(c, {
        household_id: h.id,
        invited_by_profile_id: owner.id,
        intended_role: "family_member",
        intended_privilege: "meal_modify",
      });
      await setJwtClaims(c, { sub: family.clerk_user_id });
      await c.query("select * from redeem_invite($1)", [inv.token]);

      await expect(
        c.query("select * from redeem_invite($1)", [inv.token]),
      ).rejects.toThrow(/already consumed/);
    });
  });

  it("expired invite cannot be redeemed", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const family = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
      const inv = await insertInvite(c, {
        household_id: h.id,
        invited_by_profile_id: owner.id,
        intended_role: "family_member",
        expires_at: "now() - interval '1 minute'",
      });
      await setJwtClaims(c, { sub: family.clerk_user_id });
      await expect(
        c.query("select * from redeem_invite($1)", [inv.token]),
      ).rejects.toThrow(/expired/);
    });
  });

  it("redeeming a maid invite when an active maid already exists fails", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const maid1 = await insertProfile(c);
      const maid2 = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
      await insertMembership(c, { household_id: h.id, profile_id: maid1.id, role: "maid" });
      const inv = await insertInvite(c, {
        household_id: h.id,
        invited_by_profile_id: owner.id,
        intended_role: "maid",
      });
      await setJwtClaims(c, { sub: maid2.clerk_user_id });
      await expect(
        c.query("select * from redeem_invite($1)", [inv.token]),
      ).rejects.toThrow(/already has an active maid/);
    });
  });

  it("invites are visible to active owner of the household", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const stranger = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
      await insertInvite(c, {
        household_id: h.id,
        invited_by_profile_id: owner.id,
        intended_role: "family_member",
      });

      await setJwtClaims(c, { sub: owner.clerk_user_id });
      const visible = await c.query("select id from invites");
      expect(visible.rows).toHaveLength(1);

      await setJwtClaims(c, { sub: stranger.clerk_user_id });
      const blind = await c.query("select id from invites");
      expect(blind.rows).toHaveLength(0);
    });
  });
});
