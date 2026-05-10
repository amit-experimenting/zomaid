import { describe, expect, it } from "vitest";
import { withTransaction } from "../setup";
import { insertProfile } from "../factories";
import { syncAdminFlags } from "@/lib/admin/env-sync";

describe("syncAdminFlags", () => {
  it("flags listed clerk_user_ids as admin", async () => {
    await withTransaction(async (c) => {
      const a = await insertProfile(c, { is_admin: false });
      const b = await insertProfile(c, { is_admin: false });

      await syncAdminFlags({ clerkUserIds: [a.clerk_user_id], pgClient: c });

      const { rows } = await c.query(
        "select clerk_user_id, is_admin from profiles where id = any($1) order by id",
        [[a.id, b.id]],
      );
      const map = new Map(rows.map((r) => [r.clerk_user_id, r.is_admin]));
      expect(map.get(a.clerk_user_id)).toBe(true);
      expect(map.get(b.clerk_user_id)).toBe(false);
    });
  });

  it("clears admin from previously-flagged users no longer in env", async () => {
    await withTransaction(async (c) => {
      const a = await insertProfile(c, { is_admin: true });
      await syncAdminFlags({ clerkUserIds: [], pgClient: c });
      const { rows } = await c.query("select is_admin from profiles where id = $1", [a.id]);
      expect(rows[0].is_admin).toBe(false);
    });
  });
});
