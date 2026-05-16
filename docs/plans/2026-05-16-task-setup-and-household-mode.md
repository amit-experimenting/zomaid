# Task setup wizard + household mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop fresh households from auto-seeding the 14 standard chores. Add a household-mode choice (Invite-maid vs. Family-run) and a two-stage task setup wizard. Gate `tasks_generate_occurrences` behind a per-household setup-completion flag.

**Architecture:** Two new columns on `households` (`maid_mode` enum, `task_setup_completed_at`). One destructive migration that wipes existing household-owned tasks/occurrences/hides so all households walk the new flow. `tasks_generate_occurrences` becomes a no-op for ungated households. A two-URL wizard at `/onboarding/tasks` (pick) → `/onboarding/tasks/tune` (configure) clones picked standards into household-owned `tasks` rows with per-task frequency + assignee.

**Tech Stack:** Next.js 16 server components + server actions, Supabase PG with RLS, Clerk auth, Tailwind + shadcn UI, Zod validation.

**Reference:** [docs/specs/2026-05-16-task-setup-and-household-mode-design.md](../specs/2026-05-16-task-setup-and-household-mode-design.md)

---

## Task 1: Database migration — schema + destructive backfill + gated cron + trigger

**Files:**
- Create: `supabase/migrations/20260705_001_household_setup_gates.sql`

- [ ] **Step 1: Write the migration SQL**

Create the file with this exact content:

```sql
-- 2026-05-16 — Task setup gates + family-run household mode.
-- Adds maid_mode enum + two flag columns on households. Gates
-- tasks_generate_occurrences behind task_setup_completed_at. Resets every
-- household so the new wizard runs (no real users yet — intentional).

-- 1. Enum + columns ----------------------------------------------------------

create type public.maid_mode as enum ('unset', 'invited', 'family_run');

alter table public.households
  add column maid_mode               public.maid_mode not null default 'unset',
  add column task_setup_completed_at timestamptz null;

-- 2. task_setup_drafts -------------------------------------------------------
--    One row per household captures wizard-in-progress state so a refresh
--    or Back/Next round-trip doesn't lose picks/tunings.

create table public.task_setup_drafts (
  household_id     uuid primary key references public.households(id) on delete cascade,
  picked_task_ids  uuid[] not null default array[]::uuid[],
  tuned_json       jsonb null,
  updated_at       timestamptz not null default now()
);

alter table public.task_setup_drafts enable row level security;

create policy task_setup_drafts_read on public.task_setup_drafts
  for select to authenticated
  using (public.is_active_owner_or_maid(household_id));

create policy task_setup_drafts_write on public.task_setup_drafts
  for all to authenticated
  using (public.is_active_owner_or_maid(household_id))
  with check (public.is_active_owner_or_maid(household_id));

-- 3. Destructive reset -------------------------------------------------------
--    No real users yet. Wipe so the new gated flow surfaces for every
--    household on next visit. Standards (household_id IS NULL) are kept.

delete from public.task_occurrences;
delete from public.household_task_hides;
delete from public.tasks where household_id is not null;

-- All existing households are now back at the gate: maid_mode='unset'
-- (default), task_setup_completed_at IS NULL (default).

-- 4. Gated tasks_generate_occurrences ---------------------------------------
--    Skip households whose task_setup_completed_at IS NULL. Otherwise
--    identical to the previous version.

create or replace function public.tasks_generate_occurrences(p_horizon_date date)
  returns int
  language plpgsql security definer
  set search_path = public
  as $$
  declare
    v_inserted int := 0;
    v_household uuid;
    v_task     record;
    v_day      date;
    v_matches  boolean;
  begin
    for v_household in
      select hm.household_id
      from public.household_memberships hm
      join public.households h on h.id = hm.household_id
      where hm.status = 'active'
        and h.task_setup_completed_at is not null
      group by hm.household_id
    loop
      for v_task in
        select * from public.tasks t
        where archived_at is null
          and recurrence_starts_on <= p_horizon_date
          and (recurrence_ends_on is null or recurrence_ends_on >= current_date)
          and (
            t.household_id = v_household
            or (
              t.household_id is null
              and not exists (
                select 1 from public.household_task_hides h
                where h.household_id = v_household
                  and h.task_id = t.id
              )
            )
          )
      loop
        for v_day in
          select generate_series(
            greatest(v_task.recurrence_starts_on, current_date),
            least(p_horizon_date, coalesce(v_task.recurrence_ends_on, p_horizon_date)),
            '1 day'::interval
          )::date
        loop
          v_matches := false;

          if v_task.recurrence_frequency = 'daily' then
            v_matches := ((v_day - v_task.recurrence_starts_on) % v_task.recurrence_interval) = 0;

          elsif v_task.recurrence_frequency = 'weekly' then
            v_matches :=
              extract(dow from v_day)::int = any(v_task.recurrence_byweekday)
              and (((date_trunc('week', v_day)::date - date_trunc('week', v_task.recurrence_starts_on)::date) / 7)
                   % v_task.recurrence_interval) = 0;

          elsif v_task.recurrence_frequency = 'monthly' then
            v_matches :=
              extract(day from v_day)::int = v_task.recurrence_bymonthday
              and (
                (extract(year from v_day)::int * 12 + extract(month from v_day)::int)
                - (extract(year from v_task.recurrence_starts_on)::int * 12
                   + extract(month from v_task.recurrence_starts_on)::int)
              ) % v_task.recurrence_interval = 0;
          end if;

          if v_matches then
            insert into public.task_occurrences (household_id, task_id, due_at)
            values (v_household, v_task.id, (v_day + v_task.due_time) at time zone 'Asia/Singapore')
            on conflict (household_id, task_id, due_at) do nothing;

            if found then
              v_inserted := v_inserted + 1;
            end if;
          end if;
        end loop;
      end loop;
    end loop;

    return v_inserted;
  end;
  $$;

-- 5. Maid-join trigger -------------------------------------------------------
--    When an active maid membership appears, ensure maid_mode = 'invited'.
--    Covers both invite-redemption (INSERT) and reactivation (UPDATE).

create or replace function public.households_sync_maid_mode_on_join()
  returns trigger language plpgsql security definer
  set search_path = public
  as $$
  begin
    if new.role = 'maid' and new.status = 'active' then
      update public.households
        set maid_mode = 'invited'
        where id = new.household_id
          and maid_mode <> 'invited';
    end if;
    return new;
  end;
  $$;

create trigger household_memberships_sync_maid_mode
  after insert or update on public.household_memberships
  for each row execute function public.households_sync_maid_mode_on_join();
```

- [ ] **Step 2: Apply the migration locally**

Run:
```bash
pnpm run db:reset
```
Expected: completes without errors, recreates DB from all migrations including the new one.

- [ ] **Step 3: Spot-check via psql**

Run:
```bash
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2 | tr -d '\"')" -c "select id, maid_mode, task_setup_completed_at from public.households limit 5;"
```
Expected: every row shows `maid_mode = unset` and `task_setup_completed_at = NULL`.

If the `supabase status` form differs in this repo, fall back to:
```bash
psql postgresql://postgres:postgres@localhost:54322/postgres -c "select id, maid_mode, task_setup_completed_at from public.households limit 5;"
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260705_001_household_setup_gates.sql
git commit -m "$(cat <<'EOF'
feat(tasks): add maid_mode + task_setup_completed_at gates

Adds maid_mode enum (unset/invited/family_run) and
task_setup_completed_at on households. Gates
tasks_generate_occurrences so ungated households no longer auto-seed
the 14 standard chores. Destructive backfill: wipes household-owned
tasks/occurrences/hides so every household walks the new wizard.
Trigger keeps maid_mode in sync when a maid joins.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Update hand-curated DB types

**Files:**
- Modify: `src/lib/db/types.ts`

- [ ] **Step 1: Read the existing households Row type**

Open [src/lib/db/types.ts](../../src/lib/db/types.ts) and locate the `households:` Tables entry (it begins around line 32 per grep). Note its existing shape: `Row`, `Insert`, `Update`, `Relationships`.

- [ ] **Step 2: Add the `MaidMode` exported type at the top**

Find the existing top-level type exports (`Role`, `Privilege`, `MembershipStatus`, …). After `export type Diet = ...;`, add:

```ts
export type MaidMode = "unset" | "invited" | "family_run";
```

- [ ] **Step 3: Add the two new fields to `households.Row`**

Inside `households: { Row: { ... } }`, add two fields adjacent to the existing `inventory_card_dismissed_at` (or anywhere in the Row body — keep grouped with other flag/timestamp columns):

```ts
maid_mode: MaidMode;
task_setup_completed_at: string | null;
```

Mirror them in `Insert` (both optional) and `Update` (both optional) — match how `inventory_card_dismissed_at` is declared in the same shape.

- [ ] **Step 4: Add the `task_setup_drafts` table type**

Inside `Tables: { ... }`, add a new entry. Place it after `household_task_hides` (or alphabetically near it):

```ts
task_setup_drafts: {
  Row: {
    household_id: string;
    picked_task_ids: string[];
    tuned_json: unknown | null;
    updated_at: string;
  };
  Insert: {
    household_id: string;
    picked_task_ids?: string[];
    tuned_json?: unknown | null;
    updated_at?: string;
  };
  Update: {
    household_id?: string;
    picked_task_ids?: string[];
    tuned_json?: unknown | null;
    updated_at?: string;
  };
  Relationships: [];
};
```

- [ ] **Step 5: Typecheck**

Run:
```bash
pnpm run typecheck
```
Expected: zero errors. (Any errors mean the type addition broke something — fix before continuing.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/types.ts
git commit -m "$(cat <<'EOF'
chore(types): add maid_mode + task_setup_drafts to hand-curated Database

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Flip `maid_mode` when a maid invite is generated from Home

**Files:**
- Modify: `src/app/dashboard/actions.ts`

- [ ] **Step 1: Add the maid_mode flip to `inviteMaidFromHome`**

Open [src/app/dashboard/actions.ts](../../src/app/dashboard/actions.ts). At the very end of `inviteMaidFromHome` (just before `revalidatePath("/dashboard");` lines), after both the idempotency-reuse branch and the `createInvite` call, ensure `households.maid_mode` is `'invited'`. Easiest: do one extra update after either branch.

Replace the function body so it looks like this:

```ts
export async function inviteMaidFromHome() {
  const ctx = await getCurrentHousehold();
  if (!ctx) throw new Error("no active household");
  if (ctx.membership.role !== "owner") throw new Error("only the owner can invite a maid");

  const svc = createServiceClient();

  // Flip household into 'invited' mode if it isn't already. Idempotent.
  if (ctx.household.maid_mode !== "invited") {
    const upd = await svc
      .from("households")
      .update({ maid_mode: "invited" })
      .eq("id", ctx.household.id);
    if (upd.error) throw new Error(upd.error.message);
  }

  // Idempotency: if a pending maid invite already exists for this household,
  // reuse it instead of creating a second one (defends against double-tap).
  const existing = await svc
    .from("invites")
    .select("id, code, token")
    .eq("household_id", ctx.household.id)
    .eq("intended_role", "maid")
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.length) {
    revalidatePath("/dashboard");
    return { code: existing.data[0].code, token: existing.data[0].token };
  }

  const created = await createInvite({ role: "maid" });
  revalidatePath("/dashboard");
  return created;
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
pnpm run typecheck
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/actions.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): flip maid_mode to invited when generating maid invite

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add `setHouseholdFamilyRun` server action

**Files:**
- Modify: `src/app/dashboard/actions.ts`

- [ ] **Step 1: Append the action**

At the bottom of [src/app/dashboard/actions.ts](../../src/app/dashboard/actions.ts), add:

```ts
export async function setHouseholdFamilyRun() {
  const ctx = await getCurrentHousehold();
  if (!ctx) throw new Error("no active household");
  if (ctx.membership.role !== "owner") throw new Error("only the owner can set household mode");
  if (ctx.household.maid_mode !== "unset") throw new Error("household mode already set");

  const svc = createServiceClient();
  const upd = await svc
    .from("households")
    .update({ maid_mode: "family_run" })
    .eq("id", ctx.household.id);
  if (upd.error) throw new Error(upd.error.message);

  revalidatePath("/dashboard");
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
pnpm run typecheck
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/actions.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): add setHouseholdFamilyRun action

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Flip `maid_mode` from `/household/settings` maid invites too

**Files:**
- Modify: `src/app/household/settings/actions.ts`

- [ ] **Step 1: Insert the flip**

Open [src/app/household/settings/actions.ts](../../src/app/household/settings/actions.ts). Find the maid-role guard (lines 37-47):

```ts
  if (data.role === "maid") {
    const has = await svc
      .from("household_memberships")
      .select("id")
      .eq("household_id", household.id)
      .eq("role", "maid")
      .eq("status", "active")
      .limit(1);
    if (has.error) throw new Error(has.error.message);
    if (has.data?.length) throw new Error("household already has an active maid");
  }
```

Replace it with:

```ts
  if (data.role === "maid") {
    const has = await svc
      .from("household_memberships")
      .select("id")
      .eq("household_id", household.id)
      .eq("role", "maid")
      .eq("status", "active")
      .limit(1);
    if (has.error) throw new Error(has.error.message);
    if (has.data?.length) throw new Error("household already has an active maid");

    // Generating a maid invite commits the household to the "have a maid" path.
    if (household.maid_mode !== "invited") {
      const flip = await svc
        .from("households")
        .update({ maid_mode: "invited" })
        .eq("id", household.id);
      if (flip.error) throw new Error(flip.error.message);
    }
  }
```

(`svc`, `household`, and `data` are already in scope at this point — no new imports needed.)

- [ ] **Step 2: Typecheck**

Run:
```bash
pnpm run typecheck
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/household/settings/actions.ts
git commit -m "$(cat <<'EOF'
feat(settings): flip maid_mode to invited on maid invite creation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wizard server actions (`saveTaskSetupPicks`, `submitTaskSetup`)

**Files:**
- Create: `src/app/onboarding/tasks/actions.ts`

- [ ] **Step 1: Create the actions file**

Create [src/app/onboarding/tasks/actions.ts](../../src/app/onboarding/tasks/actions.ts) with:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentHousehold } from "@/lib/auth/current-household";
import { createServiceClient } from "@/lib/supabase/server";

// --- Stage 1: save picks --------------------------------------------------

const savePicksSchema = z.object({
  standardTaskIds: z.array(z.string().uuid()).min(1),
});

export async function saveTaskSetupPicks(input: unknown) {
  const data = savePicksSchema.parse(input);
  const ctx = await getCurrentHousehold();
  if (!ctx) throw new Error("no active household");
  if (ctx.membership.role !== "owner") throw new Error("only the owner can run task setup");
  if (ctx.household.maid_mode === "unset") throw new Error("set household mode first");
  if (ctx.household.task_setup_completed_at !== null) throw new Error("task setup already completed");

  // Validate every picked id is in fact a current standard task.
  const svc = createServiceClient();
  const standards = await svc
    .from("tasks")
    .select("id")
    .is("household_id", null)
    .is("archived_at", null);
  if (standards.error) throw new Error(standards.error.message);
  const validIds = new Set(standards.data.map((r) => r.id));
  const bad = data.standardTaskIds.filter((id) => !validIds.has(id));
  if (bad.length > 0) throw new Error("unknown standard task id");

  const upsert = await svc
    .from("task_setup_drafts")
    .upsert(
      {
        household_id: ctx.household.id,
        picked_task_ids: data.standardTaskIds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "household_id" },
    );
  if (upsert.error) throw new Error(upsert.error.message);

  redirect("/onboarding/tasks/tune");
}

// --- Stage 2: submit final setup ------------------------------------------

const entrySchema = z
  .object({
    standardTaskId: z.string().uuid(),
    frequency: z.enum(["daily", "weekly", "monthly"]),
    interval: z.coerce.number().int().min(1).max(60),
    byweekday: z.array(z.coerce.number().int().min(0).max(6)).optional(),
    bymonthday: z.coerce.number().int().min(1).max(31).optional(),
    dueTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
    assigneeProfileId: z.union([z.string().uuid(), z.literal("anyone")]),
  })
  .refine(
    (v) =>
      (v.frequency === "weekly" && !!v.byweekday && v.byweekday.length > 0) ||
      v.frequency !== "weekly",
    { message: "weekly requires byweekday" },
  )
  .refine(
    (v) => (v.frequency === "monthly" && typeof v.bymonthday === "number") || v.frequency !== "monthly",
    { message: "monthly requires bymonthday" },
  );

const submitSchema = z.object({
  entries: z.array(entrySchema).min(1),
});

export async function submitTaskSetup(input: unknown) {
  const data = submitSchema.parse(input);
  const ctx = await getCurrentHousehold();
  if (!ctx) throw new Error("no active household");
  if (ctx.membership.role !== "owner") throw new Error("only the owner can run task setup");
  if (ctx.household.maid_mode === "unset") throw new Error("set household mode first");
  if (ctx.household.task_setup_completed_at !== null) {
    // Already done in another tab; treat as no-op + redirect.
    redirect("/dashboard");
  }

  const svc = createServiceClient();

  // Validate assignees are active members of this household.
  const assigneeIds = Array.from(
    new Set(
      data.entries
        .map((e) => e.assigneeProfileId)
        .filter((v): v is string => v !== "anyone"),
    ),
  );
  if (assigneeIds.length > 0) {
    const mem = await svc
      .from("household_memberships")
      .select("profile_id")
      .eq("household_id", ctx.household.id)
      .eq("status", "active")
      .in("profile_id", assigneeIds);
    if (mem.error) throw new Error(mem.error.message);
    const memberSet = new Set(mem.data.map((r) => r.profile_id));
    const missing = assigneeIds.filter((id) => !memberSet.has(id));
    if (missing.length > 0) throw new Error("assignee is not an active member");
  }

  // Load picked standards' title + notes.
  const standardIds = Array.from(new Set(data.entries.map((e) => e.standardTaskId)));
  const stdRes = await svc
    .from("tasks")
    .select("id, title, notes")
    .is("household_id", null)
    .in("id", standardIds);
  if (stdRes.error) throw new Error(stdRes.error.message);
  const stdById = new Map(stdRes.data.map((r) => [r.id, r]));
  for (const id of standardIds) {
    if (!stdById.has(id)) throw new Error("unknown standard task id");
  }

  // Insert household-owned cloned tasks.
  const inserts = data.entries.map((e) => {
    const std = stdById.get(e.standardTaskId)!;
    return {
      household_id: ctx.household.id,
      title: std.title,
      notes: std.notes ?? null,
      assigned_to_profile_id: e.assigneeProfileId === "anyone" ? null : e.assigneeProfileId,
      recurrence_frequency: e.frequency,
      recurrence_interval: e.interval,
      recurrence_byweekday: e.frequency === "weekly" ? (e.byweekday ?? null) : null,
      recurrence_bymonthday: e.frequency === "monthly" ? (e.bymonthday ?? null) : null,
      due_time: e.dueTime.length === 5 ? `${e.dueTime}:00` : e.dueTime,
      created_by_profile_id: ctx.profile.id,
      recurrence_starts_on: new Date().toISOString().slice(0, 10),
    };
  });
  const insRes = await svc.from("tasks").insert(inserts);
  if (insRes.error) throw new Error(insRes.error.message);

  // Hide ALL standards for this household (so even un-picked standards
  // never seed occurrences).
  const allStd = await svc.from("tasks").select("id").is("household_id", null).is("archived_at", null);
  if (allStd.error) throw new Error(allStd.error.message);
  const hideRows = allStd.data.map((r) => ({
    household_id: ctx.household.id,
    task_id: r.id,
    hidden_by_profile_id: ctx.profile.id,
  }));
  if (hideRows.length > 0) {
    const hideRes = await svc
      .from("household_task_hides")
      .upsert(hideRows, { onConflict: "household_id,task_id" });
    if (hideRes.error) throw new Error(hideRes.error.message);
  }

  // Close the gate.
  const finRes = await svc
    .from("households")
    .update({ task_setup_completed_at: new Date().toISOString() })
    .eq("id", ctx.household.id);
  if (finRes.error) throw new Error(finRes.error.message);

  // Drop the draft.
  await svc.from("task_setup_drafts").delete().eq("household_id", ctx.household.id);

  // Materialise today/this week so Home is non-empty on next render.
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 7);
  const horizonYmd = horizon.toISOString().slice(0, 10);
  await svc.rpc("tasks_generate_occurrences", { p_horizon_date: horizonYmd });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
pnpm run typecheck
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/onboarding/tasks/actions.ts
git commit -m "$(cat <<'EOF'
feat(tasks-setup): saveTaskSetupPicks + submitTaskSetup actions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

> **Design note (not a task):** `OwnerInviteMaidCard` is intentionally untouched — it keeps handling only `empty | pending | joined`. The `'unset'` state (mode choice) is a different concern, owned by the new `HouseholdModeCard` below.

## Task 7: New `HouseholdModeCard` component (unset state)

**Files:**
- Create: `src/components/site/household-mode-card.tsx`

- [ ] **Step 1: Create the component**

Create [src/components/site/household-mode-card.tsx](../../src/components/site/household-mode-card.tsx) with:

```tsx
"use client";

import { useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { inviteMaidFromHome, setHouseholdFamilyRun } from "@/app/dashboard/actions";

export function HouseholdModeCard() {
  const [pendingInvite, startInvite] = useTransition();
  const [pendingFamily, startFamily] = useTransition();
  const busy = pendingInvite || pendingFamily;

  return (
    <Card>
      <CardHeader>
        <CardTitle>How does your household run?</CardTitle>
        <CardDescription>
          Pick one. You can change this later in Household Settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 sm:flex-row">
        <Button
          className="flex-1"
          disabled={busy}
          onClick={() => startInvite(async () => { await inviteMaidFromHome(); })}
        >
          Invite your maid
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          disabled={busy}
          onClick={() => startFamily(async () => { await setHouseholdFamilyRun(); })}
        >
          We're family-run
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
pnpm run typecheck
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/site/household-mode-card.tsx
git commit -m "$(cat <<'EOF'
feat(home): HouseholdModeCard for the unset maid_mode state

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: New `TaskSetupPromptCard` component

**Files:**
- Create: `src/components/site/task-setup-prompt-card.tsx`

- [ ] **Step 1: Create the component**

Create [src/components/site/task-setup-prompt-card.tsx](../../src/components/site/task-setup-prompt-card.tsx) with:

```tsx
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TaskSetupPromptCard() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div>
          <div className="text-sm font-semibold">Set up your tasks</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Pick what applies to your home and decide who does what.
          </div>
        </div>
        <div>
          <Link
            href="/onboarding/tasks"
            className={cn(buttonVariants({ size: "sm" }))}
          >
            Set up tasks →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
```

Server component — no interactivity needed (the click is a navigation).

- [ ] **Step 2: Typecheck**

Run:
```bash
pnpm run typecheck
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/site/task-setup-prompt-card.tsx
git commit -m "$(cat <<'EOF'
feat(home): TaskSetupPromptCard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Wizard stage 1 — `/onboarding/tasks` (pick)

**Files:**
- Create: `src/app/onboarding/tasks/page.tsx`
- Create: `src/app/onboarding/tasks/pick-form.tsx`

- [ ] **Step 1: Create the page (server component)**

Create [src/app/onboarding/tasks/page.tsx](../../src/app/onboarding/tasks/page.tsx) with:

```tsx
import { redirect } from "next/navigation";
import { requireHousehold } from "@/lib/auth/require";
import { createServiceClient } from "@/lib/supabase/server";
import { PickForm } from "./pick-form";

export const dynamic = "force-dynamic";

export default async function OnboardingTasksPickPage() {
  const ctx = await requireHousehold();
  if (ctx.membership.role !== "owner") redirect("/dashboard");
  if (ctx.household.maid_mode === "unset") redirect("/dashboard");
  if (ctx.household.task_setup_completed_at !== null) redirect("/dashboard");

  const svc = createServiceClient();

  const standardsRes = await svc
    .from("tasks")
    .select(
      "id, title, recurrence_frequency, recurrence_interval, recurrence_byweekday, recurrence_bymonthday, due_time",
    )
    .is("household_id", null)
    .is("archived_at", null)
    .order("recurrence_frequency", { ascending: true })
    .order("title", { ascending: true });
  if (standardsRes.error) throw new Error(standardsRes.error.message);

  const draftRes = await svc
    .from("task_setup_drafts")
    .select("picked_task_ids")
    .eq("household_id", ctx.household.id)
    .maybeSingle();
  if (draftRes.error && draftRes.error.code !== "PGRST116") {
    throw new Error(draftRes.error.message);
  }
  const initialPicks = draftRes.data?.picked_task_ids ?? [];

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <h1 className="text-xl font-semibold tracking-tight">Set up your tasks</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Step 1 of 2 — pick the chores that apply to your home.
      </p>
      <div className="mt-6">
        <PickForm standards={standardsRes.data ?? []} initialPicks={initialPicks} />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Create the client form**

Create [src/app/onboarding/tasks/pick-form.tsx](../../src/app/onboarding/tasks/pick-form.tsx) with:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { saveTaskSetupPicks } from "./actions";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Standard = {
  id: string;
  title: string;
  recurrence_frequency: "daily" | "weekly" | "monthly";
  recurrence_interval: number;
  recurrence_byweekday: number[] | null;
  recurrence_bymonthday: number | null;
  due_time: string;
};

function summarise(s: Standard): string {
  const time = s.due_time.slice(0, 5);
  if (s.recurrence_frequency === "daily") {
    if (s.recurrence_interval === 1) return `Daily · ${time}`;
    return `Every ${s.recurrence_interval} days · ${time}`;
  }
  if (s.recurrence_frequency === "weekly") {
    const days = (s.recurrence_byweekday ?? [])
      .map((d) => WEEKDAY_SHORT[d])
      .join(", ");
    const prefix = s.recurrence_interval === 1 ? "Weekly" : `Every ${s.recurrence_interval} weeks`;
    return `${prefix} · ${days} ${time}`;
  }
  const prefix = s.recurrence_interval === 1 ? "Monthly" : `Every ${s.recurrence_interval} months`;
  return `${prefix} · day ${s.recurrence_bymonthday} ${time}`;
}

export function PickForm({
  standards,
  initialPicks,
}: {
  standards: Standard[];
  initialPicks: string[];
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(initialPicks));
  const [pending, start] = useTransition();
  const allSelected = standards.length > 0 && picked.size === standards.length;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () => {
    if (allSelected) setPicked(new Set());
    else setPicked(new Set(standards.map((s) => s.id)));
  };

  const onNext = () => {
    if (picked.size === 0) return;
    start(async () => {
      await saveTaskSetupPicks({ standardTaskIds: Array.from(picked) });
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          className="h-4 w-4"
        />
        <span className="font-medium">Select all</span>
      </label>
      <ul className="divide-y rounded-md border">
        {standards.map((s) => (
          <li key={s.id} className="px-3 py-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={picked.has(s.id)}
                onChange={() => toggle(s.id)}
                className="mt-0.5 h-4 w-4"
              />
              <span className="flex-1">
                <span className="block text-sm font-medium">{s.title}</span>
                <span className="block text-xs text-muted-foreground">{summarise(s)}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between pt-2">
        <span className="text-xs text-muted-foreground">{picked.size} selected</span>
        <Button onClick={onNext} disabled={pending || picked.size === 0}>
          Next →
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run:
```bash
pnpm run typecheck
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/onboarding/tasks/page.tsx src/app/onboarding/tasks/pick-form.tsx
git commit -m "$(cat <<'EOF'
feat(tasks-setup): wizard stage 1 picker

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wizard stage 2 — `/onboarding/tasks/tune` (configure)

**Files:**
- Create: `src/app/onboarding/tasks/tune/page.tsx`
- Create: `src/app/onboarding/tasks/tune/tune-form.tsx`

- [ ] **Step 1: Create the page (server component)**

Create [src/app/onboarding/tasks/tune/page.tsx](../../src/app/onboarding/tasks/tune/page.tsx) with:

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireHousehold } from "@/lib/auth/require";
import { createServiceClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TuneForm, type StandardForTune, type AssigneeOption } from "./tune-form";

export const dynamic = "force-dynamic";

export default async function OnboardingTasksTunePage() {
  const ctx = await requireHousehold();
  if (ctx.membership.role !== "owner") redirect("/dashboard");
  if (ctx.household.maid_mode === "unset") redirect("/dashboard");
  if (ctx.household.task_setup_completed_at !== null) redirect("/dashboard");

  const svc = createServiceClient();

  const draft = await svc
    .from("task_setup_drafts")
    .select("picked_task_ids")
    .eq("household_id", ctx.household.id)
    .maybeSingle();
  if (draft.error && draft.error.code !== "PGRST116") throw new Error(draft.error.message);
  const picks = draft.data?.picked_task_ids ?? [];
  if (picks.length === 0) redirect("/onboarding/tasks");

  const standardsRes = await svc
    .from("tasks")
    .select(
      "id, title, recurrence_frequency, recurrence_interval, recurrence_byweekday, recurrence_bymonthday, due_time, assigned_to_profile_id",
    )
    .is("household_id", null)
    .in("id", picks);
  if (standardsRes.error) throw new Error(standardsRes.error.message);
  const standards = (standardsRes.data ?? []) as StandardForTune[];

  // Roster (active members) for the assignee dropdown.
  const memRes = await svc
    .from("household_memberships")
    .select("profile_id, role, profile:profiles(display_name, email)")
    .eq("household_id", ctx.household.id)
    .eq("status", "active");
  if (memRes.error) throw new Error(memRes.error.message);

  type Row = {
    profile_id: string;
    role: "owner" | "family_member" | "maid";
    profile: { display_name: string | null; email: string } | { display_name: string | null; email: string }[] | null;
  };
  const rows = (memRes.data ?? []) as unknown as Row[];

  const ownerSelf: AssigneeOption | null = (() => {
    const me = rows.find((r) => r.profile_id === ctx.profile.id);
    if (!me) return null;
    return { value: ctx.profile.id, label: "Me (owner)" };
  })();
  const family: AssigneeOption[] = rows
    .filter((r) => r.role === "family_member")
    .map((r) => {
      const p = Array.isArray(r.profile) ? r.profile[0] : r.profile;
      return { value: r.profile_id, label: p?.display_name || p?.email || "Family member" };
    });
  const maidRow = rows.find((r) => r.role === "maid");
  const maid: AssigneeOption | null = (() => {
    if (ctx.household.maid_mode !== "invited") return null;
    if (maidRow) {
      const p = Array.isArray(maidRow.profile) ? maidRow.profile[0] : maidRow.profile;
      return { value: maidRow.profile_id, label: `Maid (${p?.display_name || p?.email || "joined"})` };
    }
    return { value: "anyone", label: "Maid (pending — assigned to Anyone)" };
  })();

  const assignees: AssigneeOption[] = [
    ...(ownerSelf ? [ownerSelf] : []),
    ...family,
    ...(maid ? [maid] : []),
    { value: "anyone", label: "Anyone" },
  ];

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Tune your tasks</h1>
        <Link
          href="/onboarding/tasks"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          ← Back
        </Link>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Step 2 of 2 — set how often, what time, and who does each.
      </p>
      <TuneForm standards={standards} assignees={assignees} />
    </main>
  );
}
```

- [ ] **Step 2: Create the client form**

Create [src/app/onboarding/tasks/tune/tune-form.tsx](../../src/app/onboarding/tasks/tune/tune-form.tsx) with:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { submitTaskSetup } from "../actions";

export type StandardForTune = {
  id: string;
  title: string;
  recurrence_frequency: "daily" | "weekly" | "monthly";
  recurrence_interval: number;
  recurrence_byweekday: number[] | null;
  recurrence_bymonthday: number | null;
  due_time: string;
  assigned_to_profile_id: string | null;
};

export type AssigneeOption = { value: string; label: string };

type Entry = {
  standardTaskId: string;
  frequency: "daily" | "weekly" | "monthly";
  interval: number;
  byweekday: number[];
  bymonthday: number;
  dueTime: string;
  assigneeProfileId: string;
};

const WEEKDAYS: { value: number; short: string }[] = [
  { value: 0, short: "S" },
  { value: 1, short: "M" },
  { value: 2, short: "T" },
  { value: 3, short: "W" },
  { value: 4, short: "T" },
  { value: 5, short: "F" },
  { value: 6, short: "S" },
];

function initialEntry(s: StandardForTune): Entry {
  return {
    standardTaskId: s.id,
    frequency: s.recurrence_frequency,
    interval: s.recurrence_interval,
    byweekday: s.recurrence_byweekday ?? [],
    bymonthday: s.recurrence_bymonthday ?? 1,
    dueTime: s.due_time.slice(0, 5),
    assigneeProfileId: "anyone",
  };
}

export function TuneForm({
  standards,
  assignees,
}: {
  standards: StandardForTune[];
  assignees: AssigneeOption[];
}) {
  const [entries, setEntries] = useState<Entry[]>(() => standards.map(initialEntry));
  const [pending, start] = useTransition();

  const update = (idx: number, patch: Partial<Entry>) =>
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));

  const onFinish = () => {
    start(async () => {
      await submitTaskSetup({
        entries: entries.map((e) => ({
          standardTaskId: e.standardTaskId,
          frequency: e.frequency,
          interval: e.interval,
          byweekday: e.frequency === "weekly" ? e.byweekday : undefined,
          bymonthday: e.frequency === "monthly" ? e.bymonthday : undefined,
          dueTime: e.dueTime,
          assigneeProfileId: e.assigneeProfileId,
        })),
      });
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {standards.map((s, idx) => {
        const e = entries[idx];
        return (
          <div key={s.id} className="rounded-md border p-3">
            <div className="text-sm font-medium">{s.title}</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Frequency</span>
                <select
                  className="rounded-md border px-2 py-1 text-sm"
                  value={e.frequency}
                  onChange={(ev) => update(idx, { frequency: ev.target.value as Entry["frequency"] })}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Every</span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  className="rounded-md border px-2 py-1 text-sm"
                  value={e.interval}
                  onChange={(ev) => update(idx, { interval: Math.max(1, Number(ev.target.value) || 1) })}
                />
              </label>
            </div>
            {e.frequency === "weekly" && (
              <div className="mt-3 flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Days</span>
                <div className="flex gap-1">
                  {WEEKDAYS.map((d) => {
                    const on = e.byweekday.includes(d.value);
                    return (
                      <button
                        key={d.value}
                        type="button"
                        className={
                          "h-8 w-8 rounded-md border text-xs " +
                          (on ? "bg-foreground text-background" : "bg-background")
                        }
                        onClick={() => {
                          const next = on
                            ? e.byweekday.filter((v) => v !== d.value)
                            : [...e.byweekday, d.value].sort();
                          update(idx, { byweekday: next });
                        }}
                      >
                        {d.short}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {e.frequency === "monthly" && (
              <label className="mt-3 flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Day of month</span>
                <input
                  type="number"
                  min={1}
                  max={31}
                  className="rounded-md border px-2 py-1 text-sm"
                  value={e.bymonthday}
                  onChange={(ev) => update(idx, { bymonthday: Math.min(31, Math.max(1, Number(ev.target.value) || 1)) })}
                />
              </label>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Time</span>
                <input
                  type="time"
                  className="rounded-md border px-2 py-1 text-sm"
                  value={e.dueTime}
                  onChange={(ev) => update(idx, { dueTime: ev.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">Who</span>
                <select
                  className="rounded-md border px-2 py-1 text-sm"
                  value={e.assigneeProfileId}
                  onChange={(ev) => update(idx, { assigneeProfileId: ev.target.value })}
                >
                  {assignees.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        );
      })}
      <div className="flex justify-end pt-2">
        <Button onClick={onFinish} disabled={pending}>
          Finish →
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run:
```bash
pnpm run typecheck
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/onboarding/tasks/tune/page.tsx src/app/onboarding/tasks/tune/tune-form.tsx
git commit -m "$(cat <<'EOF'
feat(tasks-setup): wizard stage 2 tuner

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Gate the dashboard on the new flags

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Replace the entire file**

Overwrite [src/app/dashboard/page.tsx](../../src/app/dashboard/page.tsx) with the content below. This preserves the existing day-view + meal-fetch logic verbatim — the only changes are the two new imports, the three computed gate bools, the maid-path guard on the owner-card resolver, the `if (setupCompleted)` wrapper around the fetch, and the two new card slots in the JSX.

```tsx
import { requireHousehold } from "@/lib/auth/require";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";
import { MainNav } from "@/components/site/main-nav";
import { OwnerInviteMaidCard } from "@/components/site/owner-invite-maid-card";
import { HouseholdModeCard } from "@/components/site/household-mode-card";
import { TaskSetupPromptCard } from "@/components/site/task-setup-prompt-card";
import { InventoryPromptCard } from "@/components/site/inventory-prompt-card";
import { DayView, type MealFeedItem } from "@/components/dashboard/day-view";
import type { OccurrenceRowItem } from "@/components/tasks/occurrence-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const TZ = "Asia/Singapore";
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function sgYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function resolveSelectedYmd(raw: string | undefined, todayYmd: string): string {
  if (!raw || !YMD_RE.test(raw)) return todayYmd;
  const probe = new Date(`${raw}T12:00:00+08:00`);
  if (Number.isNaN(probe.getTime()) || sgYmd(probe) !== raw) return todayYmd;
  return raw;
}

type OwnerCardProps =
  | { state: "empty" }
  | { state: "pending"; origin: string; code: string; token: string; inviteId: string }
  | { state: "joined"; maidName: string };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const ctx = await requireHousehold();
  const origin = await siteUrl();
  const sp = await searchParams;

  // Gates introduced by 2026-05-16 task-setup design.
  const setupCompleted = ctx.household.task_setup_completed_at !== null;
  const showHouseholdModeCard =
    ctx.membership.role === "owner" && ctx.household.maid_mode === "unset";
  const showTaskSetupPromptCard =
    ctx.membership.role === "owner" &&
    ctx.household.maid_mode !== "unset" &&
    !setupCompleted;

  // --- onboarding cards (gated) ------------------------------------------

  let pendingOwnerInviteToken: string | null = null;
  if (ctx.membership.role === "maid") {
    const supabase = await createClient();
    const r = await supabase
      .from("invites")
      .select("token")
      .eq("household_id", ctx.household.id)
      .eq("intended_role", "owner")
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if (r.error) throw new Error(r.error.message);
    pendingOwnerInviteToken = r.data?.[0]?.token ?? null;
  }

  let ownerCard: OwnerCardProps | null = null;
  if (ctx.membership.role === "owner" && ctx.household.maid_mode !== "unset") {
    const svc = createServiceClient();
    const supabase = await createClient();
    const [maidRes, inviteRes] = await Promise.all([
      svc
        .from("household_memberships")
        .select("id, profile:profiles(display_name, email)")
        .eq("household_id", ctx.household.id)
        .eq("role", "maid")
        .eq("status", "active")
        .limit(1),
      supabase
        .from("invites")
        .select("id, code, token")
        .eq("household_id", ctx.household.id)
        .eq("intended_role", "maid")
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    if (maidRes.error) throw new Error(maidRes.error.message);
    if (inviteRes.error) throw new Error(inviteRes.error.message);

    const maidRow = (maidRes.data?.[0] as unknown as
      | { id: string; profile: { display_name: string; email: string } | null }
      | undefined);
    if (maidRow?.profile) {
      ownerCard = { state: "joined", maidName: maidRow.profile.display_name || maidRow.profile.email };
    } else if (inviteRes.data?.length) {
      const inv = inviteRes.data[0];
      ownerCard = { state: "pending", origin, code: inv.code, token: inv.token, inviteId: inv.id };
    } else {
      ownerCard = { state: "empty" };
    }
  }

  let showInventoryCard = false;
  if (ctx.membership.role === "owner" || ctx.membership.role === "maid") {
    const supabase = await createClient();
    const { count } = await supabase
      .from("inventory_items")
      .select("id", { count: "exact", head: true })
      .eq("household_id", ctx.household.id);
    showInventoryCard =
      ctx.household.inventory_card_dismissed_at == null && (count ?? 0) < 5;
  }

  // --- Day view fetch (gated on task_setup_completed_at) -----------------

  const supabase = await createClient();
  const now = new Date();
  const todayYmd = sgYmd(now);
  const yesterdayYmd = sgYmd(addDays(now, -1));
  const selectedYmd = resolveSelectedYmd(sp?.date, todayYmd);
  const isToday = selectedYmd === todayYmd;

  const isOwnerOrMaid =
    ctx.membership.role === "owner" || ctx.membership.role === "maid";
  const canAddTasks = isOwnerOrMaid || ctx.membership.role === "family_member";
  const taskActionsEnabled = isOwnerOrMaid;

  const overdue: OccurrenceRowItem[] = [];
  const onDay: OccurrenceRowItem[] = [];
  const meals: MealFeedItem[] = [];

  if (setupCompleted) {
    const horizonDate = addDays(new Date(`${selectedYmd}T12:00:00+08:00`), 1);
    await supabase.rpc("tasks_generate_occurrences", {
      p_horizon_date: sgYmd(horizonDate),
    });

    const targetStart = new Date(`${selectedYmd}T00:00:00+08:00`);
    const targetEnd = new Date(`${selectedYmd}T00:00:00+08:00`);
    targetEnd.setDate(targetEnd.getDate() + 1);
    const leftEdge = isToday ? new Date("1970-01-01T00:00:00Z") : targetStart;

    const [
      { data: occRows },
      { data: rawMealRows },
      { data: mealTimes },
      { count: rosterCount },
    ] = await Promise.all([
      supabase
        .from("task_occurrences")
        .select(
          "id, due_at, status, household_id, tasks!inner(id, title, household_id, assigned_to_profile_id, profiles!assigned_to_profile_id(display_name))",
        )
        .eq("household_id", ctx.household.id)
        .gte("due_at", leftEdge.toISOString())
        .lt("due_at", targetEnd.toISOString())
        .order("due_at", { ascending: true }),
      supabase
        .from("meal_plans")
        .select(
          "slot, recipe_id, people_eating, recipes(name, kcal_per_serving, carbs_g_per_serving, fat_g_per_serving, protein_g_per_serving)",
        )
        .eq("household_id", ctx.household.id)
        .eq("plan_date", selectedYmd),
      supabase
        .from("household_meal_times")
        .select("slot,meal_time")
        .eq("household_id", ctx.household.id),
      supabase
        .from("household_memberships")
        .select("id", { count: "exact", head: true })
        .eq("household_id", ctx.household.id)
        .eq("status", "active"),
    ]);

    type OccRow = {
      id: string;
      due_at: string;
      status: "pending" | "done" | "skipped";
      tasks: {
        id: string;
        title: string;
        household_id: string | null;
        profiles: { display_name: string } | { display_name: string }[] | null;
      };
    };
    const all = ((occRows ?? []) as unknown) as OccRow[];

    const toItem = (r: OccRow): OccurrenceRowItem => ({
      occurrenceId: r.id,
      taskId: r.tasks.id,
      title: r.tasks.title,
      dueAt: r.due_at,
      assigneeName: Array.isArray(r.tasks.profiles)
        ? (r.tasks.profiles[0]?.display_name ?? null)
        : (r.tasks.profiles?.display_name ?? null),
      status: r.status,
      isStandard: r.tasks.household_id === null,
    });

    for (const r of all) {
      const item = toItem(r);
      const itemYmd = sgYmd(new Date(item.dueAt));
      if (itemYmd === selectedYmd) {
        onDay.push(item);
        continue;
      }
      if (isToday && item.status === "pending" && itemYmd < yesterdayYmd) {
        overdue.push(item);
      }
    }

    const sortItems = (xs: OccurrenceRowItem[]) =>
      xs.sort((a, b) => {
        const da = new Date(a.dueAt).getTime();
        const db = new Date(b.dueAt).getTime();
        if (da !== db) return da - db;
        return a.title.localeCompare(b.title);
      });
    sortItems(overdue);
    sortItems(onDay);

    const timeBySlot = Object.fromEntries((mealTimes ?? []).map((r) => [r.slot, r.meal_time]));
    const rosterSize = rosterCount ?? 1;
    type Slot = MealFeedItem["slot"];
    for (const r of rawMealRows ?? []) {
      if (!r.recipe_id) continue;
      const t = timeBySlot[r.slot];
      if (!t) continue;
      type RecipeShape = {
        name: string;
        kcal_per_serving: number | string | null;
        carbs_g_per_serving: number | string | null;
        fat_g_per_serving: number | string | null;
        protein_g_per_serving: number | string | null;
      };
      const recipeRaw = r.recipes as unknown as RecipeShape | RecipeShape[] | null;
      const recipe = Array.isArray(recipeRaw) ? recipeRaw[0] ?? null : recipeRaw;
      if (!recipe?.name) continue;
      const [hh, mm] = (t as string).split(":").map(Number);
      const iso = `${selectedYmd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+08:00`;
      const num = (v: number | string | null) => (v == null ? null : Number(v));
      meals.push({
        slot: r.slot as Slot,
        recipeName: recipe.name,
        slotTimeIso: iso,
        kcalPerServing: num(recipe.kcal_per_serving),
        carbsGPerServing: num(recipe.carbs_g_per_serving),
        fatGPerServing: num(recipe.fat_g_per_serving),
        proteinGPerServing: num(recipe.protein_g_per_serving),
        peopleEating: r.people_eating ?? rosterSize,
      });
    }
  }

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="home" />
      <div className="px-4 py-6">
        {pendingOwnerInviteToken ? (
          <Card>
            <CardHeader>
              <CardTitle>Share this link with your owner</CardTitle>
              <CardDescription>One-time link, expires in 7 days.</CardDescription>
            </CardHeader>
            <CardContent>
              <code className="block break-all rounded-md bg-muted p-3 text-xs">
                {`${origin}/join/${pendingOwnerInviteToken}`}
              </code>
            </CardContent>
          </Card>
        ) : null}

        {showHouseholdModeCard ? <HouseholdModeCard /> : null}
        {ownerCard ? <OwnerInviteMaidCard {...ownerCard} /> : null}
        {showTaskSetupPromptCard ? <TaskSetupPromptCard /> : null}

        {showInventoryCard && <InventoryPromptCard />}

        <DayView
          selectedYmd={selectedYmd}
          todayYmd={todayYmd}
          overdue={overdue}
          tasks={onDay}
          meals={meals}
          taskActionsEnabled={taskActionsEnabled}
          canAddTasks={canAddTasks}
        />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
pnpm run typecheck
```
Expected: zero errors.

- [ ] **Step 3: Smoke run the dev server**

Run:
```bash
pnpm run dev
```
Open http://localhost:3000/dashboard as a logged-in owner. Expected:
- No tasks/meals in the day-view area.
- `HouseholdModeCard` shows ("How does your household run?").
- Inventory prompt may also show.

Stop the dev server (Ctrl-C) once verified.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "$(cat <<'EOF'
feat(home): gate dashboard on maid_mode + task_setup_completed_at

When maid_mode='unset' the owner sees HouseholdModeCard. When mode is
set but task setup hasn't run, the owner sees TaskSetupPromptCard. The
day-view occurrence + meal fetch is skipped entirely until setup
completes, so fresh households no longer show seeded chores.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Manual smoke walkthrough

**Files:** none (verification only).

- [ ] **Step 1: Start fresh DB**

```bash
pnpm run db:reset
pnpm run dev
```

- [ ] **Step 2: Sign in as the existing owner**

Navigate to http://localhost:3000/dashboard.

Expected: `HouseholdModeCard` shows two buttons; no tasks, no meals.

- [ ] **Step 3: Click "We're family-run"**

Expected: page reloads; `HouseholdModeCard` disappears, `TaskSetupPromptCard` appears ("Set up your tasks"); still no task rows.

- [ ] **Step 4: Click "Set up tasks →"**

Expected: lands on `/onboarding/tasks` with the 14 standards listed + checkboxes. "Next →" is disabled.

- [ ] **Step 5: Pick a couple of tasks, click Next**

Expected: navigates to `/onboarding/tasks/tune` with each picked task as an editable card. The assignee dropdown shows "Me (owner)" and "Anyone" only (no "Maid" entry — family-run mode).

- [ ] **Step 6: Click Back**

Expected: returns to `/onboarding/tasks` with the previous picks pre-ticked (loaded from draft).

- [ ] **Step 7: Click Next again, then Finish**

Expected: redirects to `/dashboard`. The setup card is gone; the day-view now shows the picked tasks for today (assuming any are scheduled for today's date / interval).

- [ ] **Step 8: Reset DB and repeat with the maid path**

```bash
pnpm run db:reset
```
Sign in as owner again, click **Invite your maid** instead. Expected: invite card appears with code/link AND the `TaskSetupPromptCard` stacks below it. Step through the wizard; assignee dropdown now shows "Maid (pending — assigned to Anyone)" as an option.

- [ ] **Step 9: Sanity-check the cron gate**

In a separate terminal, with the dev DB still running:
```bash
psql postgresql://postgres:postgres@localhost:54322/postgres -c "select count(*) from public.task_occurrences;"
psql postgresql://postgres:postgres@localhost:54322/postgres -c "select tasks_generate_occurrences((current_date + 7)::date);"
psql postgresql://postgres:postgres@localhost:54322/postgres -c "select count(*) from public.task_occurrences;"
```
Expected: after manually invoking the RPC, the count only grows by occurrences belonging to households where setup has completed. A reset household (the one used in Step 8 — assuming you didn't complete its wizard) should contribute zero.

- [ ] **Step 10: Note any issues**

If anything misbehaves, do not commit a fix into this plan's commit history — open a follow-up task. Otherwise no commit is needed (this task is verification only).

---

## Out of scope (deferred — DO NOT implement)

- "Re-run task setup" entry in `/household/settings`.
- Bulk re-assignee editor.
- Wizard for non-owner roles.
- Automated vitest/Playwright tests for the new flow (per project's "we'll come back to tests" convention — the spec's §13 notes test stubs go in a follow-up plan).
