import { describe, expect, it } from "vitest";
import { withTransaction } from "../setup";
import {
  insertHousehold, insertInvite, insertMembership, insertProfile,
} from "../factories";

describe("redeem_invite end-to-end behavior", () => {
  it("creates a family_member membership with the privilege from the invite", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const fam = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
      const inv = await insertInvite(c, {
        household_id: h.id,
        invited_by_profile_id: owner.id,
        intended_role: "family_member",
        intended_privilege: "view_only",
      });
      await c.query(
        `select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)`,
        [JSON.stringify({ sub: fam.clerk_user_id })],
      );
      const { rows } = await c.query("select * from redeem_invite($1)", [inv.token]);
      expect(rows[0].role).toBe("family_member");
      expect(rows[0].privilege).toBe("view_only");
    });
  });
});
