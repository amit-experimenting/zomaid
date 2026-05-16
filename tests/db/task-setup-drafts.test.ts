import { describe, expect, it } from "vitest";
import { asAnon, setJwtClaims, withTransaction } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";

// Covers the task_setup_drafts table from
// 20260705_001_household_setup_gates.sql:
//   - PK on household_id (one draft per household)
//   - picked_task_ids uuid[] not null default '{}'
//   - tuned_json jsonb null
//   - RLS: read + write policies gated on is_active_owner_or_maid(household_id)
//     (NOTE: family_member is intentionally excluded by that helper)

describe("task_setup_drafts RLS + lifecycle", () => {
  it("active owner can INSERT a draft and SELECT it back", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id,
        profile_id: owner.id,
        role: "owner",
      });

      await setJwtClaims(c, { sub: owner.clerk_user_id });
      await c.query(
        `insert into task_setup_drafts (household_id, picked_task_ids, tuned_json)
         values ($1, $2::uuid[], $3::jsonb)`,
        [h.id, [], JSON.stringify({ step: 1 })],
      );

      const { rows } = await c.query<{
        household_id: string;
        picked_task_ids: string[];
        tuned_json: { step: number } | null;
      }>(
        `select household_id, picked_task_ids, tuned_json
           from task_setup_drafts where household_id = $1`,
        [h.id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].household_id).toBe(h.id);
      expect(rows[0].picked_task_ids).toEqual([]);
      expect(rows[0].tuned_json).toEqual({ step: 1 });
    });
  });

  it("active owner can UPDATE their own draft (e.g. picks -> tuning round-trip)", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id,
        profile_id: owner.id,
        role: "owner",
      });

      await setJwtClaims(c, { sub: owner.clerk_user_id });
      await c.query(
        "insert into task_setup_drafts (household_id) values ($1)",
        [h.id],
      );

      const newPicks = [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
      ];
      await c.query(
        `update task_setup_drafts
            set picked_task_ids = $2::uuid[],
                tuned_json      = $3::jsonb,
                updated_at      = now()
          where household_id = $1`,
        [h.id, newPicks, JSON.stringify({ step: 2 })],
      );

      const { rows } = await c.query<{
        picked_task_ids: string[];
        tuned_json: { step: number };
      }>(
        "select picked_task_ids, tuned_json from task_setup_drafts where household_id = $1",
        [h.id],
      );
      expect(rows[0].picked_task_ids).toEqual(newPicks);
      expect(rows[0].tuned_json).toEqual({ step: 2 });
    });
  });

  it("active maid can read AND write the draft (maid is owner-or-maid per helper)", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const maid = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id,
        profile_id: owner.id,
        role: "owner",
      });
      await insertMembership(c, {
        household_id: h.id,
        profile_id: maid.id,
        role: "maid",
      });

      // Maid creates the draft.
      await setJwtClaims(c, { sub: maid.clerk_user_id });
      await c.query(
        "insert into task_setup_drafts (household_id) values ($1)",
        [h.id],
      );
      const seen = await c.query(
        "select household_id from task_setup_drafts where household_id = $1",
        [h.id],
      );
      expect(seen.rows).toHaveLength(1);
    });
  });

  it("family_member is NOT owner-or-maid -> cannot SELECT or INSERT a draft", async () => {
    await withTransaction(async (c) => {
      // Seed everything as the superuser first; the test then assumes two
      // distinct households so the family_member's blocked INSERT doesn't
      // race with an existing PK row in the same household.
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

      const owner2 = await insertProfile(c);
      const fam2 = await insertProfile(c);
      const h2 = await insertHousehold(c, { created_by_profile_id: owner2.id });
      await insertMembership(c, {
        household_id: h2.id,
        profile_id: owner2.id,
        role: "owner",
      });
      await insertMembership(c, {
        household_id: h2.id,
        profile_id: fam2.id,
        role: "family_member",
      });

      // Seed a draft in household 1 as its owner.
      await setJwtClaims(c, { sub: owner.clerk_user_id });
      await c.query(
        "insert into task_setup_drafts (household_id) values ($1)",
        [h.id],
      );

      // Family member of household 1 can't see it.
      await setJwtClaims(c, { sub: fam.clerk_user_id });
      const seen = await c.query(
        "select household_id from task_setup_drafts where household_id = $1",
        [h.id],
      );
      expect(seen.rows).toHaveLength(0);

      // Family member of household 2 (which has no draft yet) can't insert
      // one either. Wrap in a savepoint so the expected RLS rejection
      // doesn't abort the outer rollback transaction.
      await setJwtClaims(c, { sub: fam2.clerk_user_id });
      await c.query("savepoint sp_fam_insert");
      await expect(
        c.query(
          "insert into task_setup_drafts (household_id) values ($1)",
          [h2.id],
        ),
      ).rejects.toThrow(/row-level security/i);
      await c.query("rollback to savepoint sp_fam_insert");
    });
  });

  it("a member of a different household cannot SELECT or INSERT another household's draft", async () => {
    await withTransaction(async (c) => {
      const ownerA = await insertProfile(c);
      const hA = await insertHousehold(c, { created_by_profile_id: ownerA.id });
      await insertMembership(c, {
        household_id: hA.id,
        profile_id: ownerA.id,
        role: "owner",
      });

      const ownerB = await insertProfile(c);
      const hB = await insertHousehold(c, { created_by_profile_id: ownerB.id });
      await insertMembership(c, {
        household_id: hB.id,
        profile_id: ownerB.id,
        role: "owner",
      });

      // Seed a draft in household A under ownerA's session.
      await setJwtClaims(c, { sub: ownerA.clerk_user_id });
      await c.query(
        "insert into task_setup_drafts (household_id) values ($1)",
        [hA.id],
      );

      await setJwtClaims(c, { sub: ownerB.clerk_user_id });
      // Cannot read household A's draft.
      const seen = await c.query(
        "select household_id from task_setup_drafts where household_id = $1",
        [hA.id],
      );
      expect(seen.rows).toHaveLength(0);

      // Cannot write a draft for household A either (with check fails).
      // savepoint isolates the expected error from the outer rollback tx.
      await c.query("savepoint sp_cross_insert");
      await expect(
        c.query(
          "insert into task_setup_drafts (household_id) values ($1)",
          [hA.id],
        ),
      ).rejects.toThrow(/row-level security/i);
      await c.query("rollback to savepoint sp_cross_insert");
    });
  });

  it("anon role cannot SELECT or INSERT drafts", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id,
        profile_id: owner.id,
        role: "owner",
      });
      await setJwtClaims(c, { sub: owner.clerk_user_id });
      await c.query(
        "insert into task_setup_drafts (household_id) values ($1)",
        [h.id],
      );

      await asAnon(c);
      const seen = await c.query("select household_id from task_setup_drafts");
      expect(seen.rows).toHaveLength(0);

      await c.query("savepoint sp_anon_insert");
      await expect(
        c.query(
          "insert into task_setup_drafts (household_id) values ($1)",
          [h.id],
        ),
      ).rejects.toThrow(/row-level security/i);
      await c.query("rollback to savepoint sp_anon_insert");
    });
  });

  it("enforces one draft per household (household_id PRIMARY KEY) and supports upsert", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id,
        profile_id: owner.id,
        role: "owner",
      });
      await setJwtClaims(c, { sub: owner.clerk_user_id });

      await c.query(
        "insert into task_setup_drafts (household_id) values ($1)",
        [h.id],
      );

      // Second straight INSERT collides on the PK. Isolate the error.
      await c.query("savepoint sp_dup");
      await expect(
        c.query(
          "insert into task_setup_drafts (household_id) values ($1)",
          [h.id],
        ),
      ).rejects.toThrow(/duplicate key|task_setup_drafts_pkey/i);
      await c.query("rollback to savepoint sp_dup");

      // Upsert on conflict (the path actions.ts uses) succeeds and updates.
      await c.query(
        `insert into task_setup_drafts (household_id, tuned_json)
           values ($1, $2::jsonb)
         on conflict (household_id) do update
           set tuned_json = excluded.tuned_json,
               updated_at = now()`,
        [h.id, JSON.stringify({ step: 9 })],
      );
      const { rows } = await c.query<{ tuned_json: { step: number } }>(
        "select tuned_json from task_setup_drafts where household_id = $1",
        [h.id],
      );
      expect(rows[0].tuned_json).toEqual({ step: 9 });
    });
  });

  it("deleting the household cascades to the draft (ON DELETE CASCADE)", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id,
        profile_id: owner.id,
        role: "owner",
      });
      await setJwtClaims(c, { sub: owner.clerk_user_id });
      await c.query(
        "insert into task_setup_drafts (household_id) values ($1)",
        [h.id],
      );

      // Drop back to the underlying superuser test connection so the cascade
      // delete isn't blocked by RLS on households.
      await c.query("reset role");
      await c.query("delete from households where id = $1", [h.id]);

      const { rows } = await c.query(
        "select 1 from task_setup_drafts where household_id = $1",
        [h.id],
      );
      expect(rows).toHaveLength(0);
    });
  });
});
