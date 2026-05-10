import { describe, expect, it } from "vitest";
import { setJwtClaims, withTransaction } from "../setup";
import {
  insertHousehold, insertMembership, insertProfile,
} from "../factories";

describe("membership management invariants", () => {
  it("self-leave sets status=removed", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const fam = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
      const fm = await insertMembership(c, {
        household_id: h.id, profile_id: fam.id, role: "family_member",
      });
      await setJwtClaims(c, { sub: fam.clerk_user_id });
      await c.query(
        `update household_memberships
            set status = 'removed', removed_at = now()
          where id = $1`,
        [fm.id],
      );
      const { rows } = await c.query(
        "select status from household_memberships where id = $1", [fm.id]);
      expect(rows[0].status).toBe("removed");
    });
  });

  it("after removal, a maid can be re-invited and join", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const m1 = await insertProfile(c);
      const m2 = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
      const m1m = await insertMembership(c, {
        household_id: h.id, profile_id: m1.id, role: "maid",
      });
      // owner removes m1
      await setJwtClaims(c, { sub: owner.clerk_user_id });
      await c.query(
        "update household_memberships set status = 'removed', removed_at = now() where id = $1",
        [m1m.id],
      );
      // bypass RLS to insert m2 as new maid (simulating redeem_invite SECURITY DEFINER)
      await c.query(
        `select set_config('request.jwt.claims', '', true), set_config('role', 'postgres', true)`,
      );
      await insertMembership(c, { household_id: h.id, profile_id: m2.id, role: "maid" });
    });
  });
});
