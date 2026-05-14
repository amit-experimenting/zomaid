import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asAnon, setJwtClaims, withTransaction } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";

describe("inventory_items RLS + manual adjust", () => {
  it("active owner can read and write", async () => {
    await withTransaction(async (c) => {
      const me = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: me.id });
      await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
      await setJwtClaims(c, { sub: me.clerk_user_id });

      const id = randomUUID();
      await c.query(
        `insert into inventory_items (id, household_id, item_name, quantity, unit) values ($1,$2,'sugar',1,'kg')`,
        [id, h.id],
      );
      const r = await c.query(`select item_name from inventory_items where id = $1`, [id]);
      expect(r.rows[0].item_name).toBe("sugar");
    });
  });

  it("non-member cannot read", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const stranger = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner", status: "active" });
      await setJwtClaims(c, { sub: owner.clerk_user_id });
      await c.query(
        `insert into inventory_items (household_id, item_name, quantity, unit) values ($1,'salt',1,'kg')`,
        [h.id],
      );
      await setJwtClaims(c, { sub: stranger.clerk_user_id });
      const r = await c.query(`select * from inventory_items where household_id = $1`, [h.id]);
      expect(r.rows).toHaveLength(0);
    });
  });

  it("manual_adjust adds and writes a ledger row", async () => {
    await withTransaction(async (c) => {
      const me = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: me.id });
      await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
      await setJwtClaims(c, { sub: me.clerk_user_id });

      const id = randomUUID();
      await c.query(
        `insert into inventory_items (id, household_id, item_name, quantity, unit) values ($1,$2,'oil',1,'l')`,
        [id, h.id],
      );

      await c.query(`select public.inventory_manual_adjust($1, 0.5, 'topped up')`, [id]);
      const r = await c.query(`select quantity from inventory_items where id = $1`, [id]);
      expect(Number(r.rows[0].quantity)).toBe(1.5);

      const ledger = await c.query(
        `select delta, reason from inventory_transactions where inventory_item_id = $1 order by created_at asc`,
        [id],
      );
      expect(ledger.rows).toHaveLength(1);
      expect(Number(ledger.rows[0].delta)).toBe(0.5);
      expect(ledger.rows[0].reason).toBe("manual_adjust");
    });
  });

  it("manual_adjust clamps to zero", async () => {
    await withTransaction(async (c) => {
      const me = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: me.id });
      await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
      await setJwtClaims(c, { sub: me.clerk_user_id });

      const id = randomUUID();
      await c.query(
        `insert into inventory_items (id, household_id, item_name, quantity, unit) values ($1,$2,'oil',0.2,'l')`,
        [id, h.id],
      );
      await c.query(`select public.inventory_manual_adjust($1, -1.0, 'spilled')`, [id]);
      const r = await c.query(`select quantity from inventory_items where id = $1`, [id]);
      expect(Number(r.rows[0].quantity)).toBe(0);
    });
  });
});
