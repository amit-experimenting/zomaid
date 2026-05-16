# Household-level meal preference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a household-level `diet_preference` column that, when set, overrides per-member diet preferences for all recipe/plan filtering. Surface the effective preference on the dashboard and warn before applying a stricter-than-implied value.

**Architecture:** Single-column schema change on `public.households`. Rewrite the existing `household_strictest_diet(uuid)` SQL helper as `household_effective_diet(uuid)` that short-circuits on the new column then falls back to today's strictest-non-maid-member aggregation. `effective_recipes` only changes its function-call name; every downstream consumer (library, plan picker, auto-fill, suggestions) inherits the new behavior automatically. New server action + client component handle settings UI. Dashboard gains a compact chip showing the effective diet and its source.

**Tech Stack:** Postgres (Supabase), Next.js 16 App Router (server components + server actions), TypeScript, Vitest for unit + DB tests, native `window.confirm` for the stricter-than-implied warning.

**Spec:** [docs/specs/2026-05-16-household-meal-preference-design.md](../specs/2026-05-16-household-meal-preference-design.md)

---

## File Map

**Created:**
- `supabase/migrations/20260706_001_household_diet_preference.sql` — schema + helper rename
- `src/components/household/household-diet-form.tsx` — client component wrapping the new dropdown with the stricter-than-implied confirmation
- `tests/db/household-diet-preference.test.ts` — DB-level helper + `effective_recipes` semantics
- `tests/actions/household-diet.test.ts` — server action permissions + null-clearing

**Modified:**
- `src/lib/db/types.ts` — add `households.diet_preference` to Row/Insert; rename `household_strictest_diet` → `household_effective_diet` in `Functions`
- `src/app/household/settings/actions.ts` — add `updateHouseholdDiet` server action
- `src/app/household/settings/page.tsx` — new Meal Preference card; override note on each member row when household pref is set
- `src/app/dashboard/page.tsx` — fetch effective diet + render compact chip when a filter is active

**Untouched but inherits behavior:** Every consumer of `effective_recipes` (`/recipes` page, slot picker, autofill RPC, suggestion engine) — they re-run through the helper automatically.

---

## Task 1: Migration — add column, rename helper, recreate `effective_recipes`

**Files:**
- Create: `supabase/migrations/20260706_001_household_diet_preference.sql`

- [ ] **Step 1: Verify migration filename is free**

Run: `ls supabase/migrations | grep 20260706`
Expected: no output (no collision). If a file already exists with this prefix, bump to `20260706_002_...` and continue.

- [ ] **Step 2: Create the migration file**

Create `supabase/migrations/20260706_001_household_diet_preference.sql`:

```sql
-- Household-level diet preference. When set, overrides every member's
-- personal preference for recipe / plan filtering. Renames the existing
-- household_strictest_diet helper to household_effective_diet and gives
-- it short-circuit logic on the new column.

alter table public.households
  add column diet_preference public.diet;

-- Drop the old helper. effective_recipes (recreated below) is the only
-- in-tree caller; the rename is intentional to reflect the new semantics.
drop function if exists public.household_strictest_diet(uuid);

create or replace function public.household_effective_diet(p_household uuid)
  returns public.diet
  language sql stable security definer
  set search_path = public
  as $$
    select coalesce(
      -- 1. Household-level override wins outright.
      (select diet_preference from public.households where id = p_household),
      -- 2. Else strictest non-maid active member preference.
      (select case
        when bool_or(hm.diet_preference = 'vegan')      then 'vegan'::public.diet
        when bool_or(hm.diet_preference = 'vegetarian') then 'vegetarian'::public.diet
        when bool_or(hm.diet_preference = 'eggitarian') then 'eggitarian'::public.diet
        else 'non_vegetarian'::public.diet
       end
       from public.household_memberships hm
       where hm.household_id = p_household
         and hm.status = 'active'
         and hm.role <> 'maid'
         and hm.diet_preference is not null),
      -- 3. Fallback when neither household nor any member has a pref.
      'non_vegetarian'::public.diet
    );
  $$;

grant execute on function public.household_effective_diet(uuid) to authenticated;

-- Recreate effective_recipes calling the renamed helper. Body identical to
-- the 20260624_001 version except for the helper name on line 1 of the CTE.
create or replace function public.effective_recipes(p_household uuid)
  returns setof public.recipes
  language sql stable security invoker
  set search_path = public
  as $$
    with strictest as (
      select public.household_effective_diet(p_household) as d
    )
    select all_recipes.* from (
      select r.* from public.recipes r
      where r.household_id is null
        and r.archived_at is null
        and not exists (
          select 1 from public.recipes f
          where f.household_id = p_household
            and f.parent_recipe_id = r.id
        )
        and not exists (
          select 1 from public.household_recipe_hides h
          where h.household_id = p_household
            and h.recipe_id = r.id
        )
      union all
      select r.* from public.recipes r
      where r.household_id = p_household
        and r.archived_at is null
    ) all_recipes
    cross join strictest s
    where
      s.d = 'non_vegetarian'
      or (s.d = 'eggitarian' and all_recipes.diet in ('vegan','vegetarian','eggitarian'))
      or (s.d = 'vegetarian' and all_recipes.diet in ('vegan','vegetarian'))
      or (s.d = 'vegan'      and all_recipes.diet  = 'vegan');
  $$;
```

- [ ] **Step 3: Apply migration to local Supabase**

Run: `pnpm db:reset`
Expected: completes with no errors. The reset replays all migrations cleanly; the new file should be applied last.

- [ ] **Step 4: Smoke-verify the schema change in psql**

Run:
```bash
psql 'postgres://postgres:postgres@127.0.0.1:54322/postgres' -c \
  "\d public.households" | grep diet_preference
```
Expected: a line like `diet_preference | diet | | |` (column exists, nullable, type `diet`).

Run:
```bash
psql 'postgres://postgres:postgres@127.0.0.1:54322/postgres' -c \
  "\df public.household_effective_diet"
```
Expected: function listed with one `uuid` argument and `diet` return type.

Run:
```bash
psql 'postgres://postgres:postgres@127.0.0.1:54322/postgres' -c \
  "\df public.household_strictest_diet"
```
Expected: empty result (old function dropped).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260706_001_household_diet_preference.sql
git commit -m "feat(diet): household-level override column + helper rename"
```

---

## Task 2: Update TypeScript Database type

**Files:**
- Modify: `src/lib/db/types.ts`

- [ ] **Step 1: Add `diet_preference` to `households.Row` and `households.Insert`**

In `src/lib/db/types.ts`, find the `households:` table definition (around line 33). Replace its `Row` and `Insert` blocks with:

```ts
households: {
  Row: {
    id: string;
    name: string;
    address_line: string | null;
    postal_code: string | null;
    created_by_profile_id: string;
    created_at: string;
    updated_at: string;
    inventory_card_dismissed_at: string | null;
    maid_mode: MaidMode;
    task_setup_completed_at: string | null;
    diet_preference: Diet | null;
  };
  Insert: {
    name: string;
    created_by_profile_id: string;
    address_line?: string | null;
    postal_code?: string | null;
    inventory_card_dismissed_at?: string | null;
    maid_mode?: MaidMode;
    task_setup_completed_at?: string | null;
    diet_preference?: Diet | null;
  };
  Update: Partial<Database["public"]["Tables"]["households"]["Row"]>;
  Relationships: [];
};
```

- [ ] **Step 2: Rename `household_strictest_diet` to `household_effective_diet` in `Functions`**

The original `Functions` block in `src/lib/db/types.ts` does not currently list `household_strictest_diet`. Add (or replace if present) the entry `household_effective_diet`. Find the `Functions: {` map and append a new entry alongside the others (e.g., right after `effective_recipes`):

```ts
household_effective_diet: {
  Args: { p_household: string };
  Returns: Diet;
};
```

If a `household_strictest_diet` entry exists in the file (it does not at HEAD, but verify), delete it.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: passes with no new errors. (If any consumer was calling `household_strictest_diet` via the typed RPC it would fail here — none exist, but verify.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/types.ts
git commit -m "chore(types): households.diet_preference + household_effective_diet RPC"
```

---

## Task 3: DB test — `household_effective_diet` helper semantics

**Files:**
- Create: `tests/db/household-diet-preference.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `tests/db/household-diet-preference.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { withTransaction } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";

describe("household_effective_diet helper", () => {
  it("returns 'non_vegetarian' when neither household nor any member has a preference", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner",
      });
      const { rows } = await c.query<{ d: string }>(
        "select public.household_effective_diet($1) as d", [h.id]);
      expect(rows[0].d).toBe("non_vegetarian");
    });
  });

  it("returns the strictest non-maid member pref when household column is null", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const fam = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner",
      });
      await insertMembership(c, {
        household_id: h.id, profile_id: fam.id, role: "family_member",
      });
      // Owner = eggitarian, family = vegetarian → strictest = vegetarian.
      await c.query(
        `update household_memberships set diet_preference='eggitarian'
          where household_id=$1 and profile_id=$2`, [h.id, owner.id]);
      await c.query(
        `update household_memberships set diet_preference='vegetarian'
          where household_id=$1 and profile_id=$2`, [h.id, fam.id]);
      const { rows } = await c.query<{ d: string }>(
        "select public.household_effective_diet($1) as d", [h.id]);
      expect(rows[0].d).toBe("vegetarian");
    });
  });

  it("ignores maid preference in the member aggregation", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const maid = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner",
      });
      await insertMembership(c, {
        household_id: h.id, profile_id: maid.id, role: "maid",
      });
      // Owner has no pref; maid = vegan. Maid is excluded → fallback default.
      await c.query(
        `update household_memberships set diet_preference='vegan'
          where household_id=$1 and profile_id=$2`, [h.id, maid.id]);
      const { rows } = await c.query<{ d: string }>(
        "select public.household_effective_diet($1) as d", [h.id]);
      expect(rows[0].d).toBe("non_vegetarian");
    });
  });

  it("household column overrides member preferences when set", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const fam = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner",
      });
      await insertMembership(c, {
        household_id: h.id, profile_id: fam.id, role: "family_member",
      });
      // Members say non_vegetarian; household column says vegetarian.
      await c.query(
        `update household_memberships set diet_preference='non_vegetarian'
          where household_id=$1`, [h.id]);
      await c.query(
        "update households set diet_preference='vegetarian' where id=$1", [h.id]);
      const { rows } = await c.query<{ d: string }>(
        "select public.household_effective_diet($1) as d", [h.id]);
      expect(rows[0].d).toBe("vegetarian");
    });
  });

  it("household column wins even when it is less strict than members", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner",
      });
      await c.query(
        `update household_memberships set diet_preference='vegan'
          where household_id=$1 and profile_id=$2`, [h.id, owner.id]);
      await c.query(
        "update households set diet_preference='non_vegetarian' where id=$1", [h.id]);
      const { rows } = await c.query<{ d: string }>(
        "select public.household_effective_diet($1) as d", [h.id]);
      expect(rows[0].d).toBe("non_vegetarian");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm test tests/db/household-diet-preference.test.ts`
Expected: 5 tests pass. (They should pass against the migration from Task 1; if any fail, the migration body is wrong — fix it before continuing.)

- [ ] **Step 3: Commit**

```bash
git add tests/db/household-diet-preference.test.ts
git commit -m "test(diet): household_effective_diet helper semantics"
```

---

## Task 4: DB test — `effective_recipes` honors household override

**Files:**
- Modify: `tests/db/household-diet-preference.test.ts`

- [ ] **Step 1: Add a `recipes` filtering test to the same file**

Append the following `describe` block to `tests/db/household-diet-preference.test.ts`:

```ts
describe("effective_recipes respects household override", () => {
  it("hides non-vegetarian starter recipes when household pref is vegetarian", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner",
      });
      // No member preference set; set the household-level override.
      await c.query(
        "update households set diet_preference='vegetarian' where id=$1", [h.id]);

      const { rows } = await c.query<{ name: string; diet: string }>(
        `select name, diet from public.effective_recipes($1)
          where diet = 'non_vegetarian' limit 1`, [h.id]);
      expect(rows).toHaveLength(0);
    });
  });

  it("household override hides non-veg even when a member is non-vegetarian", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const fam = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner",
      });
      await insertMembership(c, {
        household_id: h.id, profile_id: fam.id, role: "family_member",
      });
      await c.query(
        `update household_memberships set diet_preference='non_vegetarian'
          where household_id=$1 and profile_id=$2`, [h.id, fam.id]);
      await c.query(
        "update households set diet_preference='vegan' where id=$1", [h.id]);

      const { rows } = await c.query<{ n: string }>(
        `select count(*)::text as n from public.effective_recipes($1)
          where diet <> 'vegan'`, [h.id]);
      expect(Number(rows[0].n)).toBe(0);
    });
  });

  it("returns all starter recipes when both household and members have no pref", async () => {
    await withTransaction(async (c) => {
      const owner = await insertProfile(c);
      const h = await insertHousehold(c, { created_by_profile_id: owner.id });
      await insertMembership(c, {
        household_id: h.id, profile_id: owner.id, role: "owner",
      });
      const { rows } = await c.query<{ n: string }>(
        `select count(*)::text as n from public.effective_recipes($1)`, [h.id]);
      expect(Number(rows[0].n)).toBe(55); // matches recipes-seed.test.ts total
    });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm test tests/db/household-diet-preference.test.ts`
Expected: all 8 tests pass (5 from Task 3 + 3 here).

- [ ] **Step 3: Commit**

```bash
git add tests/db/household-diet-preference.test.ts
git commit -m "test(diet): effective_recipes honors household override"
```

---

## Task 5: Server action — `updateHouseholdDiet`

**Files:**
- Modify: `src/app/household/settings/actions.ts`

- [ ] **Step 1: Append the new action to `actions.ts`**

Add the following block at the end of `src/app/household/settings/actions.ts` (after `updateMembershipPrivilege`):

```ts
const updateHouseholdDietSchema = z.object({
  diet: z
    .union([
      z.literal(""),
      z.enum(["vegan", "vegetarian", "eggitarian", "non_vegetarian"]),
    ])
    .optional(),
});

export async function updateHouseholdDiet(input: unknown) {
  const data = updateHouseholdDietSchema.parse(input);
  const ctx = await getCurrentHousehold();
  if (!ctx) throw new Error("no active household");
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "maid") {
    throw new Error("forbidden");
  }

  const value = data.diet && data.diet.length > 0 ? data.diet : null;
  const svc = createServiceClient();
  const { error } = await svc
    .from("households")
    .update({ diet_preference: value })
    .eq("id", ctx.household.id);
  if (error) throw new Error(error.message);

  revalidatePath("/household/settings");
  revalidatePath("/dashboard");
  revalidatePath("/plan");
  revalidatePath("/recipes");
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/app/household/settings/actions.ts
git commit -m "feat(diet): updateHouseholdDiet server action"
```

---

## Task 6: Action test — `updateHouseholdDiet` permissions + nulling

**Files:**
- Create: `tests/actions/household-diet.test.ts`

- [ ] **Step 1: Inspect an existing action test to mirror its harness**

Run: `head -60 tests/actions/memberships.test.ts`
Expected: shows the existing pattern of mocking `getCurrentHousehold` + Supabase clients. Use the same pattern below.

- [ ] **Step 2: Write the test file**

Create `tests/actions/household-diet.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const getCurrentHouseholdMock = vi.fn();
const createServiceClientMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/auth/current-household", () => ({
  getCurrentHousehold: (...a: unknown[]) => getCurrentHouseholdMock(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: (...a: unknown[]) => createServiceClientMock(...a),
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePathMock(...a),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { updateHouseholdDiet } from "@/app/household/settings/actions";

const householdId = "00000000-0000-0000-0000-000000000001";

function makeCtx(role: "owner" | "maid" | "family_member") {
  return {
    profile: { id: "p1" },
    household: { id: householdId },
    membership: { role },
  };
}

function makeSvc(updateImpl: (table: string) => unknown) {
  return { from: (table: string) => updateImpl(table) };
}

beforeEach(() => {
  getCurrentHouseholdMock.mockReset();
  createServiceClientMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("updateHouseholdDiet", () => {
  it("rejects family_member callers", async () => {
    getCurrentHouseholdMock.mockResolvedValue(makeCtx("family_member"));
    await expect(updateHouseholdDiet({ diet: "vegan" }))
      .rejects.toThrow("forbidden");
  });

  it("allows owner to set a diet", async () => {
    let captured: { table: string; patch: unknown; id: string } | null = null;
    getCurrentHouseholdMock.mockResolvedValue(makeCtx("owner"));
    createServiceClientMock.mockReturnValue(makeSvc((table) => ({
      update: (patch: unknown) => ({
        eq: (_col: string, id: string) => {
          captured = { table, patch, id };
          return Promise.resolve({ error: null });
        },
      }),
    })));
    await updateHouseholdDiet({ diet: "vegetarian" });
    expect(captured).toEqual({
      table: "households",
      patch: { diet_preference: "vegetarian" },
      id: householdId,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/household/settings");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePathMock).toHaveBeenCalledWith("/plan");
    expect(revalidatePathMock).toHaveBeenCalledWith("/recipes");
  });

  it("allows maid to set a diet", async () => {
    let called = false;
    getCurrentHouseholdMock.mockResolvedValue(makeCtx("maid"));
    createServiceClientMock.mockReturnValue(makeSvc(() => ({
      update: () => ({
        eq: () => { called = true; return Promise.resolve({ error: null }); },
      }),
    })));
    await updateHouseholdDiet({ diet: "eggitarian" });
    expect(called).toBe(true);
  });

  it("empty string clears the override to null", async () => {
    let patch: unknown = null;
    getCurrentHouseholdMock.mockResolvedValue(makeCtx("owner"));
    createServiceClientMock.mockReturnValue(makeSvc(() => ({
      update: (p: unknown) => ({
        eq: () => { patch = p; return Promise.resolve({ error: null }); },
      }),
    })));
    await updateHouseholdDiet({ diet: "" });
    expect(patch).toEqual({ diet_preference: null });
  });

  it("omitted diet clears the override to null", async () => {
    let patch: unknown = null;
    getCurrentHouseholdMock.mockResolvedValue(makeCtx("owner"));
    createServiceClientMock.mockReturnValue(makeSvc(() => ({
      update: (p: unknown) => ({
        eq: () => { patch = p; return Promise.resolve({ error: null }); },
      }),
    })));
    await updateHouseholdDiet({});
    expect(patch).toEqual({ diet_preference: null });
  });

  it("rejects unknown diet values", async () => {
    getCurrentHouseholdMock.mockResolvedValue(makeCtx("owner"));
    await expect(updateHouseholdDiet({ diet: "carnivore" }))
      .rejects.toThrow(); // zod parse error
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `pnpm test tests/actions/household-diet.test.ts`
Expected: 6 tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/actions/household-diet.test.ts
git commit -m "test(diet): updateHouseholdDiet permissions and null-clearing"
```

---

## Task 7: Client component — `HouseholdDietForm` with stricter-than-implied confirmation

**Files:**
- Create: `src/components/household/household-diet-form.tsx`

- [ ] **Step 1: Verify the components/household directory exists**

Run: `ls src/components/household 2>/dev/null || echo "absent"`
Expected: either a directory listing or `absent`. If absent, the Write tool will create it on file create.

- [ ] **Step 2: Create the client component**

Create `src/components/household/household-diet-form.tsx`:

```tsx
"use client";

import { useRef } from "react";
import { PendingButton } from "@/components/ui/pending-button";
import type { Diet } from "@/lib/db/types";

type MemberSummary = { displayName: string; dietPreference: Diet | null };

type Props = {
  currentValue: Diet | null;
  members: MemberSummary[]; // active non-maid members only
  action: (formData: FormData) => Promise<void>;
};

// Strictness ranking — mirrors the SQL helper.
const RANK: Record<Diet, number> = {
  vegan: 3,
  vegetarian: 2,
  eggitarian: 1,
  non_vegetarian: 0,
};

// "What would the helper return if the household column were null?"
function memberImpliedDiet(members: MemberSummary[]): Diet {
  let pick: Diet = "non_vegetarian";
  let rank = -1;
  for (const m of members) {
    if (!m.dietPreference) continue;
    const r = RANK[m.dietPreference];
    if (r > rank) { rank = r; pick = m.dietPreference; }
  }
  return pick;
}

const LABEL: Record<Diet, string> = {
  vegan: "Vegan",
  vegetarian: "Vegetarian",
  eggitarian: "Eggitarian",
  non_vegetarian: "Non-vegetarian",
};

export function HouseholdDietForm({ currentValue, members, action }: Props) {
  const selectRef = useRef<HTMLSelectElement | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const chosen = selectRef.current?.value ?? "";
    if (chosen === "" || chosen === currentValue) return; // submit normally
    const chosenDiet = chosen as Diet;
    const implied = memberImpliedDiet(members);
    if (RANK[chosenDiet] <= RANK[implied]) return; // less strict — no prompt

    // Members whose own pref is less strict than the chosen value would lose
    // visibility under the new household pref.
    const affected = members.filter((m) => {
      const r = RANK[m.dietPreference ?? "non_vegetarian"];
      return r < RANK[chosenDiet];
    });
    const names = affected.slice(0, 3).map((m) => {
      const label = m.dietPreference ? LABEL[m.dietPreference].toLowerCase() : "no preference";
      return `${m.displayName} (${label})`;
    });
    const tail = affected.length > 3 ? `, and ${affected.length - 3} more` : "";
    const msg =
      `Setting household preference to ${LABEL[chosenDiet]} will hide recipes ` +
      `that ${names.join(", ")}${tail} currently see. Continue?`;
    if (!window.confirm(msg)) {
      e.preventDefault();
    }
  }

  return (
    <form action={action} onSubmit={handleSubmit} className="flex items-center gap-2">
      <select
        ref={selectRef}
        name="diet"
        defaultValue={currentValue ?? ""}
        className="rounded-md border bg-background px-2 py-1 text-sm"
        aria-label="Household meal preference"
      >
        <option value="">No household preference</option>
        <option value="vegan">Vegan</option>
        <option value="vegetarian">Vegetarian</option>
        <option value="eggitarian">Eggitarian</option>
        <option value="non_vegetarian">Non-vegetarian</option>
      </select>
      <PendingButton type="submit" size="sm" variant="outline">Save</PendingButton>
    </form>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/components/household/household-diet-form.tsx
git commit -m "feat(diet): HouseholdDietForm client component w/ confirm"
```

---

## Task 8: Settings page — Meal preference card + member override note

**Files:**
- Modify: `src/app/household/settings/page.tsx`

- [ ] **Step 1: Wire the new action import and form handler**

In `src/app/household/settings/page.tsx`, update the imports near the top:

```ts
import {
  createInvite, removeMembership,
  updateHouseholdDiet, updateMembershipDiet, updateMembershipPrivilege,
} from "@/app/household/settings/actions";
import { HouseholdDietForm } from "@/components/household/household-diet-form";
```

- [ ] **Step 2: Add a server-action shim for the household form**

Inside the `HouseholdSettingsPage` function, alongside the existing `inviteFamily`, `remove`, `changePriv`, `changeDiet` shims, add:

```ts
async function changeHouseholdDiet(formData: FormData) {
  "use server";
  await updateHouseholdDiet({ diet: String(formData.get("diet") ?? "") });
}
```

- [ ] **Step 3: Render the new Meal preference card**

Insert this card between the Notifications card (which is gated on `isOwner || isMaid`) and the Members card. The card itself is always visible, but the editable form only renders for owner or maid; family members see the value as plain text.

```tsx
<Card>
  <CardHeader><CardTitle>Meal preference</CardTitle></CardHeader>
  <CardContent className="space-y-3">
    <p className="text-sm text-muted-foreground">
      Sets what shows up in your meal plan and recipes for the whole household.
      When set, this overrides each member&apos;s personal preference for planning.
    </p>
    {isOwner || isMaid ? (
      <HouseholdDietForm
        currentValue={ctx.household.diet_preference}
        members={[...members.data!]
          .filter((m) => m.role !== "maid")
          .map((m) => {
            const p = (m as unknown as {
              profile: { display_name: string; email: string };
            }).profile;
            return {
              displayName: p.display_name || p.email,
              dietPreference: m.diet_preference,
            };
          })}
        action={changeHouseholdDiet}
      />
    ) : (
      <p className="text-sm">
        {ctx.household.diet_preference
          ? dietLabel(ctx.household.diet_preference)
          : "No household preference"}
      </p>
    )}
  </CardContent>
</Card>
```

Add this helper near the top of the file (after the imports, before `HouseholdSettingsPage`):

```ts
function dietLabel(d: import("@/lib/db/types").Diet): string {
  return { vegan: "Vegan", vegetarian: "Vegetarian",
           eggitarian: "Eggitarian", non_vegetarian: "Non-vegetarian" }[d];
}
```

- [ ] **Step 4: Add the "household preference active" note to each member row**

Inside the `<li>` for each member, modify the existing `<p className="text-xs text-muted-foreground">` line that currently reads:

```tsx
<p className="text-xs text-muted-foreground">
  <span className={cn(isMaidRow && "text-primary font-medium")}>{m.role}</span>
  {m.role === "family_member" ? ` · ${m.privilege}` : ""}
  {isMaidRow ? " · diet noted but plan ignores it" : ""}
</p>
```

Replace with:

```tsx
<p className="text-xs text-muted-foreground">
  <span className={cn(isMaidRow && "text-primary font-medium")}>{m.role}</span>
  {m.role === "family_member" ? ` · ${m.privilege}` : ""}
  {isMaidRow ? " · diet noted but plan ignores it" : ""}
  {!isMaidRow && ctx.household.diet_preference !== null
    ? " · household preference active — this is ignored for planning"
    : ""}
</p>
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 6: Manual browser smoke test**

Run: `pnpm dev`
In a browser:
1. Sign in as the household owner. Navigate to `/household/settings`.
2. Verify the new "Meal preference" card appears between Notifications and Members.
3. Pick `Vegan` from the dropdown. If you have a non-vegetarian member, expect a `window.confirm` listing their name. Cancel — page does not change. Click Save again and confirm — page reloads, dropdown reads `Vegan`, and every member row now shows the override note.
4. Pick `No household preference` → no prompt; on save, override note disappears from member rows.
5. Sign in as a family member (or temporarily change `isOwner`/`isMaid` locally) and confirm the card shows the value as read-only text with no dropdown.

Document any deviations from expected behavior here before continuing. Stop and fix if anything misbehaves.

- [ ] **Step 7: Commit**

```bash
git add src/app/household/settings/page.tsx
git commit -m "feat(diet): household meal preference card + override note"
```

---

## Task 9: Dashboard chip — show effective diet and source

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Fetch effective diet + `hasMemberPref` in the dashboard server component**

In `src/app/dashboard/page.tsx`, locate the existing `const supabase = await createClient();` line (around line 131, just before the `now`/`todayYmd` block). Add the two new lookups in parallel with `Promise.all` so they piggyback on existing IO:

```ts
const [effectiveDietRes, memberPrefCountRes] = await Promise.all([
  supabase.rpc("household_effective_diet", { p_household: ctx.household.id }),
  supabase
    .from("household_memberships")
    .select("id", { count: "exact", head: true })
    .eq("household_id", ctx.household.id)
    .eq("status", "active")
    .neq("role", "maid")
    .not("diet_preference", "is", null),
]);
const effectiveDiet = (effectiveDietRes.data ?? null) as
  import("@/lib/db/types").Diet | null;
const hasMemberPref = (memberPrefCountRes.count ?? 0) > 0;
```

- [ ] **Step 2: Compute chip rendering inputs**

Right after the block above, add:

```ts
const dietChip: { label: string; source: "household" | "members" } | null = (() => {
  if (!effectiveDiet) return null;
  if (ctx.household.diet_preference !== null) {
    return { label: dietLabel(effectiveDiet), source: "household" };
  }
  if (hasMemberPref) {
    return { label: dietLabel(effectiveDiet), source: "members" };
  }
  return null;
})();
```

Add the `dietLabel` helper near the other module-level helpers (top of the file, alongside `sgYmd`):

```ts
function dietLabel(d: import("@/lib/db/types").Diet): string {
  return { vegan: "Vegan", vegetarian: "Vegetarian",
           eggitarian: "Eggitarian", non_vegetarian: "Non-vegetarian" }[d];
}
```

- [ ] **Step 3: Render the chip at the top of the `<div className="px-4 py-6">` block**

Locate the `return ( <main className="mx-auto max-w-md"> … <div className="px-4 py-6"> …` block (around line 273). Add an `import Link from "next/link";` to the top of the file if not already present, then insert the chip as the very first child of the `px-4 py-6` div:

```tsx
{dietChip ? (
  <Link
    href="/household/settings"
    className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
  >
    Meal preference: {dietChip.label} · {dietChip.source}
  </Link>
) : null}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 5: Manual browser smoke test**

Run: `pnpm dev` (or refresh if already running).
1. Owner with no household pref and no member prefs → `/dashboard` shows no diet chip.
2. Set one family member to `vegetarian` via /household/settings → `/dashboard` shows `Meal preference: Vegetarian · members`.
3. Set household pref to `vegan` → `/dashboard` shows `Meal preference: Vegan · household`.
4. Clear household pref → chip reverts to `… · members`.
5. Click the chip → navigates to /household/settings.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat(diet): dashboard chip surfaces effective meal preference"
```

---

## Task 10: Full regression check

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: every existing test plus the new ones pass. Pay attention to anything in `tests/db/` or `tests/actions/` that may have transitively relied on `household_strictest_diet` — there should be none, but the rename would surface it here if a stray caller exists.

- [ ] **Step 2: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both pass with no new diagnostics.

- [ ] **Step 3: Manual end-to-end flow against a fresh DB**

Run: `pnpm db:reset && pnpm dev`
Walk through:
1. Sign in as owner. Visit `/recipes` → 55 recipes visible.
2. /household/settings → set household pref to `vegetarian`. Confirm prompt does not fire (no non-veg member to displace).
3. `/recipes` now shows only vegan + vegetarian.
4. `/dashboard` shows `Meal preference: Vegetarian · household`.
5. Invite a family member; have them set their own pref to `non_vegetarian`. The library still shows only vegan + vegetarian (household override wins).
6. Clear household pref. `/recipes` now widens to include non-veg; chip flips to `… · members`.

- [ ] **Step 4: Final commit (only if any incidental fixes were needed)**

If steps 1-3 surfaced anything that required a code change, commit it as a small follow-up. Otherwise no commit is needed — this is a verification task.

---

## Self-review notes

- **Spec coverage**: every requirement in [docs/specs/2026-05-16-household-meal-preference-design.md](../specs/2026-05-16-household-meal-preference-design.md) maps to a task here:
  - Schema + helper rename + `effective_recipes` rewrite → Task 1
  - Type updates → Task 2
  - Helper semantics + override behavior → Tasks 3 & 4
  - Server action + permissions → Tasks 5 & 6
  - Client form + stricter-than-implied confirmation → Task 7
  - Settings UI (card + member override note) → Task 8
  - Dashboard chip with household/members source → Task 9
  - Out-of-scope items (per-recipe escape hatch, backfill, ingredient auto-classification, Dialog upgrade) — not in any task, intentionally deferred per spec.
- **Strictness rank consistency**: SQL helper uses `vegan > vegetarian > eggitarian > non_vegetarian` via `bool_or` cascade; client `RANK` mirrors with `vegan=3, vegetarian=2, eggitarian=1, non_vegetarian=0`. Same comparison semantics.
- **Naming**: `updateHouseholdDiet` (action), `HouseholdDietForm` (component), `household_effective_diet` (RPC), `ctx.household.diet_preference` (column accessor) — consistent across all tasks.
- **No placeholders, no `TBD`, no "similar to Task N" handwaves**: every code block is complete.
