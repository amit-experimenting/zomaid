import { describe, expect, it } from "vitest";
import { withTransaction } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";

describe("onboarding action invariants (DB-level)", () => {
  it("rejects creating a second active membership for the same profile in the same household", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });

      await expect(
        insertMembership(c, {
          household_id: h.id,
          profile_id: owner.id,
          role: "family_member",
        }),
      ).rejects.toThrow();
    });
  });

  it("maid invariant blocks two active maids in same household", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const m1 = await insertProfile(c);
      const m2 = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, { household_id: h.id, profile_id: m1.id, role: "maid" });
      await expect(
        insertMembership(c, { household_id: h.id, profile_id: m2.id, role: "maid" }),
      ).rejects.toThrow();
    });
  });
});
