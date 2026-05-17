# Onboarding Redesign — Household Profile + Task Library v2

- **Date:** 2026-05-17
- **Status:** Draft (pending implementation)
- **Branch:** Lands on `design-system-foundation` (bundled with slice A so both ship as one branch). Uses Banner, IconButton, TopAppBar, and other primitives from that slice.
- **Brainstorm artifacts:** [`./2026-05-17-onboarding-redesign/brainstorm/`](./2026-05-17-onboarding-redesign/brainstorm/)

## Why this spec exists

Today's task setup is a thin pick-and-tune flow over **13 universal standard tasks** — sweep, dishes, trash, bedsheets. There's no way to express household specifics, no filtering for relevance, and the picker shows the same list to every household regardless of whether they have a dog, infant, balcony, or A/C unit. The maid sees an empty "Tasks coming soon" banner while the owner is the only one who can drive setup.

This spec replaces all of that:
1. A short **household profile questionnaire** (5 questions) captures the shape of the home.
2. The standard task library expands from 13 to **~95 tasks** with relevance tags.
3. The picker **soft-filters** by profile — matched tasks shown by default; "Show more" reveals the rest.
4. **Either owner or maid** can drive the whole task-setup flow.
5. All existing households get **wiped and re-onboarded** (no real users yet; same pattern as the 2026-07-05 setup-gates migration).

## Goals

- Replace the 13-task universal library with ~95 tagged tasks across daily/every-N/weekly/bi-weekly/monthly + pet/child/elderly conditionals.
- Add a `household_profiles` table that stores the 5-question profile and serves as the filter source for the picker.
- Add a 2-page onboarding flow (`/onboarding/profile` → `/onboarding/tasks`) usable by either owner or maid.
- Soft-filter the picker: profile-matched tasks shown by default, "Show 57 more" expand reveals unmatched.
- Auto-sort the picker by frequency (daily → every-N → weekly → bi-weekly → monthly) and within each by day/time.
- Replace the dashboard's task-setup prompt cards (drop the role gate, drop the `task-setup-waiting-card` entirely).
- Add an edit-anytime path via `/household/settings` that reuses the same questionnaire page in update mode.
- Wipe + re-seed migration leaves no stale state.

## Non-goals (deferred — see [follow-ups](./2026-05-17-onboarding-redesign/follow-ups.md))

- Tune step in onboarding (dropped — pre-seeded times serve as defaults; edit later via existing `/tasks/edit/[id]`).
- AI-generated task suggestions (out of scope; could be a future "(d)" follow-on per the brainstorm).
- "Something else" freeform text input on questionnaire options (V1 uses closed enums only).
- Multi-time-per-day task rollup in schema (V1 uses 3 separate task rows for tasks that fire 3× daily).
- i18n / translated profile questions and task titles (slice D in the design-system follow-ups).
- Persona-tailored maid dashboard (slice B from design-system follow-ups).
- Concurrent-edit conflict resolution on shared task settings (V1 treats writes as last-write-wins).

## Decision log

Each decision below was made during the 2026-05-17 brainstorm. Mockups in [`brainstorm/`](./2026-05-17-onboarding-redesign/brainstorm/).

### D1 — What do questionnaire answers do?

- **Options:** a (data-only) · b (pre-select defaults) · c (hide-filter) · d (AI-generated suggestions).
- **Chosen:** **c (hide-filter).**
- **Why:** User explicitly wants the answers to materially shape what's visible. (a) is plumbing without payload. (d) is a separate product effort. (b) compromises between (a) and (c) but the user wanted the stronger signal.

### D2 — Filter strictness

- **Options:** a (hard filter, all required) · b (soft filter, all required, "Show more" escape) · c (soft filter, each question skippable).
- **Chosen:** **b (soft filter, all required).**
- **Why:** Hard filter creates false-negative pain (the "goldfish" problem). Skip lets disengaged users defeat the feature. Soft + required forces commitment but preserves discoverability via "Show more".
- **Constraint:** 5-8 questions max per the user.

### D3 — Who fills the questionnaire?

- **Options:** a (owner-only) · b (owner fills, both view) · c (either role can fill, first-come-first-write).
- **Chosen:** **c (either role).**
- **Why:** Maid is a first-class participant. Aligns with the empty-maid-dashboard friction observed during slice A testing.

### D4 — Does the rest of task setup extend to either-role?

- **Options:** a (only questionnaire is either-role) · b (whole task setup either-role) · c (b + ongoing equal edit rights).
- **Chosen:** **b (whole task setup either-role).**
- **Why:** (a) is incoherent — empowering maid for one step then locking her out is jarring. (c) requires concurrent-edit infrastructure that's a separate effort.

### D5 — Library reconciliation

- **Options:** a (build infra, expand library separately) · b (expand library as part of this spec) · c (different question set tuned to current library).
- **Chosen:** **b (expand as part of this spec).**
- **Why:** Without library expansion, the questionnaire has nothing to filter and feels pointless. User provided the ~95-task list directly.
- **Note:** The user-provided task list is the authoritative seed input. I'll exercise judgment on multi-time-per-day rollup (3 separate rows per the schema), monthly "Nth week" → specific day mapping, and minor consolidations for clarity.

### D6 — Question set

- **Options:** a (your original 8 — 3 strong filters + 4 store-only + 1 medium) · b (trim to 5 high-signal demographics) · c (4 demographic + 4 home features, all filter).
- **Chosen:** **c.** Then consolidated during Section 3 to **5 questions** (4 boolean home-feature questions collapsed into one multi-select).
- **Why:** All answers actively filter the new library. Consolidation keeps storage shape (4 boolean columns) but trims UI surface.

### D7 — Wizard shape

- **Options:** a (1 question per screen) · b (single scrolling form) · c (inline on picker page).
- **Chosen:** **b for questionnaire + c for picker** (hybrid).
- **Why:** Questionnaire fits on one scrolling page (5 questions, no per-question screens needed); picker gets a profile-summary chip at top with "Edit" link rather than a separate launch modal.

### D8 — Tune step + pre-existing households

- **Options for tune:** a (keep) · b (drop, edit later) · c (inline edit on picker).
- **Options for pre-existing:** x (wipe + re-run) · y (keep tasks, optional profile fill).
- **Chosen:** **b + x.** Drop tune step; wipe pre-existing households.
- **Why:** Pre-seeded times are good enough as defaults. Wipe matches the 2026-07-05 reset pattern and avoids weird half-state. The codebase comment from that migration ("no real users yet — intentional") still applies.

### D9 — Schema

- **Options for answers:** a (dedicated `household_profiles` table) · b (columns on `households`) · c (single jsonb).
- **Options for tags:** x (`text[]` on tasks) · y (join table) · z (jsonb).
- **Chosen:** **a + x.**
- **Why:** Separate table keeps household-meta and household-profile concerns isolated, supports the new either-role RLS cleanly, and exposes NULL semantics for "not filled yet". `text[]` with GIN index is the canonical Postgres array idiom; namespaced tag strings (`pets:dog`, `feature:balcony`) read self-documenting.

## Data model

### New table — `household_profiles`

```sql
create table public.household_profiles (
  household_id      uuid primary key references public.households(id) on delete cascade,

  -- Demographics
  age_groups        text[] not null check (
    cardinality(age_groups) >= 1  -- NOT array_length(): that returns NULL for '{}' and CHECK passes silently
    and age_groups <@ array['infants','school_age','teens','adults','seniors']
  ),
  pets              text not null check (pets in ('none','dog','cat','other','multiple')),
  work_hours        text not null check (work_hours in ('wfh','office','mixed','retired')),
  school_children   text not null check (school_children in ('all','some','homeschool','none_school_age')),

  -- Home features
  has_indoor_plants boolean not null,
  has_balcony       boolean not null,
  has_ac            boolean not null,
  has_polishables   boolean not null,

  completed_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.household_profiles enable row level security;

create policy hp_read on public.household_profiles for select to authenticated
  using (public.is_active_owner_or_maid(household_id));

create policy hp_write on public.household_profiles for all to authenticated
  using (public.is_active_owner_or_maid(household_id))
  with check (public.is_active_owner_or_maid(household_id));

create trigger hp_touch_updated_at before update on public.household_profiles
  for each row execute function public.touch_updated_at();
```

NULL semantics: no row in `household_profiles` for a household = profile not filled yet. The dashboard prompt card uses this to decide whether to show "Set up household profile" (no row) or "Pick your tasks" (row exists, `task_setup_completed_at IS NULL`).

### New column — `tasks.relevance_tags`

```sql
alter table public.tasks
  add column relevance_tags text[] not null default '{}';

create index tasks_relevance_tags_gin on public.tasks using gin (relevance_tags);
```

### Tag namespace (closed set, no freeform)

```text
age:infants  age:school_age  age:teens  age:adults  age:seniors
pets:none  pets:dog  pets:cat  pets:other  pets:multiple
work:wfh  work:office  work:mixed  work:retired
school:all  school:some  school:homeschool  school:none_school_age
feature:plants  feature:balcony  feature:ac  feature:polishables
```

**Semantics:**
- A task with `relevance_tags = '{}'` is **universal** — always matches.
- A task with non-empty `relevance_tags` matches if ANY tag intersects with the user's matching-tag set (Postgres `&&` operator).
- The user's matching-tag set is derived from their `household_profiles` row (e.g., `{'age:school_age', 'pets:dog', 'feature:plants', ...}`).
- `pets:multiple` always implies match for `pets:dog`, `pets:cat`, `pets:other` (handled in the matching-set derivation, not in DB).

### Picker filter query (simplified)

```sql
-- $1 = derived matching tag set, e.g. ARRAY['age:school_age','pets:dog','feature:plants','feature:balcony','feature:ac','work:mixed','school:all']
select id, title, recurrence_frequency, recurrence_interval, recurrence_byweekday, recurrence_bymonthday, due_time, relevance_tags
from public.tasks
where household_id is null
  and archived_at is null
  and (
    relevance_tags = '{}'                  -- universal
    or relevance_tags && $1::text[]        -- any tag matches
  )
order by
  case recurrence_frequency when 'daily' then 1 when 'weekly' then 2 when 'monthly' then 3 end,
  recurrence_interval,
  coalesce(recurrence_byweekday[1], 0),
  coalesce(recurrence_bymonthday, 0),
  coalesce(due_time, '00:00'::time);
```

The `OR relevance_tags = '{}'` predicate guarantees universal tasks always appear in the filtered set.

The "Show more" expand drops the entire `and (relevance_tags = '{}' OR relevance_tags && $1)` predicate to fetch the remaining tasks.

## Task library shape

**~95 standard tasks** distributed roughly as:

| Frequency | Universal | Tagged | Total |
|---|---|---|---|
| Daily | 27 | 11 | 38 |
| Every 2 days | 1 | 1 | 2 |
| Every 3 days | 4 | 0 | 4 |
| Weekly | 22 | 4 | 26 |
| Bi-weekly | 4 | 1 | 5 |
| Monthly | 16 | 0 | 16 |
| Conditional (pets / child / elderly) | 0 | 14 | 14 |
| **Total** | **74** | **31** | **~95** |

### Schema accommodations

**Multi-time daily tasks.** The user-provided list has e.g. "Wipe kitchen counters and stove" at 09:45 + 13:30 + 21:00 daily. The current `tasks` schema is one-row-per-recurrence (no multi-time-per-day field), so seed as 3 separate task rows. Disambiguate titles by time-of-day suffix:

- "Wipe kitchen counters and stove — morning" (09:45)
- "Wipe kitchen counters and stove — afternoon" (13:30)
- "Wipe kitchen counters and stove — evening" (21:00)

Same pattern for "Wash dishes" (09:30 / 13:00 / 20:30) and any other repeated-name task.

**Monthly "Nth week" → specific day.** Schema uses `recurrence_bymonthday` (int 1-31). Map:

- First week tasks → days 1, 2, 3, 4
- Second week tasks → days 8, 9, 10, 11
- Third week tasks → days 15, 16, 17, 18
- Fourth week tasks → days 22, 23, 24, 25

Spreads each week's load across mid-week days rather than slamming everything onto day 1.

### Seed table (excerpted; full table in the migration)

Universal tasks (sample — no tags):

| Title | Freq | Interval | Day(s) | Time | Tags |
|---|---|---|---|---|---|
| Make tea/coffee for family | daily | 1 | — | 06:30 | {} |
| Prepare breakfast | daily | 1 | — | 07:00 | {} |
| Serve breakfast | daily | 1 | — | 08:00 | {} |
| Sweep and mop main living area | daily | 1 | — | 09:00 | {} |
| Wipe kitchen counters and stove — morning | daily | 1 | — | 09:45 | {} |
| Wipe kitchen counters and stove — afternoon | daily | 1 | — | 13:30 | {} |
| Wipe kitchen counters and stove — evening | daily | 1 | — | 21:00 | {} |
| Iron clothes | daily | 2 | — | 15:00 | {} |
| Clean bathrooms | weekly | 1 | {2} (Tue) | 10:00 | {} |
| Wash bedsheets and pillowcases | weekly | 1 | {0} (Sun) | 09:00 | {} |
| Buy groceries from wet market or NTUC | weekly | 1 | {6} (Sat) | 08:00 | {} |
| Deep clean oven and stovetop | monthly | 1 | day 1 | 09:00 | {} |
| Clean window tracks and frames | monthly | 1 | day 10 | 10:00 | {} |

Tagged tasks (sample):

| Title | Freq | Time | Tags |
|---|---|---|---|
| Help children get ready for school | daily | 07:30 | `{school:all,school:some}` |
| Pack school lunch boxes | daily | 08:30 | `{school:all,school:some}` |
| Accompany children to school bus stop | daily | 08:45 | `{school:all,school:some}` |
| Receive children from school bus | daily | 15:00 | `{school:all,school:some}` |
| Serve snacks to children | daily | 15:30 | `{age:school_age,age:teens}` |
| Water indoor plants | daily (every 2) | 08:00 | `{feature:plants}` |
| Clean balcony / terrace area | weekly (Wed) | 10:00 | `{feature:balcony}` |
| Polish wooden furniture | weekly (Sat) | 14:00 | `{feature:polishables}` |
| Clean A/C filters | weekly (Wed, every 2) | 14:00 | `{feature:ac}` |
| Polish silverware / brass | monthly (day 25) | 11:00 | `{feature:polishables}` |
| Feed pets, clean food/water bowls | daily | 07:30 + 18:30 (2 rows) | `{pets:dog,pets:cat,pets:other,pets:multiple}` |
| Walk dog — morning | daily | 07:00 | `{pets:dog,pets:multiple}` |
| Walk dog — evening | daily | 18:00 | `{pets:dog,pets:multiple}` |
| Clean litter box | weekly (Sat) | 09:00 | `{pets:cat,pets:multiple}` |
| Bathe and groom pets | monthly (day 8) | 09:00 | `{pets:dog,pets:cat,pets:multiple}` |
| Sterilize baby bottles | daily | 10:00 + 22:00 (2 rows) | `{age:infants}` |
| Prepare baby food / formula | daily | 11:00 + 17:00 (2 rows) | `{age:infants}` |
| Help with homework supervision | daily | 16:00 | `{age:school_age,age:teens}` |
| Organize children's study area | weekly (Sun) | 11:00 | `{age:school_age,age:teens}` |
| Assist with mobility as needed | daily | 09:00 | `{age:seniors}` |
| Prepare special dietary meals | daily | 12:00 | `{age:seniors}` |
| Medication reminders | daily | 09:00 + 14:00 + 21:00 (3 rows) | `{age:seniors}` |
| Accompany to medical appointments | weekly (Thu) | 10:00 | `{age:seniors}` |

(The full seed list is constructed by the migration. Implementation will validate count matches ~95 ± a handful and that every task has a sensible time + days.)

## Questionnaire UI

### Route: `/onboarding/profile`

- New page; either-role accessible.
- Redirects to `/dashboard` if `household_profiles` row already exists AND we're not in edit mode (controlled via query param `?edit=1` or referrer check).
- Single scrolling form (no per-question wizard). 5 questions visible on one page.
- Topbar: title "Set up your household", subtitle "Step 1 of 2 — about your home (~30 seconds)".
- Bottom sticky submit bar: "Continue to task picker →" button. Disabled until all 5 answered. Helper text "You can change these later in Household settings."

### Question rendering (5 sections)

All controls use existing design tokens. No new primitives.

1. **Who lives in your home?** Multi-select stacked rows. Each row = checkbox + label. Selected row = `bg-primary-subtle` background.
2. **Do you have pets?** Single-select stacked rows. Each row = radio + label.
3. **Working hours of adults** — single-select.
4. **School-age children?** — single-select.
5. **What features does your home have?** — multi-select (4 options: plants, balcony, A/C, polishables). Maps to the 4 boolean columns.

### Validation

- All 5 must be answered. Submit button disabled until valid.
- Multi-select questions (1, 5) require ≥1 selection.
- Server action re-validates (RLS + check constraints + explicit field checks). Returns inline form errors on failure.

### Server action

- Insert (first-time) or update (edit mode) the `household_profiles` row.
- On insert, redirect to `/onboarding/tasks` (picker).
- On update (edit mode from settings), redirect to `/household/settings` with a success toast.

## Picker UI

### Route: `/onboarding/tasks` (existing, refit)

- Either-role accessible (drops the `if (ctx.membership.role !== "owner") redirect("/dashboard")` line).
- Redirects to `/onboarding/profile` if `household_profiles` row missing.
- Redirects to `/dashboard` if `task_setup_completed_at IS NOT NULL`.
- Topbar: title "Pick your tasks", subtitle "Step 2 of 2 — tap tasks you want; deselect what you don't".

### Profile chip (top)

Banner-like row showing the user's profile summary as a comma-separated label, with "Edit" link to `/onboarding/profile?edit=1`. Visual treatment: white card, `border-border`, small icon chip leading, text trailing, action right-aligned.

Example label rendering: "Young children · Dog · Mixed work · Plants · Balcony · A/C"

### Count line

Below the chip: "Showing **38 of 95** tasks matched to your home" (numbers dynamic from the filtered query).

### Frequency-grouped task sections

Each frequency bucket is its own labeled section with stacked task rows. Sections in order:

1. Daily
2. Every 2 days
3. Every 3 days
4. Weekly (sub-sorted by `byweekday[0]` then `due_time`)
5. Bi-weekly & Monthly (combined section)

Each task row: leading checkbox + title (with optional tag pill) + meta line (`time + frequency`).

**All filtered tasks are pre-checked by default** (recommended starting set). User can deselect.

### Tag pills

When a task has any non-empty `relevance_tags`, render a small inline badge (`bg-primary-subtle text-primary text-[10.5px]`) next to the title showing the matching category — `school`, `pet`, `feature`, `age`. Helps the user see WHY a tagged task is in the list.

### "Show more" expand

Below the last filtered section: dashed-border card with text "Show 57 more tasks (not matched to your profile) — Universal chores, plus pets/school/feature tasks you said no to". Tap to expand.

Expanded view appends additional task sections below the dashed divider. Hidden tasks render UN-checked (user opts in by tapping). Re-fetches via the same query without the `and (relevance_tags = '{}' or relevance_tags && $1)` predicate. The already-shown universal/matched tasks are de-duplicated client-side.

### Submit

- Bottom sticky bar: "Done · Set up 38 tasks" (counter updates as user toggles checkboxes).
- Server action: bulk-insert task rows (one per checked task) into `tasks` with `household_id = current`, then UPDATE `households.task_setup_completed_at = now()`, then redirect to `/dashboard`.
- Helper text: "You can add/remove tasks later in Tasks settings."

## Flow integration

### Dashboard prompt cards ([src/app/dashboard/page.tsx](../../../src/app/dashboard/page.tsx))

**Before:**

```tsx
const showTaskSetupPromptCard =
  ctx.membership.role === "owner" &&
  ctx.household.maid_mode !== "unset" &&
  !setupCompleted;
// + separate showTaskSetupWaitingCard for maids
```

**After:**

```tsx
const setupCompleted = ctx.household.task_setup_completed_at !== null;
const profileExists = /* boolean from a query */;
const showProfilePromptCard =
  ctx.household.maid_mode !== "unset" &&
  !profileExists;
const showTaskSetupPromptCard =
  ctx.household.maid_mode !== "unset" &&
  profileExists &&
  !setupCompleted;
// showTaskSetupWaitingCard deleted entirely.
```

**Card content:**

- `showProfilePromptCard` → Banner with title "Set up your household", body "5 quick questions so the task picker only shows what fits your home.", action link to `/onboarding/profile`.
- `showTaskSetupPromptCard` → Banner with title "Pick your tasks", body "Choose the chores that apply.", action link to `/onboarding/tasks`.

Both visible to both roles.

### Files deleted

- `src/app/onboarding/tasks/tune/` (entire directory) — tune step dropped.
- `src/components/site/task-setup-waiting-card.tsx` — no longer needed (either role can drive).

### Files modified

| File | Change |
|---|---|
| `src/app/onboarding/tasks/page.tsx` | Drop owner-only redirect; add profile-missing redirect; refit to filtered picker UI with profile chip + show-more. **Keep** the `task_setup_drafts` integration — it still serves "preserve picks across a refresh" and is unchanged by this spec. |
| `src/app/onboarding/tasks/pick-form.tsx` | Reshape to render frequency-grouped sections with show-more expand. Tag pill rendering. Pre-checked filtered tasks. |
| `src/app/onboarding/tasks/actions.ts` | Drop owner-only checks; finalize action commits picked tasks + flips `task_setup_completed_at`. |
| `src/app/dashboard/page.tsx` | Drop role gates on prompt cards; drop `showTaskSetupWaitingCard`; introduce `showProfilePromptCard` + adjusted `showTaskSetupPromptCard`. |
| `src/app/household/settings/page.tsx` | Add a "Household profile" Banner with "Update" link to `/onboarding/profile?edit=1`. |

### Files added

| File | Purpose |
|---|---|
| `src/app/onboarding/profile/page.tsx` | Questionnaire form. Server-renders with current profile values when `?edit=1`. |
| `src/app/onboarding/profile/profile-form.tsx` | Client component for the form. |
| `src/app/onboarding/profile/actions.ts` | Server actions for create + update. |
| `src/lib/profile/matching-tags.ts` | Derives the user's matching-tag string array from a `household_profiles` row. Pure function. Used by the picker query. |

## Migration sequence

Single migration `2026XXXX_001_household_profile_v2.sql` does all of this transactionally:

1. **Create** `household_profiles` table + RLS policies + trigger.
2. **Add** `relevance_tags text[]` column + GIN index on `tasks`.
3. **Wipe** existing setup state:
   - `delete from public.task_occurrences;`
   - `delete from public.household_task_hides;`
   - `delete from public.tasks where household_id is not null;`
   - `delete from public.tasks where household_id is null;` (the old 13 standards)
   - `update public.households set task_setup_completed_at = null;`
   - `truncate public.task_setup_drafts;`
4. **Insert** the ~95 new standard tasks with `relevance_tags`.
5. **Sanity check** at the end of the migration:
   ```sql
   do $$
   declare v_count int;
   begin
     select count(*) into v_count from public.tasks where household_id is null;
     if v_count < 90 or v_count > 100 then
       raise exception 'Seed row count out of expected range: % (expected ~95)', v_count;
     end if;
   end$$;
   ```
   Catches accidental drift if a future migration partially deletes or duplicates seed rows.

Mirrors the destructive pattern from `20260705_001_household_setup_gates.sql`. "No real users yet — intentional" assumption still holds.

## Testing

- **Unit:** `src/lib/profile/matching-tags.ts` — pure function, comprehensive tag-derivation tests (especially `pets:multiple` → implies dog+cat+other).
- **DB:** new `tests/db/household-profiles.test.ts` covering: insert/update RLS (both roles can write, family_member can't, no membership can't), check constraints, NULL → fill flow.
- **DB:** new `tests/db/task-relevance-filter.test.ts` covering: universal tasks always match, tagged tasks match correctly for each profile shape, `&&` operator behavior on multi-tag tasks.
- **Action:** server-action tests for `/onboarding/profile/actions.ts` and the refit picker action.
- **Existing tests:** the DB tests broken by the new task library shape (`tests/db/mealplan-autofill.test.ts` etc. that depend on the old 13-task seed) will need to be re-baselined against the new ~95-task seed. This is implementation work, not spec scope.

## Out of scope — see [follow-ups.md](./2026-05-17-onboarding-redesign/follow-ups.md)

- Tune step in onboarding (dropped in favor of seed defaults + later edit).
- AI task suggestions ("d" option from Q1).
- Freeform "Something else" inputs on questions.
- Schema extension for multi-time-per-day tasks.
- i18n (slice D in design-system follow-ups).
- Maid persona dashboard (slice B).
- Concurrent-edit conflict resolution.
