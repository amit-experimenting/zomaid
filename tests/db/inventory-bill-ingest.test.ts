import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { setJwtClaims, withTransaction } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";
import type { Client } from "pg";

async function setupBillAndLine(c: Client, opts: { itemName?: string; qty?: number; unit?: string } = {}) {
  const me = await insertProfile(c);
  const h = await insertHousehold(c, { created_by_profile_id: me.id });
  await insertMembership(c, { household_id: h.id, profile_id: me.id, role: "owner", status: "active" });
  await setJwtClaims(c, { sub: me.clerk_user_id });

  const billId = randomUUID();
  await c.query(
    `insert into bills (id, household_id, status, image_storage_path)
     values ($1, $2, 'processed', 'test/x.jpg')`,
    [billId, h.id],
  );

  const lineId = randomUUID();
  await c.query(
    `insert into bill_line_items (id, bill_id, position, item_name, quantity, unit)
     values ($1, $2, 1, $3, $4, $5)`,
    [lineId, billId, opts.itemName ?? "basmati rice", opts.qty ?? 5, opts.unit ?? "kg"],
  );

  return { householdId: h.id, profileId: me.id, billId, lineId };
}

describe("inventory_bill_ingest / skip / unskip", () => {
  it("creates a new inventory item from a line", async () => {
    await withTransaction(async (c) => {
      const { lineId } = await setupBillAndLine(c);
      await c.query(
        `select public.inventory_bill_ingest($1, null, 5, 'kg', 'basmati rice')`,
        [lineId],
      );
      const inv = await c.query(`select quantity, unit from inventory_items where lower(item_name) = 'basmati rice'`);
      expect(inv.rows).toHaveLength(1);
      expect(Number(inv.rows[0].quantity)).toBe(5);
      expect(inv.rows[0].unit).toBe("kg");

      const line = await c.query(`select inventory_ingested_at, matched_inventory_item_id from bill_line_items where id = $1`, [lineId]);
      expect(line.rows[0].inventory_ingested_at).not.toBeNull();
      expect(line.rows[0].matched_inventory_item_id).not.toBeNull();
    });
  });

  it("adds to existing inventory with unit conversion", async () => {
    await withTransaction(async (c) => {
      const { householdId, lineId } = await setupBillAndLine(c, { itemName: "basmati rice", qty: 2, unit: "kg" });
      const invId = randomUUID();
      // Existing inventory in grams.
      await c.query(
        `insert into inventory_items (id, household_id, item_name, quantity, unit)
         values ($1, $2, 'basmati rice', 1000, 'g')`,
        [invId, householdId],
      );
      await c.query(`select public.inventory_bill_ingest($1, $2, 2, 'kg', null)`, [lineId, invId]);

      const inv = await c.query(`select quantity from inventory_items where id = $1`, [invId]);
      // 1000 g + (2 kg = 2000 g) = 3000 g
      expect(Number(inv.rows[0].quantity)).toBe(3000);
    });
  });

  it("rejects with INV_NO_CONVERSION when units cannot be reconciled", async () => {
    await withTransaction(async (c) => {
      const { householdId, lineId } = await setupBillAndLine(c, { itemName: "unobtanium", qty: 1, unit: "lump" });
      const invId = randomUUID();
      await c.query(
        `insert into inventory_items (id, household_id, item_name, quantity, unit)
         values ($1, $2, 'unobtanium', 5, 'kg')`,
        [invId, householdId],
      );
      await expect(
        c.query(`select public.inventory_bill_ingest($1, $2, 1, 'lump', null)`, [lineId, invId]),
      ).rejects.toThrow(/INV_NO_CONVERSION/);
    });
  });

  it("skip marks the line and is reversible via unskip", async () => {
    await withTransaction(async (c) => {
      const { lineId } = await setupBillAndLine(c);
      await c.query(`select public.inventory_bill_skip($1)`, [lineId]);
      let line = await c.query(`select inventory_ingestion_skipped from bill_line_items where id = $1`, [lineId]);
      expect(line.rows[0].inventory_ingestion_skipped).toBe(true);

      await c.query(`select public.inventory_bill_unskip($1)`, [lineId]);
      line = await c.query(`select inventory_ingestion_skipped from bill_line_items where id = $1`, [lineId]);
      expect(line.rows[0].inventory_ingestion_skipped).toBe(false);
    });
  });

  it("family member without privilege cannot ingest", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const family = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner", status: "active" });
      await insertMembership(c, { household_id: h.id, profile_id: family.id, role: "family_member", status: "active", privilege: "view_only" });
      await setJwtClaims(c, { sub: owner.clerk_user_id });

      const billId = randomUUID();
      await c.query(
        `insert into bills (id, household_id, status, image_storage_path) values ($1, $2, 'processed', 'x.jpg')`,
        [billId, h.id],
      );
      const lineId = randomUUID();
      await c.query(
        `insert into bill_line_items (id, bill_id, position, item_name, quantity, unit) values ($1, $2, 1, 'rice', 1, 'kg')`,
        [lineId, billId],
      );

      await setJwtClaims(c, { sub: family.clerk_user_id });
      await expect(
        c.query(`select public.inventory_bill_ingest($1, null, 1, 'kg', 'rice')`, [lineId]),
      ).rejects.toThrow(/permission/i);
    });
  });
});
