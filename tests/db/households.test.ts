import { describe, expect, it } from "vitest";
import { setJwtClaims, withTransaction } from "../setup";
import { insertHousehold, insertProfile } from "../factories";

describe("households RLS (INSERT-only stage; SELECT/UPDATE policies arrive in Task 7)", () => {
  it("non-member cannot read a household — RLS denies all reads at this stage", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const stranger = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });

      await setJwtClaims(c, { sub: stranger.clerk_user_id });
      const { rows } = await c.query("select id from households where id = $1", [h.id]);
      expect(rows).toHaveLength(0);
    });
  });

  it("creator without a membership row also cannot read household — no SELECT policy yet", async () => {
    await withTransaction(async (c) => {
      const me = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: me.id });
      await setJwtClaims(c, { sub: me.clerk_user_id });
      const { rows } = await c.query("select id from households where id = $1", [h.id]);
      expect(rows).toHaveLength(0);
    });
  });
});
