import { describe, expect, it } from "vitest";
import { getClient } from "../setup";

// Asserts on the seed migration output, run after `pnpm db:reset`.
// No JWT / RLS context: the service-role pg connection reads everything.

describe("starter pack seed integrity", () => {
  it("ships 55 starter recipes split 14/15/11/15 across slots", async () => {
    const c = await getClient();
    const { rows } = await c.query<{ slot: string; count: string }>(
      `select slot, count(*)::text as count
         from recipes
         where household_id is null and archived_at is null
         group by slot order by slot`,
    );
    const bySlot = Object.fromEntries(rows.map((r) => [r.slot, Number(r.count)]));
    expect(bySlot.breakfast).toBe(14);
    expect(bySlot.lunch).toBe(15);
    expect(bySlot.snacks).toBe(11);
    expect(bySlot.dinner).toBe(15);
  });

  it("every starter row has default_servings in [1,20]", async () => {
    const c = await getClient();
    const { rows } = await c.query(
      `select count(*)::int as bad
         from recipes
         where household_id is null
           and (default_servings is null or default_servings < 1 or default_servings > 20)`,
    );
    expect(rows[0].bad).toBe(0);
  });

  it("every starter row has at least 4 ingredients", async () => {
    const c = await getClient();
    const { rows } = await c.query<{ name: string; n: string }>(
      `select r.name, count(ri.id)::text as n
         from recipes r
         left join recipe_ingredients ri on ri.recipe_id = r.id
         where r.household_id is null
         group by r.id, r.name
         having count(ri.id) < 4`,
    );
    expect(rows, `These recipes have <4 ingredients: ${rows.map((r) => r.name).join(", ")}`).toHaveLength(0);
  });

  it("every starter row has at least 3 steps", async () => {
    const c = await getClient();
    const { rows } = await c.query<{ name: string; n: string }>(
      `select r.name, count(rs.id)::text as n
         from recipes r
         left join recipe_steps rs on rs.recipe_id = r.id
         where r.household_id is null
         group by r.id, r.name
         having count(rs.id) < 3`,
    );
    expect(rows, `These recipes have <3 steps: ${rows.map((r) => r.name).join(", ")}`).toHaveLength(0);
  });

  it("starter photo_path is either null or matches the starter/<slug>.jpg convention", async () => {
    // Migration 20260701_001 NULLed every starter photo_path because the
    // referenced files were never uploaded to the public bucket — the UI
    // renders the deterministic SVG placeholder instead. If the seed is
    // ever populated with real images this should narrow back to the
    // strict regex assertion.
    const c = await getClient();
    const { rows } = await c.query<{ name: string; photo_path: string | null }>(
      `select name, photo_path from recipes
         where household_id is null
           and photo_path is not null
           and photo_path !~ '^starter/[a-z0-9-]+\\.jpg$'`,
    );
    expect(rows, `Non-null starter photo_paths must match starter/<slug>.jpg: ${rows.map((r) => `${r.name}=${r.photo_path}`).join(", ")}`).toHaveLength(0);
  });

  it("every ingredient has a numeric quantity and non-null unit", async () => {
    const c = await getClient();
    const { rows } = await c.query(
      `select count(*)::int as bad
         from recipe_ingredients ri
         join recipes r on r.id = ri.recipe_id
         where r.household_id is null
           and (ri.quantity is null or ri.unit is null)`,
    );
    expect(rows[0].bad).toBe(0);
  });

  it("starter names are unique", async () => {
    const c = await getClient();
    const { rows } = await c.query<{ name: string; n: string }>(
      `select name, count(*)::text as n from recipes
         where household_id is null
         group by name having count(*) > 1`,
    );
    expect(rows, `Duplicate starter names: ${rows.map((r) => r.name).join(", ")}`).toHaveLength(0);
  });
});
