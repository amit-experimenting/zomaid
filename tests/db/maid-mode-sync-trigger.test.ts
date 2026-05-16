import { describe, expect, it } from "vitest";
import { withTransaction } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";

// Covers households_sync_maid_mode_on_join() + the
// household_memberships_sync_maid_mode AFTER INSERT/UPDATE trigger defined in
// 20260705_001_household_setup_gates.sql.
//
// Semantics (read from the migration; tightened in
// 20260708_001_tighten_maid_mode_guard.sql):
//   if new.role = 'maid' and new.status = 'active' then
//     update households set maid_mode = 'invited'
//       where id = new.household_id and maid_mode = 'unset';
//   end if;
//
// So the trigger fires on INSERT or UPDATE of any membership row, but only
// performs a write when the row resolves to (role='maid', status='active'),
// and only when the household's current maid_mode is still 'unset' (the
// initial post-creation state). 'family_run' is preserved — an owner who
// explicitly opted out of maid tracking is not silently overridden by a late
// maid INSERT.

describe("households_sync_maid_mode_on_join trigger", () => {
  it("flips maid_mode 'unset' -> 'invited' when an active maid membership is inserted", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const maid = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });

      // Sanity: default is 'unset'.
      const before = await c.query<{ maid_mode: string }>(
        "select maid_mode from households where id = $1",
        [h.id],
      );
      expect(before.rows[0].maid_mode).toBe("unset");

      await insertMembership(c, {
        household_id: h.id,
        profile_id: maid.id,
        role: "maid", // status defaults to 'active' in the factory
      });

      const after = await c.query<{ maid_mode: string }>(
        "select maid_mode from households where id = $1",
        [h.id],
      );
      expect(after.rows[0].maid_mode).toBe("invited");
    });
  });

  it("does NOT flip maid_mode when an owner membership is inserted", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });

      await insertMembership(c, {
        household_id: h.id,
        profile_id: owner.id,
        role: "owner",
      });

      const { rows } = await c.query<{ maid_mode: string }>(
        "select maid_mode from households where id = $1",
        [h.id],
      );
      expect(rows[0].maid_mode).toBe("unset");
    });
  });

  it("does NOT flip maid_mode when a family_member membership is inserted", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const fam = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id,
        profile_id: owner.id,
        role: "owner",
      });

      await insertMembership(c, {
        household_id: h.id,
        profile_id: fam.id,
        role: "family_member",
      });

      const { rows } = await c.query<{ maid_mode: string }>(
        "select maid_mode from households where id = $1",
        [h.id],
      );
      expect(rows[0].maid_mode).toBe("unset");
    });
  });

  it("does NOT flip maid_mode when a non-active (pending) maid membership is inserted", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const maid = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });

      await insertMembership(c, {
        household_id: h.id,
        profile_id: maid.id,
        role: "maid",
        status: "pending",
      });

      const { rows } = await c.query<{ maid_mode: string }>(
        "select maid_mode from households where id = $1",
        [h.id],
      );
      expect(rows[0].maid_mode).toBe("unset");
    });
  });

  it("flips maid_mode when a pending maid membership is updated to active (reactivation)", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const maid = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });

      const mem = await insertMembership(c, {
        household_id: h.id,
        profile_id: maid.id,
        role: "maid",
        status: "pending",
      });

      // Pre-condition: still 'unset' since the pending insert was a no-op.
      const before = await c.query<{ maid_mode: string }>(
        "select maid_mode from households where id = $1",
        [h.id],
      );
      expect(before.rows[0].maid_mode).toBe("unset");

      // Promote the membership to active — the AFTER UPDATE trigger should fire.
      await c.query(
        "update household_memberships set status = 'active' where id = $1",
        [mem.id],
      );

      const after = await c.query<{ maid_mode: string }>(
        "select maid_mode from households where id = $1",
        [h.id],
      );
      expect(after.rows[0].maid_mode).toBe("invited");
    });
  });

  it("is idempotent: re-firing the trigger on an already-'invited' household leaves state alone", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const maid = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });

      const mem = await insertMembership(c, {
        household_id: h.id,
        profile_id: maid.id,
        role: "maid",
      });
      expect(
        (
          await c.query<{ maid_mode: string }>(
            "select maid_mode from households where id = $1",
            [h.id],
          )
        ).rows[0].maid_mode,
      ).toBe("invited");

      // Touch the membership row (any column) to re-fire the AFTER UPDATE
      // trigger. The function's `where maid_mode = 'unset'` guard means the
      // UPDATE statement matches zero rows (maid_mode is already 'invited') —
      // the household row is left untouched (in particular, no side effects
      // from re-running it).
      await c.query(
        "update household_memberships set privilege = 'meal_modify' where id = $1",
        [mem.id],
      );

      const { rows } = await c.query<{ maid_mode: string }>(
        "select maid_mode from households where id = $1",
        [h.id],
      );
      expect(rows[0].maid_mode).toBe("invited");
    });
  });

  it("DELETE of the maid membership does NOT revert maid_mode (trigger only fires on INSERT/UPDATE)", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const maid = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });

      const mem = await insertMembership(c, {
        household_id: h.id,
        profile_id: maid.id,
        role: "maid",
      });
      // Pre-condition.
      expect(
        (
          await c.query<{ maid_mode: string }>(
            "select maid_mode from households where id = $1",
            [h.id],
          )
        ).rows[0].maid_mode,
      ).toBe("invited");

      await c.query("delete from household_memberships where id = $1", [mem.id]);

      const { rows } = await c.query<{ maid_mode: string }>(
        "select maid_mode from households where id = $1",
        [h.id],
      );
      // Trigger is AFTER INSERT OR UPDATE only — DELETE is intentionally a no-op.
      expect(rows[0].maid_mode).toBe("invited");
    });
  });

  it("preserves 'family_run' when an active maid joins later (does NOT override owner choice)", async () => {
    // The trigger guards on `maid_mode = 'unset'` — so 'family_run' is
    // preserved when an active maid appears. The owner's explicit opt-out of
    // maid tracking is not silently overridden by a late maid INSERT
    // (e.g. delayed invite redemption). The owner must explicitly switch off
    // 'family_run' before re-adding a maid.
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const maid = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });

      await c.query(
        "update households set maid_mode = 'family_run' where id = $1",
        [h.id],
      );

      await insertMembership(c, {
        household_id: h.id,
        profile_id: maid.id,
        role: "maid",
      });

      const { rows } = await c.query<{ maid_mode: string }>(
        "select maid_mode from households where id = $1",
        [h.id],
      );
      expect(rows[0].maid_mode).toBe("family_run");
    });
  });
});
