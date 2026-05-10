import { describe, expect, it } from "vitest";
import { asAnon, setJwtClaims, withTransaction } from "../setup";
import { insertProfile } from "../factories";

describe("profiles RLS", () => {
  it("authenticated user can read their own profile only", async () => {
    await withTransaction(async (c) => {
      const me = await insertProfile(c);
      const other = await insertProfile(c);

      await setJwtClaims(c, { sub: me.clerk_user_id });
      const { rows } = await c.query("select id from profiles");

      expect(rows.map((r) => r.id).sort()).toEqual([me.id]);
      expect(rows).not.toContainEqual(expect.objectContaining({ id: other.id }));
    });
  });

  it("anon role sees zero profiles", async () => {
    await withTransaction(async (c) => {
      await insertProfile(c);
      await asAnon(c);
      const { rows } = await c.query("select id from profiles");
      expect(rows).toHaveLength(0);
    });
  });

  it("user can update display_name on own row", async () => {
    await withTransaction(async (c) => {
      const me = await insertProfile(c, { display_name: "Old" });
      await setJwtClaims(c, { sub: me.clerk_user_id });
      await c.query(
        "update profiles set display_name = $1 where id = $2",
        ["New", me.id],
      );
      const { rows } = await c.query(
        "select display_name from profiles where id = $1",
        [me.id],
      );
      expect(rows[0].display_name).toBe("New");
    });
  });

  it("user cannot update is_admin on own row", async () => {
    await withTransaction(async (c) => {
      const me = await insertProfile(c, { is_admin: false });
      await setJwtClaims(c, { sub: me.clerk_user_id });
      await c.query("update profiles set is_admin = true where id = $1", [me.id]);
      const { rows } = await c.query(
        "select is_admin from profiles where id = $1",
        [me.id],
      );
      expect(rows[0].is_admin).toBe(false);
    });
  });
});
