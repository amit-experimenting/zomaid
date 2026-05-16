# Task setup wizard + household mode (maid vs. family-run)

> **Superseded as the living architecture doc for the dashboard area by [`features/dashboard.md`](features/dashboard.md).** This dated spec is retained for historical context.

> **Superseded as the living architecture doc for the tasks area by [`features/tasks.md`](features/tasks.md).** This dated spec is retained for historical context.

> **Superseded as the living architecture doc for the household area by [`features/household.md`](features/household.md).** This dated spec is retained for historical context.

> **Superseded as the living architecture doc for the onboarding area by [`features/onboarding.md`](features/onboarding.md).** This dated spec is retained for historical context.

- **Date:** 2026-05-16
- **Status:** Brainstorming → pending implementation plan
- **Owner:** dharni05@gmail.com
- **Depends on:** [2026-05-11 Slice 5 — Tasks + Reminders + Web Push](./2026-05-11-slice-5-tasks-reminders-push-design.md), [2026-05-11 Owner-invite-maid on Home](./2026-05-11-owner-invite-maid-on-home-design.md)

## 1. Problem

Two related issues on the Home page (`/dashboard`) for a freshly onboarded household:

1. **Tasks auto-seed on day one.** The 14 standard chores from [`20260603_001_standard_tasks_seed.sql`](../../supabase/migrations/20260603_001_standard_tasks_seed.sql) materialize into `task_occurrences` for every household the moment they exist, via [`tasks_generate_occurrences`](../../supabase/migrations/20260602_001_standard_tasks.sql#L115). A brand-new household lands on Home with "Buy groceries from wet market or NTUC", "Water indoor plants", etc. already showing as **pending / overdue** — chores they never picked, with no frequency or assignee tuning, no idea who's supposed to do them.

2. **The Home card assumes a maid.** [`OwnerInviteMaidCard`](../../src/components/site/owner-invite-maid-card.tsx) always asks the owner to invite a maid. Some households don't have one — they're run by the owner + family. There's no path to declare that, and no model for it.

## 2. Goals / non-goals

**Goals**
- Owner declares household mode on first visit: either invite a maid, or **family-run**.
- Tasks do **not** appear on Home until the owner has gone through a two-stage setup wizard that lets them pick which standards apply and tune frequency + assignee per task.
- Each household ends up owning its own copy of the picked tasks — so editing later uses the existing `/tasks/[id]/edit` UI, no new edit surface.
- Existing households are reset so we can test the new flow end-to-end (no real users in production yet).

**Non-goals (v1)**
- A "re-run task setup" affordance in `/household/settings` (edit individual tasks instead).
- Editing task notes inside the wizard (use `/tasks/[id]/edit`).
- Round-robin / suggested auto-assignment across multiple family members.
- Letting family members run setup (gated to owner — matches existing task-write permissions).
- Mid-wizard "Skip" or "do this later" escape hatch — the prompt is sticky until setup is finished.

## 3. Decisions log

| Q | Decision |
|---|---|
| Label for "no maid" mode | UI: **"Family-run"**. DB enum value: `family_run`. |
| Skip path on the task-setup prompt | **No Skip.** The Home day-view stays empty (just the prompt card) until the wizard finishes. |
| Per-household customisation model | **Clone on finish.** Picked standards are copied into household-owned `tasks` rows with the chosen recurrence + assignee. All 14 standards are then hidden for the household. |
| Existing households | **Force-reset.** Migration wipes household-owned tasks + occurrences + hides, sets both gates back to "unset/null". Everyone goes through the new flow. |
| Wizard layout | **Two URLs** (`/onboarding/tasks` → `/onboarding/tasks/tune`) so back-button + bookmarking are natural. |
| Mode transitions | Generating a maid invite OR a maid joining → `maid_mode = 'invited'`. "Family-run" button → `'family_run'`. A maid joining a family-run household auto-flips back to `'invited'`. |

## 4. Domain model

### 4.1 New enum

```sql
create type maid_mode as enum ('unset', 'invited', 'family_run');
```

### 4.2 `households` — two new columns

```
households
  ...existing columns...
  maid_mode                  maid_mode    not null default 'unset'
  task_setup_completed_at    timestamptz  null
```

No RLS changes required — both columns are scoped by the existing household read/update policies. Owners can update both via server actions; the actions enforce role checks.

### 4.3 No changes to `tasks`, `task_occurrences`, `household_task_hides` schemas

But behaviour changes (see §5).

## 5. Behaviour changes to existing pieces

### 5.1 `tasks_generate_occurrences` — gate on `task_setup_completed_at`

The function currently iterates every household with active memberships. After this change, it skips households whose `task_setup_completed_at IS NULL`. One-line filter inside the outer loop:

```sql
for v_household in
  select hm.household_id
  from public.household_memberships hm
  join public.households h on h.id = hm.household_id
  where hm.status = 'active'
    and h.task_setup_completed_at is not null
  group by hm.household_id
loop
  ...
end loop;
```

The nightly cron is unaffected — it just no-ops for ungated households.

### 5.2 `inviteMaidFromHome` and `createInvite` (for maid role)

Both now also UPDATE `households.maid_mode = 'invited'` if it was `'unset'`. Already-invited or family-run modes are untouched (the family-run → invited flip happens automatically only when a maid actually joins; see §5.3).

### 5.3 Maid join hook

When a `household_memberships` row is inserted with `role = 'maid'` and `status = 'active'`, ensure `households.maid_mode = 'invited'`. Implemented as a trigger so the existing invite-redemption code at [`src/app/join/...`](../../src/app/join/) doesn't need to know about the new column.

```sql
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

## 6. Migration / backfill

**This is destructive and intentional** — there are no real users yet, and we want every household (including the developer's own) to walk through the new flow.

Order of operations:

1. `create type maid_mode as enum (...)`.
2. `alter table public.households add column maid_mode maid_mode not null default 'unset', add column task_setup_completed_at timestamptz null`.
3. `delete from public.task_occurrences;` — wipes all materialized occurrences.
4. `delete from public.household_task_hides;` — wipes all hides.
5. `delete from public.tasks where household_id is not null;` — wipes household-owned tasks; standards (NULL household_id) are kept.
6. Replace `tasks_generate_occurrences` with the gated version (§5.1).
7. Create the join-side trigger (§5.3).

After this migration, every household has `maid_mode = 'unset'` + `task_setup_completed_at = null` → the new Home flow surfaces for everyone on next visit.

## 7. Home (`/dashboard`) flow

The owner branch on [`src/app/dashboard/page.tsx`](../../src/app/dashboard/page.tsx) now resolves to one of:

| State | Condition | What renders |
|---|---|---|
| **A. Mode prompt** | `maid_mode = 'unset'` | One card titled "How does your household run?" with two CTAs: **Invite your maid** (triggers existing `inviteMaidFromHome`) and **We're family-run** (triggers new `setHouseholdFamilyRun`). |
| **B. Maid pending invite** | `maid_mode = 'invited'` and an active pending maid invite exists | Existing State B of `OwnerInviteMaidCard` (code + link + Revoke). |
| **C. Maid joined** | `maid_mode = 'invited'` and active maid membership exists | Existing State C of `OwnerInviteMaidCard` ("Maid: <name>" + Manage). |
| **D. Mode set, tasks not yet set up** | `maid_mode != 'unset'` AND `task_setup_completed_at IS NULL` | New `TaskSetupPromptCard`: title "Set up your tasks", body "Pick what applies to your home and decide who does what.", single CTA **Set up tasks →** linking to `/onboarding/tasks`. No Skip. |
| **E. Both gates closed** | both columns set | Existing day-view (occurrences + meal plan). |

Cards A/B/C are mutually exclusive (they're branches of the same slot). Card D stacks below whichever of A/B/C currently shows: once `maid_mode` is set, D appears alongside B/C until setup is done.

The inventory prompt card and the day-view are gated as follows:
- **Inventory prompt** — unchanged from today (independent setup path).
- **Day-view occurrence fetch** — when `task_setup_completed_at IS NULL`, skip the `tasks_generate_occurrences` RPC and the occurrence query entirely; render the meal feed only, and show a small placeholder where the task list would be ("Tasks will show here once you finish setup").

For non-owner roles (maid, family_member), unchanged: they see the day-view as-is. The setup prompts are owner-only.

## 8. The wizard

Two routes under `/onboarding/tasks/`:

### 8.1 Stage 1 — `/onboarding/tasks` (Pick)

Server component. Loads all 14 standard tasks (`tasks where household_id is null and archived_at is null order by created_at`). Renders a checkbox list:

- Top row: **"Select all"** master toggle.
- Each row: checkbox · title · small subtitle showing the standard's default ("Daily, 9:00 am", "Twice weekly · Tue, Fri 10:00 am", "Monthly · day 15, 10:00 am", etc.).
- "Next →" button — disabled if zero picks. Submits a server action that stashes the picks in a server-side draft (see §8.3) and redirects to stage 2.

### 8.2 Stage 2 — `/onboarding/tasks/tune` (Tune)

Server component. Loads the draft (§8.3). For each picked task, render an editable row:

- **Title** (read-only label).
- **Frequency**: segmented control Daily / Weekly / Monthly, defaulted from the standard.
- **Interval**: `every [N] {days|weeks|months}` stepper.
- **Weekly only**: 7-chip day-of-week picker; default from the standard's `recurrence_byweekday`.
- **Monthly only**: day-of-month number input (1–31); default from the standard's `recurrence_bymonthday`.
- **Due time** picker; default from the standard's `due_time`.
- **Assignee** dropdown:
  - "Me (owner)"
  - Each active family member by `display_name || email`
  - **Maid** — only listed when `maid_mode = 'invited'`. Resolves to the active maid's profile if joined, otherwise to a placeholder that the action validates ("invite must be redeemed before assigning to maid" — surfaced inline; the field defaults to "Anyone" until then).
  - "Anyone" (default if the standard had no `assigned_to_profile_id`)

Bottom: **Back** (preserves draft → returns to stage 1) and **Finish** (commits, see §8.4).

### 8.3 Draft storage

A new table `task_setup_drafts` keyed by `household_id`:

```
task_setup_drafts
  household_id        uuid primary key references households(id) on delete cascade
  picked_task_ids     uuid[] not null
  tuned_json          jsonb null      -- per-task overrides accumulated in stage 2 (kept across Back/Next)
  updated_at          timestamptz not null default now()
```

RLS: read/write requires `is_active_owner_or_maid(household_id)` (owner only in practice — but maid+owner is fine; the wizard itself is owner-gated at the route level).

This avoids hauling state through URL params and survives accidental refresh. The draft row is deleted on Finish.

### 8.4 Finish — `submitTaskSetup` server action

Input: an array of per-task entries `{ standardTaskId, frequency, interval, byweekday?, bymonthday?, dueTime, assigneeProfileId | 'anyone' }`.

Effect (all in one DB transaction via a `security definer` RPC if Supabase requires it; otherwise multi-statement service-client transaction):

1. Owner check; `maid_mode != 'unset'` check.
2. Validate every entry against the same Zod-shaped rules as `createTask` from slice 5.
3. For each entry: `insert into tasks (household_id, title, notes, assigned_to_profile_id, recurrence_*, due_time, created_by_profile_id) values (...)` — copying `title` + `notes` from the standard; recurrence + assignee from the entry.
4. `insert into household_task_hides (household_id, task_id) select v_household, id from tasks where household_id is null on conflict do nothing` — hides **all 14** standards for this household (not just the picked ones), so the standards never seed occurrences for this household.
5. `update households set task_setup_completed_at = now() where id = v_household`.
6. `delete from task_setup_drafts where household_id = v_household`.
7. `select tasks_generate_occurrences(current_date + 7)` — materialise today/this week immediately.
8. `revalidatePath('/dashboard')` then `redirect('/dashboard')`.

## 9. New server actions

| Action | Effect |
|---|---|
| `setHouseholdFamilyRun()` | Owner only. Sets `households.maid_mode = 'family_run'` if currently `'unset'`. Reval `/dashboard`. |
| `saveTaskSetupPicks({ standardTaskIds })` | Owner only. Upserts `task_setup_drafts` with picks; redirects to `/onboarding/tasks/tune`. |
| `submitTaskSetup({ entries })` | See §8.4. |

`inviteMaidFromHome` already exists — add a single UPDATE to flip `maid_mode` from `'unset'` to `'invited'` inside its existing transaction (or as a follow-up query — it's idempotent).

## 10. New error codes

```
HOUSEHOLD_MODE_ALREADY_SET             -- setHouseholdFamilyRun called when mode != 'unset'
TASK_SETUP_NOT_READY                   -- submitTaskSetup called while maid_mode = 'unset'
TASK_SETUP_DRAFT_MISSING               -- stage 2 loaded without a draft row
TASK_SETUP_PICK_EMPTY                  -- submitTaskSetup with zero entries
TASK_SETUP_INVALID_ASSIGNEE            -- assignee profile is not an active member, or 'maid' chosen without an active maid
```

## 11. Files touched

| Path | Change |
|---|---|
| `supabase/migrations/20260703_001_household_setup_gates.sql` | **New.** Enum, columns, destructive backfill, gated `tasks_generate_occurrences`, maid-join trigger, `task_setup_drafts` table + RLS. |
| [src/app/dashboard/page.tsx](../../src/app/dashboard/page.tsx) | Branch on `maid_mode` + `task_setup_completed_at`. Skip occurrence fetch when ungated. Render mode prompt / task prompt as appropriate. |
| [src/components/site/owner-invite-maid-card.tsx](../../src/components/site/owner-invite-maid-card.tsx) | Add `'unset'` branch (two-CTA "How does your household run?"). State B/C unchanged. |
| `src/components/site/task-setup-prompt-card.tsx` | **New.** Sticky "Set up your tasks" card. |
| `src/app/onboarding/tasks/page.tsx` | **New.** Stage 1 picker (server component + a small `"use client"` form for checkbox state). |
| `src/app/onboarding/tasks/tune/page.tsx` | **New.** Stage 2 configure (server component + per-row client form). |
| `src/app/onboarding/tasks/actions.ts` | **New.** `saveTaskSetupPicks`, `submitTaskSetup`. |
| [src/app/dashboard/actions.ts](../../src/app/dashboard/actions.ts) | Add `setHouseholdFamilyRun`. `inviteMaidFromHome` also flips `maid_mode`. |
| [src/app/household/settings/actions.ts](../../src/app/household/settings/actions.ts) | `createInvite` for `role = 'maid'` also flips `maid_mode` (covers the settings-page invite path). |
| `src/lib/db/types.ts` (or wherever generated) | Regenerate to pick up `maid_mode`, `task_setup_completed_at`, `task_setup_drafts`. |
| Wherever `requireHousehold` / household context lives | Add the two new columns to the returned household shape so pages can read them without an extra query. |

## 12. Edge cases

- **Owner generates a maid invite, then never asks the maid to join.** `maid_mode = 'invited'` from the invite-generation moment, so the task setup prompt appears immediately. The assignee dropdown shows "Maid (pending)" as a selectable option, but the stored `assigned_to_profile_id` is `null` (= "Anyone") until a real maid profile exists. When the maid joins, owner edits affected tasks at `/tasks/[id]/edit` to point at them. (`TASK_SETUP_INVALID_ASSIGNEE` only fires if the client somehow submits a profile_id that isn't an active member.)
- **Owner clicks "Family-run", then later invites a maid via Settings.** `createInvite` flips `maid_mode = 'invited'`. The maid-join trigger keeps it consistent. Existing household-owned tasks keep their assignees; owner can edit them.
- **Owner closes the tab mid-wizard.** Draft row persists. Next visit lands them back on the Home card with the "Set up tasks →" CTA, which routes to stage 1 (re-pick) — but the draft is preserved so checkboxes are pre-ticked. (Implementation note: stage 1 reads `task_setup_drafts.picked_task_ids` to seed initial state.)
- **Owner picks zero tasks then clicks Finish.** Blocked at the form level (Finish disabled if no picks); also enforced server-side (`TASK_SETUP_PICK_EMPTY`).
- **Owner picks tasks but doesn't tune; just clicks Finish.** Defaults from the standards are used. Acceptable.
- **Concurrent owner sessions** (rare but possible — laptop + phone). Last-write-wins on `task_setup_drafts`; the Finish action's `task_setup_completed_at IS NULL` check ensures only one Finish actually applies. The other session's Finish becomes a no-op with a redirect.
- **Family member or maid hits `/onboarding/tasks` directly.** Route gate redirects to `/dashboard` (only owners run setup).
- **Owner tries to invite a maid via the Home card while `maid_mode = 'family_run'`.** Don't surface the option there; they have to go to `/household/settings` and explicitly invite — which flips the mode.

## 13. Testing strategy

Same shape as slice 5 — DB + actions + a Playwright stub.

- **DB-level**:
  - `tasks_generate_occurrences` is a no-op for ungated households.
  - Maid-join trigger flips `maid_mode` correctly.
  - `household_task_hides` insertion in `submitTaskSetup` covers all 14 standards.
  - RLS on `task_setup_drafts` rejects cross-household access.
- **Action-level**:
  - `setHouseholdFamilyRun` happy path + `HOUSEHOLD_MODE_ALREADY_SET`.
  - `submitTaskSetup` clones standards correctly, sets the timestamp, generates occurrences.
  - `submitTaskSetup` validates assignee membership.
- **E2E (Playwright stub, marked `test.skip`)**:
  - Fresh owner sees mode prompt → picks "Family-run" → sees task prompt → completes wizard → sees occurrences on Home.
  - Fresh owner picks "Invite your maid" → sees pending-invite card + task prompt → completes wizard with assignee = "Maid (pending)" → maid joins via separate browser → owner refreshes → assignment shows maid name (after manual edit).

Per the project's standing "we'll come back to tests" guidance, ship test tasks as separate steps that can be deferred.

## 14. Out of scope (v2 candidates)

- A "Reset task setup" button in `/household/settings` that wipes household-owned tasks + clears `task_setup_completed_at`.
- A "Re-tune assignees" bulk editor (currently you edit one task at a time at `/tasks/[id]/edit`).
- Wizard variants for family members and maid (e.g., maid suggesting tasks to owner for approval).
- Smart defaults for stage 2 (e.g., auto-distribute tasks across family members).
- Localisation of the standard task list.

## 15. Open questions

None at design time. The destructive backfill is intentional and confirmed.
