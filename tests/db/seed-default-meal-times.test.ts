import { describe, expect, it } from "vitest";
import { withTransaction } from "../setup";
import { insertHousehold, insertProfile } from "../factories";

// Covers seed_default_meal_times() + the households_seed_meal_times
// AFTER INSERT trigger defined in 20260609_001_household_meal_times.sql.
//
// Silent-failure surface: the trigger is the only thing that populates
// household_meal_times on creation. If it fails to fire (or seeds the wrong
// values), the household ends up with no meal times — meal planning and
// task scheduling silently misbehave for that household. These tests pin
// the contract end-to-end.
//
// Migration excerpt (the seed values are load-bearing — assert exactly):
//   insert into public.household_meal_times (household_id, slot, meal_time) values
//     (new.id, 'breakfast', '08:00'),
//     (new.id, 'lunch',     '13:00'),
//     (new.id, 'snacks',    '17:00'),
//     (new.id, 'dinner',    '20:00')
//   on conflict (household_id, slot) do nothing;
//
// Wiring: `after insert on public.households for each row` — so the trigger
// fires only on INSERT (not UPDATE, not DELETE).

describe("seed_default_meal_times trigger", () => {
  it("seeds 4 rows (one per meal slot) on household INSERT", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });

      const { rows } = await c.query<{ slot: string; meal_time: string }>(
        "select slot, meal_time from household_meal_times where household_id = $1 order by slot",
        [h.id],
      );
      expect(rows).toHaveLength(4);
      expect(rows.map((r) => r.slot).sort()).toEqual(
        ["breakfast", "dinner", "lunch", "snacks"],
      );
    });
  });

  it("seeds the exact default times from the migration (breakfast 08:00, lunch 13:00, snacks 17:00, dinner 20:00)", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });

      const { rows } = await c.query<{ slot: string; meal_time: string }>(
        "select slot, meal_time::text as meal_time from household_meal_times where household_id = $1",
        [h.id],
      );
      const byslot = new Map(rows.map((r) => [r.slot, r.meal_time]));
      // Postgres `time` is rendered as HH:MM:SS by node-pg.
      expect(byslot.get("breakfast")).toBe("08:00:00");
      expect(byslot.get("lunch")).toBe("13:00:00");
      expect(byslot.get("snacks")).toBe("17:00:00");
      expect(byslot.get("dinner")).toBe("20:00:00");
    });
  });

  it("does NOT re-seed on household UPDATE (trigger is AFTER INSERT only)", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });

      // Mutate one slot to a non-default value, then UPDATE the household.
      // If the trigger fires on UPDATE, the ON CONFLICT DO NOTHING would
      // preserve our value — but a more sensitive probe is to delete a row
      // and verify UPDATE does not re-seed it (see the dedicated test below).
      // Here we count rows before/after UPDATE to assert no extra inserts.
      const before = await c.query<{ count: string }>(
        "select count(*)::text from household_meal_times where household_id = $1",
        [h.id],
      );
      expect(before.rows[0].count).toBe("4");

      await c.query("update households set name = 'Renamed' where id = $1", [h.id]);

      const after = await c.query<{ count: string }>(
        "select count(*)::text from household_meal_times where household_id = $1",
        [h.id],
      );
      expect(after.rows[0].count).toBe("4");
    });
  });

  it("does NOT re-seed a slot the user has manually deleted (only INSERT triggers)", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });

      // Delete the breakfast slot; nothing should put it back.
      await c.query(
        "delete from household_meal_times where household_id = $1 and slot = 'breakfast'",
        [h.id],
      );

      // UPDATE the household to be sure no incidental trigger refills it.
      await c.query("update households set name = 'Renamed' where id = $1", [h.id]);

      const { rows } = await c.query<{ slot: string }>(
        "select slot from household_meal_times where household_id = $1 order by slot",
        [h.id],
      );
      expect(rows.map((r) => r.slot).sort()).toEqual(["dinner", "lunch", "snacks"]);
    });
  });

  it("trigger is not invoked on household DELETE — cascade removes meal times directly", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });

      // Pre-condition: 4 seeded rows.
      const before = await c.query<{ count: string }>(
        "select count(*)::text from household_meal_times where household_id = $1",
        [h.id],
      );
      expect(before.rows[0].count).toBe("4");

      await c.query("delete from households where id = $1", [h.id]);

      // ON DELETE CASCADE removes the meal_times rows; the seed trigger is
      // AFTER INSERT only so DELETE doesn't re-seed anything either.
      const after = await c.query<{ count: string }>(
        "select count(*)::text from household_meal_times where household_id = $1",
        [h.id],
      );
      expect(after.rows[0].count).toBe("0");
    });
  });

  it("primary key (household_id, slot) prevents duplicate slot rows", async () => {
    // Pin the invariant the trigger relies on: if the trigger were ever to
    // fire twice for the same household, the ON CONFLICT DO NOTHING (and
    // the PK itself) would still keep the table to one row per slot.
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });

      // Attempt a manual duplicate insert — must violate the PK. Wrap in a
      // savepoint so the violation doesn't poison the outer transaction.
      await c.query("savepoint dup_attempt");
      await expect(
        c.query(
          "insert into household_meal_times (household_id, slot, meal_time) values ($1, 'breakfast', '09:00')",
          [h.id],
        ),
      ).rejects.toThrow(/duplicate key|household_meal_times_pkey/);
      await c.query("rollback to savepoint dup_attempt");

      // And the original seeded row is unchanged.
      const { rows } = await c.query<{ meal_time: string }>(
        "select meal_time::text as meal_time from household_meal_times where household_id = $1 and slot = 'breakfast'",
        [h.id],
      );
      expect(rows[0].meal_time).toBe("08:00:00");

      // The PK is also visible in pg_constraint — assert it's a primary
      // key over (household_id, slot) so the invariant is documented.
      const { rows: pk } = await c.query<{ conname: string; def: string }>(
        `select c.conname, pg_get_constraintdef(c.oid) as def
           from pg_constraint c
          where c.conrelid = 'public.household_meal_times'::regclass
            and c.contype = 'p'`,
      );
      expect(pk).toHaveLength(1);
      expect(pk[0].def).toMatch(/PRIMARY KEY \(household_id, slot\)/);
    });
  });

  it("two households are seeded independently (each gets its own 4 rows)", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h1 = await insertHousehold(c, { created_by_profile_id: owner.id });
      const h2 = await insertHousehold(c, { created_by_profile_id: owner.id });

      const counts = await c.query<{ household_id: string; n: string }>(
        `select household_id, count(*)::text as n
           from household_meal_times
          where household_id = any($1)
          group by household_id`,
        [[h1.id, h2.id]],
      );
      const byHousehold = new Map(counts.rows.map((r) => [r.household_id, r.n]));
      expect(byHousehold.get(h1.id)).toBe("4");
      expect(byHousehold.get(h2.id)).toBe("4");
    });
  });
});
