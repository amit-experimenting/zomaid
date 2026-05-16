import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { withTransaction } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";

// Inline task factory — only used by this file, so kept local rather than
// added to tests/factories.ts. Mirrors the shape enforced by
// tasks_recurrence_shape in 20260531_001_tasks_and_occurrences.sql.
type RecurrenceFrequency = "daily" | "weekly" | "monthly";

type TaskOverrides = {
  household_id: string | null;
  title?: string;
  recurrence_frequency: RecurrenceFrequency;
  recurrence_interval?: number;
  recurrence_byweekday?: number[] | null;
  recurrence_bymonthday?: number | null;
  // recurrence_starts_on intentionally omitted — the column default
  // (current_date) always fires; tests override it via a follow-up UPDATE
  // when they need a different start date.
  recurrence_ends_on?: string | null;
  due_time?: string;
  archived_at?: string | null;
  created_by_profile_id?: string | null;
};

async function insertTask(c: Client, overrides: TaskOverrides): Promise<string> {
  const id = randomUUID();
  // recurrence_starts_on has a NOT NULL constraint with a `default current_date`.
  // We must omit the column (not pass NULL) to let the default fire when the
  // caller didn't supply a value — every test then sets it explicitly via UPDATE
  // immediately after, which keeps this factory simple.
  await c.query(
    `insert into public.tasks
       (id, household_id, title, recurrence_frequency, recurrence_interval,
        recurrence_byweekday, recurrence_bymonthday,
        recurrence_ends_on, due_time, archived_at, created_by_profile_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::time,$10,$11)`,
    [
      id,
      overrides.household_id,
      overrides.title ?? "Test task",
      overrides.recurrence_frequency,
      overrides.recurrence_interval ?? 1,
      overrides.recurrence_byweekday ?? null,
      overrides.recurrence_bymonthday ?? null,
      overrides.recurrence_ends_on ?? null,
      overrides.due_time ?? "09:00:00",
      overrides.archived_at ?? null,
      overrides.created_by_profile_id ?? null,
    ],
  );
  return id;
}

// Mark the household past the task-setup gate (added in 20260705).
async function completeTaskSetup(c: Client, householdId: string) {
  await c.query(
    `update public.households set task_setup_completed_at = now() where id = $1`,
    [householdId],
  );
}

async function bootstrap(c: Client, opts: { completeSetup?: boolean } = {}) {
  const me = await insertProfile(c);
  const h = await insertHousehold(c, { created_by_profile_id: me.id });
  await insertMembership(c, {
    household_id: h.id,
    profile_id: me.id,
    role: "owner",
    status: "active",
  });
  if (opts.completeSetup ?? true) {
    await completeTaskSetup(c, h.id);
  }
  return { householdId: h.id, profileId: me.id };
}

async function countOccurrences(c: Client, taskId: string): Promise<number> {
  const { rows } = await c.query<{ n: string }>(
    `select count(*)::text as n from public.task_occurrences where task_id = $1`,
    [taskId],
  );
  return Number(rows[0].n);
}

async function getOccurrenceDates(c: Client, taskId: string): Promise<string[]> {
  // Return due_at projected as SGT date strings, sorted.
  const { rows } = await c.query<{ d: string }>(
    `select to_char(due_at at time zone 'Asia/Singapore', 'YYYY-MM-DD') as d
       from public.task_occurrences
      where task_id = $1
      order by due_at`,
    [taskId],
  );
  return rows.map((r) => r.d);
}

describe("tasks_generate_occurrences (RPC)", () => {
  it("daily task generates one occurrence per day in the horizon", async () => {
    await withTransaction(async (c) => {
      const { householdId } = await bootstrap(c);
      const taskId = await insertTask(c, {
        household_id: householdId,
        recurrence_frequency: "daily",
      });
      // Factory sets recurrence_starts_on via DB default (current_date), so
      // no follow-up update is needed here.

      // Horizon = current_date + 6 → 7 inclusive days (today .. today+6).
      await c.query(`select public.tasks_generate_occurrences((current_date + 6)::date)`);

      expect(await countOccurrences(c, taskId)).toBe(7);
    });
  });

  it("weekly task generates only on byweekday matches", async () => {
    await withTransaction(async (c) => {
      const { householdId } = await bootstrap(c);
      // Use [1,3] = Monday + Wednesday. Start today; in a 14-day horizon we
      // should see exactly 2 Mondays + 2 Wednesdays *that fall within the
      // window*, depending on what today is. So compute the expected count
      // directly in SQL instead of hard-coding.
      const taskId = await insertTask(c, {
        household_id: householdId,
        recurrence_frequency: "weekly",
        recurrence_byweekday: [1, 3],
      });
      await c.query(
        `update public.tasks set recurrence_starts_on = current_date where id = $1`,
        [taskId],
      );

      await c.query(`select public.tasks_generate_occurrences((current_date + 13)::date)`);

      // Compute the expected days SQL-side using the same dow rule.
      const { rows: expected } = await c.query<{ n: string }>(
        `select count(*)::text as n
           from (
             select generate_series(current_date, current_date + 13, '1 day'::interval)::date as d
           ) s
          where extract(dow from s.d)::int = any(array[1,3])`,
      );
      expect(await countOccurrences(c, taskId)).toBe(Number(expected[0].n));

      // Every generated occurrence's SGT date must be a Mon or Wed.
      const { rows: bad } = await c.query<{ n: string }>(
        `select count(*)::text as n
           from public.task_occurrences
          where task_id = $1
            and extract(dow from (due_at at time zone 'Asia/Singapore'))::int not in (1,3)`,
        [taskId],
      );
      expect(Number(bad[0].n)).toBe(0);
    });
  });

  it("monthly task generates only on bymonthday matches", async () => {
    await withTransaction(async (c) => {
      const { householdId } = await bootstrap(c);
      // Pick day-of-month = 15. Start of last month, horizon = end of next month.
      const taskId = await insertTask(c, {
        household_id: householdId,
        recurrence_frequency: "monthly",
        recurrence_bymonthday: 15,
      });
      await c.query(
        `update public.tasks
           set recurrence_starts_on = (date_trunc('month', current_date) - interval '1 month')::date
         where id = $1`,
        [taskId],
      );

      // Horizon = last day of next month.
      await c.query(
        `select public.tasks_generate_occurrences(
           (date_trunc('month', current_date) + interval '2 month' - interval '1 day')::date
         )`,
      );

      // Generation is bounded below by current_date, so we expect "the 15th"
      // of this month (if not yet passed) AND next month. Compute SQL-side.
      const { rows: expected } = await c.query<{ n: string }>(
        `select count(*)::text as n
           from (
             select generate_series(
                      current_date,
                      (date_trunc('month', current_date) + interval '2 month' - interval '1 day')::date,
                      '1 day'::interval
                    )::date as d
           ) s
          where extract(day from s.d)::int = 15`,
      );
      expect(await countOccurrences(c, taskId)).toBe(Number(expected[0].n));

      // All occurrences land on the 15th in SGT.
      const dates = await getOccurrenceDates(c, taskId);
      for (const d of dates) {
        expect(d.slice(-2)).toBe("15");
      }
    });
  });

  it("re-running the RPC is idempotent (no duplicate rows)", async () => {
    await withTransaction(async (c) => {
      const { householdId } = await bootstrap(c);
      const taskId = await insertTask(c, {
        household_id: householdId,
        recurrence_frequency: "daily",
      });
      await c.query(
        `update public.tasks set recurrence_starts_on = current_date where id = $1`,
        [taskId],
      );

      await c.query(`select public.tasks_generate_occurrences((current_date + 6)::date)`);
      const first = await countOccurrences(c, taskId);
      expect(first).toBe(7);

      // Second call should add nothing (on conflict do nothing).
      await c.query(`select public.tasks_generate_occurrences((current_date + 6)::date)`);
      expect(await countOccurrences(c, taskId)).toBe(first);
    });
  });

  it("does not generate for archived tasks", async () => {
    await withTransaction(async (c) => {
      const { householdId } = await bootstrap(c);
      const taskId = await insertTask(c, {
        household_id: householdId,
        recurrence_frequency: "daily",
      });
      await c.query(
        `update public.tasks
           set recurrence_starts_on = current_date,
               archived_at = now()
         where id = $1`,
        [taskId],
      );

      await c.query(`select public.tasks_generate_occurrences((current_date + 6)::date)`);

      expect(await countOccurrences(c, taskId)).toBe(0);
    });
  });

  it("does not generate before starts_on or after ends_on", async () => {
    await withTransaction(async (c) => {
      const { householdId } = await bootstrap(c);
      const taskId = await insertTask(c, {
        household_id: householdId,
        recurrence_frequency: "daily",
      });
      // Window: today+2 .. today+4 (inclusive) → 3 days.
      await c.query(
        `update public.tasks
           set recurrence_starts_on = (current_date + 2),
               recurrence_ends_on   = (current_date + 4)
         where id = $1`,
        [taskId],
      );

      await c.query(`select public.tasks_generate_occurrences((current_date + 10)::date)`);

      expect(await countOccurrences(c, taskId)).toBe(3);

      const dates = await getOccurrenceDates(c, taskId);
      const { rows: bounds } = await c.query<{ lo: string; hi: string }>(
        `select to_char(current_date + 2, 'YYYY-MM-DD') as lo,
                to_char(current_date + 4, 'YYYY-MM-DD') as hi`,
      );
      for (const d of dates) {
        expect(d >= bounds[0].lo).toBe(true);
        expect(d <= bounds[0].hi).toBe(true);
      }
    });
  });

  it("respects the household task_setup_completed_at gate", async () => {
    await withTransaction(async (c) => {
      // Bootstrap WITHOUT completing setup.
      const { householdId } = await bootstrap(c, { completeSetup: false });
      const taskId = await insertTask(c, {
        household_id: householdId,
        recurrence_frequency: "daily",
      });
      await c.query(
        `update public.tasks set recurrence_starts_on = current_date where id = $1`,
        [taskId],
      );

      await c.query(`select public.tasks_generate_occurrences((current_date + 6)::date)`);

      // Setup-gate is closed → no occurrences generated.
      expect(await countOccurrences(c, taskId)).toBe(0);

      // Open the gate and re-run; now we get the expected rows.
      await completeTaskSetup(c, householdId);
      await c.query(`select public.tasks_generate_occurrences((current_date + 6)::date)`);
      expect(await countOccurrences(c, taskId)).toBe(7);
    });
  });

  it("respects recurrence_interval (every 2 days)", async () => {
    await withTransaction(async (c) => {
      const { householdId } = await bootstrap(c);
      const taskId = await insertTask(c, {
        household_id: householdId,
        recurrence_frequency: "daily",
        recurrence_interval: 2,
      });
      await c.query(
        `update public.tasks set recurrence_starts_on = current_date where id = $1`,
        [taskId],
      );

      // Horizon current_date + 6 → 7 candidate days, every other day → 4 hits
      // (days 0,2,4,6).
      await c.query(`select public.tasks_generate_occurrences((current_date + 6)::date)`);

      expect(await countOccurrences(c, taskId)).toBe(4);
    });
  });
});

describe("tasks_prune_old (RPC)", () => {
  it("deletes done/skipped occurrences older than the retention window", async () => {
    await withTransaction(async (c) => {
      const { householdId, profileId } = await bootstrap(c);
      const taskId = await insertTask(c, {
        household_id: householdId,
        recurrence_frequency: "daily",
      });
      await c.query(
        `update public.tasks set recurrence_starts_on = current_date where id = $1`,
        [taskId],
      );

      // Insert three occurrences directly so we control completed_at exactly:
      //   - old done       (should be deleted)
      //   - old skipped    (should be deleted)
      //   - old pending    (should NOT be deleted — prune only touches done/skipped)
      await c.query(
        `insert into public.task_occurrences
            (household_id, task_id, due_at, status, completed_by_profile_id, completed_at)
          values
            ($1, $2, now() - interval '120 days', 'done',    $3, now() - interval '120 days'),
            ($1, $2, now() - interval '121 days', 'skipped', $3, now() - interval '121 days'),
            ($1, $2, now() - interval '122 days', 'pending', null, null)`,
        [householdId, taskId, profileId],
      );

      const { rows } = await c.query<{ tasks_prune_old: number }>(
        `select public.tasks_prune_old(90) as tasks_prune_old`,
      );
      expect(rows[0].tasks_prune_old).toBe(2);

      const remaining = await countOccurrences(c, taskId);
      expect(remaining).toBe(1);

      const { rows: kept } = await c.query<{ status: string }>(
        `select status from public.task_occurrences where task_id = $1`,
        [taskId],
      );
      expect(kept[0].status).toBe("pending");
    });
  });

  it("keeps done/skipped occurrences within the retention window", async () => {
    await withTransaction(async (c) => {
      const { householdId, profileId } = await bootstrap(c);
      const taskId = await insertTask(c, {
        household_id: householdId,
        recurrence_frequency: "daily",
      });
      await c.query(
        `update public.tasks set recurrence_starts_on = current_date where id = $1`,
        [taskId],
      );

      // Both inside the 90-day window — must survive prune.
      await c.query(
        `insert into public.task_occurrences
            (household_id, task_id, due_at, status, completed_by_profile_id, completed_at)
          values
            ($1, $2, now() - interval '10 days', 'done',    $3, now() - interval '10 days'),
            ($1, $2, now() - interval '30 days', 'skipped', $3, now() - interval '30 days')`,
        [householdId, taskId, profileId],
      );

      const { rows } = await c.query<{ tasks_prune_old: number }>(
        `select public.tasks_prune_old(90) as tasks_prune_old`,
      );
      expect(rows[0].tasks_prune_old).toBe(0);

      expect(await countOccurrences(c, taskId)).toBe(2);
    });
  });

  it("honours a custom retention horizon", async () => {
    await withTransaction(async (c) => {
      const { householdId, profileId } = await bootstrap(c);
      const taskId = await insertTask(c, {
        household_id: householdId,
        recurrence_frequency: "daily",
      });
      await c.query(
        `update public.tasks set recurrence_starts_on = current_date where id = $1`,
        [taskId],
      );

      // 20-day-old "done" survives 30-day prune but is killed by 10-day prune.
      await c.query(
        `insert into public.task_occurrences
            (household_id, task_id, due_at, status, completed_by_profile_id, completed_at)
          values
            ($1, $2, now() - interval '20 days', 'done', $3, now() - interval '20 days')`,
        [householdId, taskId, profileId],
      );

      const { rows: a } = await c.query<{ n: number }>(
        `select public.tasks_prune_old(30) as n`,
      );
      expect(a[0].n).toBe(0);
      expect(await countOccurrences(c, taskId)).toBe(1);

      const { rows: b } = await c.query<{ n: number }>(
        `select public.tasks_prune_old(10) as n`,
      );
      expect(b[0].n).toBe(1);
      expect(await countOccurrences(c, taskId)).toBe(0);
    });
  });
});
