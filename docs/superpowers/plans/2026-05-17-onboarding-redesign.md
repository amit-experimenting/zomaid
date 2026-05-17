# Onboarding Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the household-profile questionnaire + task library v2 refit. 5-question profile drives soft-filtering on a ~100-task standard library. Either owner or maid can run the whole flow. Pre-existing households get wiped and re-seeded.

**Architecture:** New `household_profiles` table (5 columns + 4 booleans) + `relevance_tags text[]` on tasks. Profile answers derive a tag-set; picker query uses Postgres `&&` to intersect tags. UI = `/onboarding/profile` (single scrolling form) → `/onboarding/tasks` (refit picker with profile chip + frequency-grouped sections + Show-more expand). Either role can drive setup; dashboard prompt cards lose their owner gate.

**Tech Stack:** Next.js 16 (server actions + App Router), React 19, Tailwind v4, Supabase (Postgres + RLS), vitest (node-only DB tests via pg). All new UI uses the design-system primitives from slice A (Banner, IconButton, etc.).

**Branch:** Lands on `design-system-foundation` (same branch as slice A, per user request to bundle).

**Spec:** [docs/superpowers/specs/2026-05-17-onboarding-redesign.md](../specs/2026-05-17-onboarding-redesign.md)

---

## File structure

### Created

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260517_001_household_profile_v2.sql` | Single migration: `household_profiles` table + RLS + `tasks.relevance_tags` column + GIN index + wipe-existing + reseed ~100 tasks + sanity check. |
| `src/lib/profile/matching-tags.ts` | Pure function `deriveMatchingTags(profile)` → `string[]`. Maps a `HouseholdProfile` row to the tag array used for `&&` filtering. |
| `src/lib/profile/types.ts` | Shared TypeScript types: `HouseholdProfile`, `AgeGroup`, `Pets`, `WorkHours`, `SchoolChildren`. |
| `src/app/onboarding/profile/page.tsx` | Server-rendered questionnaire page. Reads current profile (edit mode), forwards to form component. |
| `src/app/onboarding/profile/profile-form.tsx` | Client form (5 questions, validation, submit). |
| `src/app/onboarding/profile/actions.ts` | Server actions: `saveProfileAction(formData)` (insert or update). |
| `tests/db/household-profiles.test.ts` | DB tests for the new table: insert/update RLS, check constraints. |
| `tests/db/task-relevance-filter.test.ts` | DB tests for the filter query against the new seed. |
| `tests/unit/matching-tags.test.ts` | Unit test for the pure function. |

### Modified

| Path | Changes |
|---|---|
| `src/app/onboarding/tasks/page.tsx` | Drop owner-only redirect; add profile-missing redirect; fetch the user's matching tags + the full standard task set + the user's draft picks. |
| `src/app/onboarding/tasks/pick-form.tsx` | Refit: profile chip at top, frequency-grouped sections, tag pills, pre-checked filtered tasks, "Show N more" expand for unmatched. |
| `src/app/onboarding/tasks/actions.ts` | Drop owner-only check from `finalizePicksAction`; same shape otherwise (bulk insert tasks + flip `task_setup_completed_at`). |
| `src/app/dashboard/page.tsx` | Drop `role === "owner"` gates on prompt cards. Split into `showProfilePromptCard` (no row in `household_profiles`) + `showTaskSetupPromptCard` (row exists, setup not done). Delete `showTaskSetupWaitingCard` block + import. |
| `src/components/site/task-setup-prompt-card.tsx` | Add a new variant `"profile-pending"` for the household-profile prompt, OR replace with two card components — see Task 5.1 for the decision. |
| `src/app/household/settings/page.tsx` | Add a "Household profile" Banner row with "Update" link → `/onboarding/profile?edit=1`. |

### Deleted

| Path | Reason |
|---|---|
| `src/app/onboarding/tasks/tune/` (entire directory) | Tune step dropped — pre-seeded times serve as defaults. |
| `src/components/site/task-setup-waiting-card.tsx` | No longer needed — either role can drive setup. |

---

## Phase 1 — Database schema + migration

### Task 1.1: Create migration skeleton (table, RLS, column, index — no seed yet)

**Files:**
- Create: `supabase/migrations/20260517_001_household_profile_v2.sql`

- [ ] **Step 1: Create the migration with schema + RLS + column + index**

```sql
-- supabase/migrations/20260517_001_household_profile_v2.sql
-- 2026-05-17 — Household profile + task library v2.
-- Adds household_profiles table, relevance_tags on tasks, wipes existing
-- task setup state, reseeds ~100 standard tasks with relevance tags.

-- 1. household_profiles table -----------------------------------------------

create table public.household_profiles (
  household_id      uuid primary key references public.households(id) on delete cascade,

  -- Demographics
  age_groups        text[] not null check (
    array_length(age_groups, 1) >= 1
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

-- 2. tasks.relevance_tags ---------------------------------------------------

alter table public.tasks
  add column relevance_tags text[] not null default '{}';

create index tasks_relevance_tags_gin on public.tasks using gin (relevance_tags);

-- 3. Wipe existing setup ----------------------------------------------------
--    No real users yet — intentional (matches the 2026-07-05 setup-gates pattern).
--    Clears household tasks, occurrences, hides, and resets the gate flag.

delete from public.task_occurrences;
delete from public.household_task_hides;
delete from public.tasks where household_id is not null;
delete from public.tasks where household_id is null;  -- old 13 standards
update public.households set task_setup_completed_at = null;
truncate public.task_setup_drafts;

-- 4. Seed new standards -----------------------------------------------------
-- Inserted in Task 1.2 below.

-- 5. Sanity check -----------------------------------------------------------
-- Inserted in Task 1.3 below.
```

- [ ] **Step 2: Reset the local DB to apply**

```bash
pnpm db:reset
```

Expected: migration applies cleanly through this point. No tasks exist after wipe. Building the picker before seed will show an empty list (acceptable for now).

- [ ] **Step 3: Sanity-check the schema**

```bash
psql "$(grep DATABASE_URL .env.local | cut -d= -f2-)" -c "\d public.household_profiles"
```

Expected: shows the table with all columns + check constraints.

```bash
psql "$(grep DATABASE_URL .env.local | cut -d= -f2-)" -c "\d public.tasks" | grep relevance_tags
```

Expected: `relevance_tags | text[] | | not null | '{}'::text[]`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260517_001_household_profile_v2.sql
git commit -m "feat(db): add household_profiles + tasks.relevance_tags (schema only)"
```

---

### Task 1.2: Add the ~100 standard-task seed

**Files:**
- Modify: `supabase/migrations/20260517_001_household_profile_v2.sql` (append seed block before sanity check)

- [ ] **Step 1: Append the seed VALUES block**

In `supabase/migrations/20260517_001_household_profile_v2.sql`, replace the line `-- Inserted in Task 1.2 below.` (under section 4) with:

```sql
-- 4. Seed new standards -----------------------------------------------------

insert into public.tasks
  (household_id, title, recurrence_frequency, recurrence_interval, recurrence_byweekday, recurrence_bymonthday, due_time, relevance_tags)
values
  -- DAILY · universal (morning)
  (null, 'Make tea/coffee for family',                  'daily', 1, null, null, '06:30', '{}'),
  (null, 'Prepare breakfast',                            'daily', 1, null, null, '07:00', '{}'),
  (null, 'Serve breakfast',                              'daily', 1, null, null, '08:00', '{}'),
  (null, 'Sweep and mop main living area',               'daily', 1, null, null, '09:00', '{}'),
  (null, 'Wash dishes — breakfast',                      'daily', 1, null, null, '09:30', '{}'),
  (null, 'Wipe kitchen counters and stove — morning',    'daily', 1, null, null, '09:45', '{}'),
  (null, 'Make beds in all bedrooms',                    'daily', 1, null, null, '10:00', '{}'),
  (null, 'Dust furniture and surfaces',                  'daily', 1, null, null, '10:30', '{}'),
  (null, 'Organize and tidy bedrooms',                   'daily', 1, null, null, '11:00', '{}'),

  -- DAILY · universal (lunch)
  (null, 'Prepare lunch ingredients',                    'daily', 1, null, null, '11:30', '{}'),
  (null, 'Cook lunch',                                   'daily', 1, null, null, '12:00', '{}'),
  (null, 'Serve lunch',                                  'daily', 1, null, null, '12:30', '{}'),
  (null, 'Wash dishes — lunch',                          'daily', 1, null, null, '13:00', '{}'),
  (null, 'Wipe kitchen counters and stove — afternoon',  'daily', 1, null, null, '13:30', '{}'),
  (null, 'Fold and put away dried laundry',              'daily', 1, null, null, '14:00', '{}'),

  -- DAILY · universal (evening)
  (null, 'Prepare evening tea/coffee',                   'daily', 1, null, null, '16:00', '{}'),
  (null, 'Start dinner preparation',                     'daily', 1, null, null, '16:30', '{}'),
  (null, 'Sweep kitchen floor',                          'daily', 1, null, null, '17:00', '{}'),
  (null, 'Serve dinner',                                 'daily', 1, null, null, '18:30', '{}'),
  (null, 'Clear dinner table',                           'daily', 1, null, null, '19:30', '{}'),
  (null, 'Take out kitchen trash',                       'daily', 1, null, null, '20:00', '{}'),
  (null, 'Wash dishes — dinner',                         'daily', 1, null, null, '20:30', '{}'),
  (null, 'Wipe kitchen counters and stove — evening',    'daily', 1, null, null, '21:00', '{}'),
  (null, 'Final kitchen cleanup',                        'daily', 1, null, null, '21:15', '{}'),

  -- DAILY · school (tagged)
  (null, 'Help children get ready for school',           'daily', 1, null, null, '07:30', '{school:all,school:some}'),
  (null, 'Pack school lunch boxes',                      'daily', 1, null, null, '08:30', '{school:all,school:some}'),
  (null, 'Accompany children to school bus stop',        'daily', 1, null, null, '08:45', '{school:all,school:some}'),
  (null, 'Receive children from school bus',             'daily', 1, null, null, '15:00', '{school:all,school:some}'),
  (null, 'Serve snacks to children',                     'daily', 1, null, null, '15:30', '{age:school_age,age:teens}'),

  -- DAILY · pet (tagged)
  (null, 'Feed pets — morning',                          'daily', 1, null, null, '07:30', '{pets:dog,pets:cat,pets:other,pets:multiple}'),
  (null, 'Feed pets — evening',                          'daily', 1, null, null, '18:30', '{pets:dog,pets:cat,pets:other,pets:multiple}'),
  (null, 'Walk dog — morning',                           'daily', 1, null, null, '07:00', '{pets:dog,pets:multiple}'),
  (null, 'Walk dog — evening',                           'daily', 1, null, null, '18:00', '{pets:dog,pets:multiple}'),

  -- DAILY · infant (tagged)
  (null, 'Sterilize baby bottles — morning',             'daily', 1, null, null, '10:00', '{age:infants}'),
  (null, 'Sterilize baby bottles — evening',             'daily', 1, null, null, '22:00', '{age:infants}'),
  (null, 'Prepare baby food / formula — morning',        'daily', 1, null, null, '11:00', '{age:infants}'),
  (null, 'Prepare baby food / formula — evening',        'daily', 1, null, null, '17:00', '{age:infants}'),

  -- DAILY · child (tagged)
  (null, 'Help with homework supervision',               'daily', 1, null, null, '16:00', '{age:school_age,age:teens}'),

  -- DAILY · elderly (tagged)
  (null, 'Assist with mobility as needed',               'daily', 1, null, null, '09:00', '{age:seniors}'),
  (null, 'Prepare special dietary meals',                'daily', 1, null, null, '12:00', '{age:seniors}'),
  (null, 'Medication reminders — morning',               'daily', 1, null, null, '09:00', '{age:seniors}'),
  (null, 'Medication reminders — afternoon',             'daily', 1, null, null, '14:00', '{age:seniors}'),
  (null, 'Medication reminders — evening',               'daily', 1, null, null, '21:00', '{age:seniors}'),

  -- EVERY 2 DAYS
  (null, 'Water indoor plants',                          'daily', 2, null, null, '08:00', '{feature:plants}'),
  (null, 'Iron clothes',                                 'daily', 2, null, null, '15:00', '{}'),

  -- EVERY 3 DAYS
  (null, 'Mop all bedroom floors',                       'daily', 3, null, null, '09:00', '{}'),
  (null, 'Clean kitchen cabinets (exterior)',            'daily', 3, null, null, '10:00', '{}'),
  (null, 'Wash and change kitchen towels',               'daily', 3, null, null, '14:00', '{}'),
  (null, 'Clean refrigerator shelves',                   'daily', 3, null, null, '15:00', '{}'),

  -- WEEKLY · Monday (byweekday: 0=Sun, 1=Mon, ... 6=Sat — Postgres int convention)
  (null, 'Wash and refill water-bottle drinking station','weekly', 1, '{1}', null, '09:00', '{}'),
  (null, 'Clean mirrors throughout house',               'weekly', 1, '{1}', null, '10:00', '{}'),
  (null, 'Wash doormats',                                'weekly', 1, '{1}', null, '14:00', '{}'),

  -- WEEKLY · Tuesday
  (null, 'Deep clean stovetop and oven',                 'weekly', 1, '{2}', null, '09:00', '{}'),
  (null, 'Clean bathrooms (toilets, sinks, tiles)',      'weekly', 1, '{2}', null, '10:00', '{}'),
  (null, 'Vacuum carpet and rugs',                       'weekly', 1, '{2}', null, '10:30', '{}'),
  (null, 'Organize kitchen pantry',                      'weekly', 1, '{2}', null, '11:00', '{}'),
  (null, 'Clean ceiling fans',                           'weekly', 1, '{2}', null, '14:00', '{}'),

  -- WEEKLY · Wednesday
  (null, 'Dust all photo frames and decorative items',   'weekly', 1, '{3}', null, '09:00', '{}'),
  (null, 'Clean balcony / terrace area',                 'weekly', 1, '{3}', null, '10:00', '{feature:balcony}'),
  (null, 'Wipe down all switches and door handles',      'weekly', 1, '{3}', null, '11:00', '{}'),

  -- WEEKLY · Thursday
  (null, 'Clean washing machine (empty cycle)',          'weekly', 1, '{4}', null, '09:00', '{}'),
  (null, 'Organize wardrobes and closets',               'weekly', 1, '{4}', null, '10:00', '{}'),
  (null, 'Vacuum under furniture and hard-to-reach areas','weekly', 1, '{4}', null, '11:00', '{}'),
  (null, 'Accompany to medical appointments',            'weekly', 1, '{4}', null, '10:00', '{age:seniors}'),

  -- WEEKLY · Friday
  (null, 'Deep clean bathrooms (scrub tiles, grout)',    'weekly', 1, '{5}', null, '09:00', '{}'),
  (null, 'Vacuum carpet and rugs — second pass',         'weekly', 1, '{5}', null, '10:30', '{}'),
  (null, 'Clean exhaust fans in kitchen and bathrooms',  'weekly', 1, '{5}', null, '11:00', '{}'),
  (null, 'Wipe windows and glass doors (interior)',      'weekly', 1, '{5}', null, '14:00', '{}'),

  -- WEEKLY · Saturday
  (null, 'Buy groceries from wet market or NTUC',        'weekly', 1, '{6}', null, '08:00', '{}'),
  (null, 'Clean litter boxes',                           'weekly', 1, '{6}', null, '09:00', '{pets:cat,pets:multiple}'),
  (null, 'Clean pet beds',                               'weekly', 1, '{6}', null, '09:30', '{pets:dog,pets:cat,pets:other,pets:multiple}'),
  (null, 'Clean and organize refrigerator thoroughly',   'weekly', 1, '{6}', null, '10:00', '{}'),
  (null, 'Wash curtains (rotate rooms each week)',       'weekly', 1, '{6}', null, '11:00', '{}'),
  (null, 'Polish wooden furniture',                      'weekly', 1, '{6}', null, '14:00', '{feature:polishables}'),

  -- WEEKLY · Sunday
  (null, 'Wash bedsheets and pillowcases',               'weekly', 1, '{0}', null, '09:00', '{}'),
  (null, 'Deep clean one room thoroughly (rotate weekly)','weekly', 1, '{0}', null, '10:00', '{}'),
  (null, 'Organize children''s study area',              'weekly', 1, '{0}', null, '11:00', '{age:school_age,age:teens}'),
  (null, 'Mop all floors with disinfectant',             'weekly', 1, '{0}', null, '11:30', '{}'),
  (null, 'Prepare weekly meal plan and shopping list',   'weekly', 1, '{0}', null, '14:00', '{}'),

  -- BI-WEEKLY (all on Wednesday, interval=2)
  (null, 'Clean microwave thoroughly',                   'weekly', 2, '{3}', null, '09:00', '{}'),
  (null, 'Descale kettle and coffee maker',              'weekly', 2, '{3}', null, '10:00', '{}'),
  (null, 'Clean A/C filters',                            'weekly', 2, '{3}', null, '11:00', '{feature:ac}'),
  (null, 'Wipe baseboards and skirting',                 'weekly', 2, '{3}', null, '14:00', '{}'),
  (null, 'Clean light fixtures and lampshades',          'weekly', 2, '{3}', null, '15:00', '{}'),

  -- MONTHLY · first week (days 1-4)
  (null, 'Deep clean oven and stovetop',                 'monthly', 1, null, 1, '09:00', '{}'),
  (null, 'Clean behind large appliances',                'monthly', 1, null, 2, '09:00', '{}'),
  (null, 'Wash windows and glass doors (exterior)',      'monthly', 1, null, 3, '09:00', '{}'),
  (null, 'Clean grout in bathrooms and kitchen',         'monthly', 1, null, 4, '09:00', '{}'),
  (null, 'Organize and declutter storage areas',         'monthly', 1, null, 4, '14:00', '{}'),

  -- MONTHLY · second week (days 8-11)
  (null, 'Clean under beds and heavy furniture',         'monthly', 1, null, 8, '09:00', '{}'),
  (null, 'Bathe and groom pets',                         'monthly', 1, null, 8, '10:00', '{pets:dog,pets:cat,pets:multiple}'),
  (null, 'Vacuum and flip mattresses',                   'monthly', 1, null, 9, '09:00', '{}'),
  (null, 'Clean window tracks and frames',               'monthly', 1, null, 10, '09:00', '{}'),
  (null, 'Wipe down walls and remove marks',             'monthly', 1, null, 11, '09:00', '{}'),

  -- MONTHLY · third week (days 15-18)
  (null, 'Deep clean kitchen cabinets (interior)',       'monthly', 1, null, 15, '09:00', '{}'),
  (null, 'Clean and organize utility / store room',      'monthly', 1, null, 16, '09:00', '{}'),
  (null, 'Wash and clean trash bins thoroughly',         'monthly', 1, null, 17, '09:00', '{}'),
  (null, 'Clean garage or car porch area',               'monthly', 1, null, 18, '09:00', '{}'),

  -- MONTHLY · fourth week (days 22-25)
  (null, 'Polish silverware and brass items',            'monthly', 1, null, 22, '09:00', '{feature:polishables}'),
  (null, 'Clean and organize children''s toy storage',   'monthly', 1, null, 23, '09:00', '{age:school_age,age:teens}'),
  (null, 'Seasonal clothing rotation and storage',       'monthly', 1, null, 24, '09:00', '{}'),
  (null, 'Check and replace air fresheners',             'monthly', 1, null, 25, '09:00', '{}');
```

- [ ] **Step 2: Reset DB to apply seed**

```bash
pnpm db:reset
```

- [ ] **Step 3: Count rows**

```bash
psql "$(grep DATABASE_URL .env.local | cut -d= -f2-)" -c "select count(*) from public.tasks where household_id is null"
```

Expected: a count between 95 and 110. (My count comes to ~98.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260517_001_household_profile_v2.sql
git commit -m "feat(db): seed task library v2 (~98 standard tasks with relevance tags)"
```

---

### Task 1.3: Add migration sanity check

**Files:**
- Modify: `supabase/migrations/20260517_001_household_profile_v2.sql` (append sanity check at end)

- [ ] **Step 1: Append the sanity-check block**

Replace `-- Inserted in Task 1.3 below.` at the bottom with:

```sql
-- 5. Sanity check -----------------------------------------------------------
do $$
declare v_count int;
begin
  select count(*) into v_count from public.tasks where household_id is null;
  if v_count < 95 or v_count > 110 then
    raise exception 'Seed row count out of expected range: % (expected 95-110)', v_count;
  end if;
end$$;
```

- [ ] **Step 2: Reset DB to apply**

```bash
pnpm db:reset
```

Expected: migration applies cleanly; the DO block raises no exception.

- [ ] **Step 3: Verify the check fires on out-of-range**

Temporarily increase `v_count > 110` to `v_count > 50` (forcing failure), re-run `pnpm db:reset`, observe the `ERROR: Seed row count out of expected range: 98 (expected 95-50)` message. Revert the change.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260517_001_household_profile_v2.sql
git commit -m "feat(db): add seed-count sanity check"
```

---

## Phase 2 — Matching-tags library

### Task 2.1: Write the failing unit test

**Files:**
- Create: `src/lib/profile/types.ts`
- Create: `tests/unit/matching-tags.test.ts`

- [ ] **Step 1: Create the types file**

```ts
// src/lib/profile/types.ts
export type AgeGroup = "infants" | "school_age" | "teens" | "adults" | "seniors";
export type Pets = "none" | "dog" | "cat" | "other" | "multiple";
export type WorkHours = "wfh" | "office" | "mixed" | "retired";
export type SchoolChildren = "all" | "some" | "homeschool" | "none_school_age";

export type HouseholdProfile = {
  age_groups: AgeGroup[];
  pets: Pets;
  work_hours: WorkHours;
  school_children: SchoolChildren;
  has_indoor_plants: boolean;
  has_balcony: boolean;
  has_ac: boolean;
  has_polishables: boolean;
};
```

- [ ] **Step 2: Write the test**

```ts
// tests/unit/matching-tags.test.ts
import { describe, it, expect } from "vitest";
import { deriveMatchingTags } from "@/lib/profile/matching-tags";
import type { HouseholdProfile } from "@/lib/profile/types";

function profile(overrides: Partial<HouseholdProfile> = {}): HouseholdProfile {
  return {
    age_groups: ["adults"],
    pets: "none",
    work_hours: "mixed",
    school_children: "none_school_age",
    has_indoor_plants: false,
    has_balcony: false,
    has_ac: false,
    has_polishables: false,
    ...overrides,
  };
}

describe("deriveMatchingTags", () => {
  it("emits one tag per scalar answer and one per age group", () => {
    const tags = deriveMatchingTags(profile({ age_groups: ["adults", "school_age"] }));
    expect(tags).toEqual(expect.arrayContaining([
      "age:adults", "age:school_age",
      "pets:none",
      "work:mixed",
      "school:none_school_age",
    ]));
  });

  it("emits feature:* only for true booleans", () => {
    const tags = deriveMatchingTags(profile({
      has_indoor_plants: true,
      has_balcony: false,
      has_ac: true,
      has_polishables: false,
    }));
    expect(tags).toContain("feature:plants");
    expect(tags).not.toContain("feature:balcony");
    expect(tags).toContain("feature:ac");
    expect(tags).not.toContain("feature:polishables");
  });

  it("expands pets:multiple to imply pets:dog, pets:cat, pets:other", () => {
    const tags = deriveMatchingTags(profile({ pets: "multiple" }));
    expect(tags).toContain("pets:multiple");
    expect(tags).toContain("pets:dog");
    expect(tags).toContain("pets:cat");
    expect(tags).toContain("pets:other");
  });

  it("does NOT expand pets:dog to imply other pets", () => {
    const tags = deriveMatchingTags(profile({ pets: "dog" }));
    expect(tags).toContain("pets:dog");
    expect(tags).not.toContain("pets:cat");
    expect(tags).not.toContain("pets:other");
  });

  it("never returns duplicates", () => {
    const tags = deriveMatchingTags(profile({
      age_groups: ["adults", "adults", "seniors"], // simulated dup
      pets: "multiple",
    }));
    const set = new Set(tags);
    expect(tags.length).toBe(set.size);
  });
});
```

- [ ] **Step 3: Run the test — must fail (module not found)**

```bash
pnpm test tests/unit/matching-tags.test.ts
```

Expected: import error / 5 failures because `matching-tags.ts` doesn't exist yet.

- [ ] **Step 4: Verify the test config picks up `tests/unit/`**

Check `vitest.config.ts`:

```bash
grep "include" vitest.config.ts
```

If `include` is `["tests/**/*.test.ts"]` (it is), then `tests/unit/` matches. No config change.

- [ ] **Step 5: Commit**

```bash
git add src/lib/profile/types.ts tests/unit/matching-tags.test.ts
git commit -m "test(profile): add failing matching-tags unit test"
```

---

### Task 2.2: Implement matching-tags — turns test green

**Files:**
- Create: `src/lib/profile/matching-tags.ts`

- [ ] **Step 1: Implement the function**

```ts
// src/lib/profile/matching-tags.ts
import type { HouseholdProfile } from "./types";

export function deriveMatchingTags(profile: HouseholdProfile): string[] {
  const tags = new Set<string>();

  for (const age of profile.age_groups) tags.add(`age:${age}`);

  tags.add(`pets:${profile.pets}`);
  if (profile.pets === "multiple") {
    tags.add("pets:dog");
    tags.add("pets:cat");
    tags.add("pets:other");
  }

  tags.add(`work:${profile.work_hours}`);
  tags.add(`school:${profile.school_children}`);

  if (profile.has_indoor_plants) tags.add("feature:plants");
  if (profile.has_balcony) tags.add("feature:balcony");
  if (profile.has_ac) tags.add("feature:ac");
  if (profile.has_polishables) tags.add("feature:polishables");

  return Array.from(tags);
}
```

- [ ] **Step 2: Run the test — must pass**

```bash
pnpm test tests/unit/matching-tags.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/profile/matching-tags.ts
git commit -m "feat(profile): implement deriveMatchingTags"
```

---

## Phase 3 — DB tests (RLS + filter behavior)

### Task 3.1: household_profiles RLS test

**Files:**
- Create: `tests/db/household-profiles.test.ts`

- [ ] **Step 1: Write the test**

The existing factory API uses `insertProfile`, `insertHousehold`, `insertMembership` (not higher-level `makeOwner` helpers). Auth context is set via `setJwtClaims(c, { sub: clerkUserId })` from `tests/setup`. Pattern matches `tests/db/households.test.ts`.

```ts
// tests/db/household-profiles.test.ts
import { describe, it, expect } from "vitest";
import { setJwtClaims, withTransaction } from "../setup";
import { insertHousehold, insertMembership, insertProfile } from "../factories";

async function newHousehold(c: import("pg").Client) {
  const owner = await insertProfile(c);
  const h = await insertHousehold(c, { created_by_profile_id: owner.id });
  await insertMembership(c, { household_id: h.id, profile_id: owner.id, role: "owner" });
  return { owner, householdId: h.id };
}

async function newMember(c: import("pg").Client, householdId: string, role: "owner" | "family_member" | "maid") {
  const p = await insertProfile(c);
  await insertMembership(c, { household_id: householdId, profile_id: p.id, role });
  return p;
}

const INSERT_PROFILE_SQL = `insert into public.household_profiles
  (household_id, age_groups, pets, work_hours, school_children,
   has_indoor_plants, has_balcony, has_ac, has_polishables)
 values ($1, $2::text[], $3, $4, $5, $6, $7, $8, $9)`;

describe("household_profiles RLS", () => {
  it("active owner can insert", async () => {
    await withTransaction(async (c) => {
      const { owner, householdId } = await newHousehold(c);
      await setJwtClaims(c, { sub: owner.clerk_user_id });
      const r = await c.query(INSERT_PROFILE_SQL, [
        householdId, ["adults"], "none", "mixed", "none_school_age",
        false, false, false, false,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("active maid can insert", async () => {
    await withTransaction(async (c) => {
      const { householdId } = await newHousehold(c);
      const maid = await newMember(c, householdId, "maid");
      await setJwtClaims(c, { sub: maid.clerk_user_id });
      const r = await c.query(INSERT_PROFILE_SQL, [
        householdId, ["adults"], "dog", "wfh", "none_school_age",
        true, false, true, false,
      ]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("family_member cannot write (RLS blocks)", async () => {
    await withTransaction(async (c) => {
      const { householdId } = await newHousehold(c);
      const fam = await newMember(c, householdId, "family_member");
      await setJwtClaims(c, { sub: fam.clerk_user_id });
      await expect(
        c.query(INSERT_PROFILE_SQL, [
          householdId, ["adults"], "none", "mixed", "none_school_age",
          false, false, false, false,
        ]),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("non-member cannot write", async () => {
    await withTransaction(async (c) => {
      const { householdId } = await newHousehold(c);
      const stranger = await insertProfile(c);  // no membership
      await setJwtClaims(c, { sub: stranger.clerk_user_id });
      await expect(
        c.query(INSERT_PROFILE_SQL, [
          householdId, ["adults"], "none", "mixed", "none_school_age",
          false, false, false, false,
        ]),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("rejects empty age_groups (check constraint)", async () => {
    await withTransaction(async (c) => {
      const { owner, householdId } = await newHousehold(c);
      await setJwtClaims(c, { sub: owner.clerk_user_id });
      await expect(
        c.query(INSERT_PROFILE_SQL, [
          householdId, [], "none", "mixed", "none_school_age",
          false, false, false, false,
        ]),
      ).rejects.toThrow(/check constraint|household_profiles_age_groups_check/);
    });
  });

  it("rejects invalid pets value", async () => {
    await withTransaction(async (c) => {
      const { owner, householdId } = await newHousehold(c);
      await setJwtClaims(c, { sub: owner.clerk_user_id });
      await expect(
        c.query(INSERT_PROFILE_SQL, [
          householdId, ["adults"], "unicorn", "mixed", "none_school_age",
          false, false, false, false,
        ]),
      ).rejects.toThrow(/check constraint|household_profiles_pets_check/);
    });
  });
});
```

- [ ] **Step 2: Run the test — must pass**

```bash
pnpm test tests/db/household-profiles.test.ts
```

Expected: 6/6 pass.

- [ ] **Step 3: Commit**

```bash
git add tests/db/household-profiles.test.ts
git commit -m "test(db): cover household_profiles RLS + check constraints"
```

---

### Task 3.2: Task relevance-filter test

**Files:**
- Create: `tests/db/task-relevance-filter.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/db/task-relevance-filter.test.ts
import { describe, it, expect } from "vitest";
import { withTransaction } from "../helpers/db";

/**
 * Queries the standard task library with the filter the picker uses.
 * `matchingTags` is the array produced by deriveMatchingTags(profile).
 */
async function fetchFilteredCount(c: import("pg").Client, matchingTags: string[]): Promise<number> {
  const r = await c.query<{ count: string }>(
    `select count(*) as count
       from public.tasks
      where household_id is null
        and (relevance_tags = '{}' or relevance_tags && $1::text[])`,
    [matchingTags],
  );
  return parseInt(r.rows[0].count, 10);
}

async function fetchUnfilteredCount(c: import("pg").Client): Promise<number> {
  const r = await c.query<{ count: string }>(
    `select count(*) as count from public.tasks where household_id is null`,
  );
  return parseInt(r.rows[0].count, 10);
}

describe("task relevance filter", () => {
  it("empty matching set still returns universal tasks", async () => {
    await withTransaction(async (c) => {
      // No need to set auth — standards are visible per existing tasks RLS.
      const filtered = await fetchFilteredCount(c, []);
      // All universal tasks should still appear (the `relevance_tags = '{}'` branch).
      expect(filtered).toBeGreaterThan(50);
    });
  });

  it("minimal profile (no pets, no school, no features) returns only universal + work + school:none + pets:none tagged", async () => {
    await withTransaction(async (c) => {
      const matchingTags = ["age:adults", "pets:none", "work:mixed", "school:none_school_age"];
      const filtered = await fetchFilteredCount(c, matchingTags);
      const all = await fetchUnfilteredCount(c);
      // Should be less than total — pet/child/feature tasks excluded.
      expect(filtered).toBeLessThan(all);
      // But should still include universals.
      expect(filtered).toBeGreaterThan(50);
    });
  });

  it("profile with dog pulls in dog tasks", async () => {
    await withTransaction(async (c) => {
      const without = await fetchFilteredCount(c, ["age:adults", "pets:none", "work:mixed", "school:none_school_age"]);
      const withDog  = await fetchFilteredCount(c, ["age:adults", "pets:dog",  "work:mixed", "school:none_school_age"]);
      expect(withDog).toBeGreaterThan(without);
    });
  });

  it("profile with infants pulls in baby tasks", async () => {
    await withTransaction(async (c) => {
      const without = await fetchFilteredCount(c, ["age:adults", "pets:none", "work:mixed", "school:none_school_age"]);
      const withInfants = await fetchFilteredCount(c, ["age:adults", "age:infants", "pets:none", "work:mixed", "school:none_school_age"]);
      expect(withInfants).toBeGreaterThan(without);
    });
  });

  it("profile with feature:balcony pulls in balcony tasks", async () => {
    await withTransaction(async (c) => {
      const without = await fetchFilteredCount(c, ["age:adults", "pets:none", "work:mixed", "school:none_school_age"]);
      const withBalcony = await fetchFilteredCount(c, ["age:adults", "pets:none", "work:mixed", "school:none_school_age", "feature:balcony"]);
      expect(withBalcony).toBe(without + 1);
    });
  });

  it("full-house profile (all answers yes) returns close to total", async () => {
    await withTransaction(async (c) => {
      const allTags = [
        "age:infants", "age:school_age", "age:teens", "age:adults", "age:seniors",
        "pets:dog", "pets:cat", "pets:other", "pets:multiple",
        "work:mixed",
        "school:all",
        "feature:plants", "feature:balcony", "feature:ac", "feature:polishables",
      ];
      const filtered = await fetchFilteredCount(c, allTags);
      const all = await fetchUnfilteredCount(c);
      // Should match nearly all tasks (excluding the few tagged for OTHER work/school options).
      expect(filtered).toBeGreaterThan(all - 5);
    });
  });
});
```

- [ ] **Step 2: Run the test — must pass**

```bash
pnpm test tests/db/task-relevance-filter.test.ts
```

Expected: 6/6 pass.

- [ ] **Step 3: Commit**

```bash
git add tests/db/task-relevance-filter.test.ts
git commit -m "test(db): cover task relevance filter against new seed"
```

---

## Phase 4 — Questionnaire page

### Task 4.1: Create the server-rendered questionnaire page

**Files:**
- Create: `src/app/onboarding/profile/page.tsx`

- [ ] **Step 1: Implement the server component**

```tsx
// src/app/onboarding/profile/page.tsx
import { redirect } from "next/navigation";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { TopAppBar } from "@/components/ui/top-app-bar";
import { ProfileForm } from "./profile-form";
import type { HouseholdProfile } from "@/lib/profile/types";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const ctx = await requireHousehold();
  if (ctx.household.maid_mode === "unset") redirect("/dashboard");

  const sp = await searchParams;
  const editMode = sp.edit === "1";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("household_profiles")
    .select("age_groups, pets, work_hours, school_children, has_indoor_plants, has_balcony, has_ac, has_polishables")
    .eq("household_id", ctx.household.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  // If profile exists and we're NOT editing, advance to picker.
  if (data && !editMode) redirect("/onboarding/tasks");

  const initial = (data ?? null) as HouseholdProfile | null;

  return (
    <main>
      <TopAppBar
        title="Set up your household"
        subtitle={editMode ? "Edit household profile" : "Step 1 of 2 — about your home (~30 seconds)"}
      />
      <ProfileForm initial={initial} editMode={editMode} />
    </main>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm typecheck 2>&1 | grep "src/app/onboarding/profile" || echo "no errors in profile page"
```

Expected: "no errors in profile page" (the `ProfileForm` import will error until Task 4.2 lands — that's expected).

- [ ] **Step 3: Commit (will fail typecheck until 4.2 — bundle into next commit instead)**

Skip commit; bundle with Task 4.2's commit since they're interdependent.

---

### Task 4.2: Create the client form component

**Files:**
- Create: `src/app/onboarding/profile/profile-form.tsx`

- [ ] **Step 1: Implement the client form**

```tsx
// src/app/onboarding/profile/profile-form.tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { saveProfileAction } from "./actions";
import type { AgeGroup, HouseholdProfile, Pets, SchoolChildren, WorkHours } from "@/lib/profile/types";

const AGE_OPTIONS: { value: AgeGroup; label: string }[] = [
  { value: "infants", label: "Infants / toddlers (0–3 years)" },
  { value: "school_age", label: "Young children (4–12 years)" },
  { value: "teens", label: "Teenagers (13–17 years)" },
  { value: "adults", label: "Adults (18–60 years)" },
  { value: "seniors", label: "Senior citizens (60+)" },
];
const PET_OPTIONS: { value: Pets; label: string }[] = [
  { value: "none", label: "No pets" },
  { value: "dog", label: "Dog(s)" },
  { value: "cat", label: "Cat(s)" },
  { value: "other", label: "Other pets" },
  { value: "multiple", label: "Multiple types" },
];
const WORK_OPTIONS: { value: WorkHours; label: string }[] = [
  { value: "wfh", label: "All work from home" },
  { value: "office", label: "All work outside (office / business)" },
  { value: "mixed", label: "Mixed (some home, some office)" },
  { value: "retired", label: "Retired / not working" },
];
const SCHOOL_OPTIONS: { value: SchoolChildren; label: string }[] = [
  { value: "all", label: "Yes, all school-age kids attend" },
  { value: "some", label: "Some attend, some don't" },
  { value: "homeschool", label: "Homeschooled" },
  { value: "none_school_age", label: "No school-age children" },
];
const FEATURE_OPTIONS: { key: keyof Pick<HouseholdProfile, "has_indoor_plants" | "has_balcony" | "has_ac" | "has_polishables">; label: string }[] = [
  { key: "has_indoor_plants", label: "Indoor plants" },
  { key: "has_balcony", label: "Balcony / terrace" },
  { key: "has_ac", label: "A/C units" },
  { key: "has_polishables", label: "Wooden / silverware / brass items to polish" },
];

type Props = {
  initial: HouseholdProfile | null;
  editMode: boolean;
};

export function ProfileForm({ initial, editMode }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>(initial?.age_groups ?? []);
  const [pets, setPets] = useState<Pets | "">(initial?.pets ?? "");
  const [work, setWork] = useState<WorkHours | "">(initial?.work_hours ?? "");
  const [school, setSchool] = useState<SchoolChildren | "">(initial?.school_children ?? "");
  const [features, setFeatures] = useState<{ [K in "has_indoor_plants" | "has_balcony" | "has_ac" | "has_polishables"]: boolean }>({
    has_indoor_plants: initial?.has_indoor_plants ?? false,
    has_balcony: initial?.has_balcony ?? false,
    has_ac: initial?.has_ac ?? false,
    has_polishables: initial?.has_polishables ?? false,
  });
  const [error, setError] = useState<string | null>(null);

  const valid =
    ageGroups.length > 0 &&
    pets !== "" &&
    work !== "" &&
    school !== "";

  function toggleAge(g: AgeGroup) {
    setAgeGroups(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  }
  function toggleFeature(k: keyof typeof features) {
    setFeatures(prev => ({ ...prev, [k]: !prev[k] }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setError(null);
    startTransition(async () => {
      const result = await saveProfileAction({
        age_groups: ageGroups,
        pets: pets as Pets,
        work_hours: work as WorkHours,
        school_children: school as SchoolChildren,
        ...features,
      }, editMode);
      if (result?.error) {
        setError(result.error);
        return;
      }
      router.push(editMode ? "/household/settings" : "/onboarding/tasks");
    });
  }

  const rowBase = "flex min-h-11 items-center gap-3 px-4 py-2.5 border-b border-border last:border-0 cursor-pointer hover:bg-surface-0";
  const rowSelected = "bg-primary-subtle";

  return (
    <form onSubmit={onSubmit} className="pb-32">
      <div className="px-4 py-6 space-y-7">

        {/* Q1: Who lives in your home? */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex w-[22px] h-[22px] items-center justify-center bg-primary-subtle text-primary text-[11.5px] font-semibold rounded">1</span>
            <h2 className="text-[15px] font-semibold text-text-primary">Who lives in your home?</h2>
          </div>
          <p className="text-[12px] text-text-muted mb-2 pl-[30px]">Select all that apply</p>
          <div className="bg-surface-1 border border-border rounded-md overflow-hidden">
            {AGE_OPTIONS.map(({ value, label }) => {
              const selected = ageGroups.includes(value);
              return (
                <label key={value} className={`${rowBase} ${selected ? rowSelected : ""}`}>
                  <input type="checkbox" checked={selected} onChange={() => toggleAge(value)} className="size-[18px] accent-primary" />
                  <span className="text-sm text-text-primary">{label}</span>
                </label>
              );
            })}
          </div>
        </section>

        {/* Q2: Pets */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex w-[22px] h-[22px] items-center justify-center bg-primary-subtle text-primary text-[11.5px] font-semibold rounded">2</span>
            <h2 className="text-[15px] font-semibold text-text-primary">Do you have pets?</h2>
          </div>
          <div className="bg-surface-1 border border-border rounded-md overflow-hidden">
            {PET_OPTIONS.map(({ value, label }) => {
              const selected = pets === value;
              return (
                <label key={value} className={`${rowBase} ${selected ? rowSelected : ""}`}>
                  <input type="radio" name="pets" checked={selected} onChange={() => setPets(value)} className="size-[18px] accent-primary" />
                  <span className="text-sm text-text-primary">{label}</span>
                </label>
              );
            })}
          </div>
        </section>

        {/* Q3: Working hours */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex w-[22px] h-[22px] items-center justify-center bg-primary-subtle text-primary text-[11.5px] font-semibold rounded">3</span>
            <h2 className="text-[15px] font-semibold text-text-primary">Working hours of adults</h2>
          </div>
          <div className="bg-surface-1 border border-border rounded-md overflow-hidden">
            {WORK_OPTIONS.map(({ value, label }) => {
              const selected = work === value;
              return (
                <label key={value} className={`${rowBase} ${selected ? rowSelected : ""}`}>
                  <input type="radio" name="work" checked={selected} onChange={() => setWork(value)} className="size-[18px] accent-primary" />
                  <span className="text-sm text-text-primary">{label}</span>
                </label>
              );
            })}
          </div>
        </section>

        {/* Q4: School-age children */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex w-[22px] h-[22px] items-center justify-center bg-primary-subtle text-primary text-[11.5px] font-semibold rounded">4</span>
            <h2 className="text-[15px] font-semibold text-text-primary">School-age children?</h2>
          </div>
          <div className="bg-surface-1 border border-border rounded-md overflow-hidden">
            {SCHOOL_OPTIONS.map(({ value, label }) => {
              const selected = school === value;
              return (
                <label key={value} className={`${rowBase} ${selected ? rowSelected : ""}`}>
                  <input type="radio" name="school" checked={selected} onChange={() => setSchool(value)} className="size-[18px] accent-primary" />
                  <span className="text-sm text-text-primary">{label}</span>
                </label>
              );
            })}
          </div>
        </section>

        {/* Q5: Home features */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex w-[22px] h-[22px] items-center justify-center bg-primary-subtle text-primary text-[11.5px] font-semibold rounded">5</span>
            <h2 className="text-[15px] font-semibold text-text-primary">What features does your home have?</h2>
          </div>
          <p className="text-[12px] text-text-muted mb-2 pl-[30px]">Select all that apply</p>
          <div className="bg-surface-1 border border-border rounded-md overflow-hidden">
            {FEATURE_OPTIONS.map(({ key, label }) => {
              const selected = features[key];
              return (
                <label key={key} className={`${rowBase} ${selected ? rowSelected : ""}`}>
                  <input type="checkbox" checked={selected} onChange={() => toggleFeature(key)} className="size-[18px] accent-primary" />
                  <span className="text-sm text-text-primary">{label}</span>
                </label>
              );
            })}
          </div>
        </section>

        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>

      <div className="fixed bottom-14 left-0 right-0 bg-surface-1 border-t border-border p-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <Button type="submit" disabled={!valid} loading={pending} className="w-full">
          {editMode ? "Save changes" : "Continue to task picker →"}
        </Button>
        <p className="text-[12px] text-text-muted text-center mt-1.5">You can change these later in Household settings.</p>
      </div>
    </form>
  );
}
```

(Note: `bottom-14` accounts for the root layout's `TabBar` at the bottom; the submit bar sits just above it.)

- [ ] **Step 2: Commit (bundled with Task 4.1)**

Skip commit; bundle with Task 4.3 once the server action lands.

---

### Task 4.3: Create the server action + commit Phase 4

**Files:**
- Create: `src/app/onboarding/profile/actions.ts`

- [ ] **Step 1: Implement**

```ts
// src/app/onboarding/profile/actions.ts
"use server";

import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { HouseholdProfile } from "@/lib/profile/types";

export async function saveProfileAction(
  payload: HouseholdProfile,
  editMode: boolean,
): Promise<{ error?: string }> {
  const ctx = await requireHousehold();
  if (ctx.household.maid_mode === "unset") {
    return { error: "Household not set up yet." };
  }

  if (payload.age_groups.length === 0) return { error: "Pick at least one age group." };

  const supabase = await createClient();

  const row = {
    household_id: ctx.household.id,
    age_groups: payload.age_groups,
    pets: payload.pets,
    work_hours: payload.work_hours,
    school_children: payload.school_children,
    has_indoor_plants: payload.has_indoor_plants,
    has_balcony: payload.has_balcony,
    has_ac: payload.has_ac,
    has_polishables: payload.has_polishables,
    completed_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("household_profiles")
    .upsert(row, { onConflict: "household_id" });

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  revalidatePath("/onboarding/tasks");
  revalidatePath("/household/settings");

  // editMode flag is honored by the form's redirect; nothing else to do here.
  return {};
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: clean.

- [ ] **Step 3: Smoke test (manual via dev server is optional; not required for automated execution)**

If running locally with a freshly-reset DB: sign in as an owner, navigate to `/onboarding/profile`, fill the 5 questions, submit. Should redirect to `/onboarding/tasks` (which will render a placeholder/error until Phase 5).

- [ ] **Step 4: Commit Phase 4 as one logical change**

```bash
git add src/app/onboarding/profile/
git commit -m "feat(onboarding): add household profile questionnaire page"
```

---

## Phase 5 — Picker refit

### Task 5.1: Refit the picker page server-side

**Files:**
- Modify: `src/app/onboarding/tasks/page.tsx`

- [ ] **Step 1: Replace the page**

Replace the contents of `src/app/onboarding/tasks/page.tsx` with:

```tsx
// src/app/onboarding/tasks/page.tsx
import { redirect } from "next/navigation";
import { requireHousehold } from "@/lib/auth/require";
import { createServiceClient } from "@/lib/supabase/server";
import { TopAppBar } from "@/components/ui/top-app-bar";
import { IconButton } from "@/components/ui/icon-button";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { deriveMatchingTags } from "@/lib/profile/matching-tags";
import { PickForm } from "./pick-form";
import type { HouseholdProfile } from "@/lib/profile/types";

export const dynamic = "force-dynamic";

export default async function OnboardingTasksPickPage() {
  const ctx = await requireHousehold();
  if (ctx.household.maid_mode === "unset") redirect("/dashboard");
  if (ctx.household.task_setup_completed_at !== null) redirect("/dashboard");

  const svc = createServiceClient();

  // Profile is required before this step.
  const profileRes = await svc
    .from("household_profiles")
    .select("age_groups, pets, work_hours, school_children, has_indoor_plants, has_balcony, has_ac, has_polishables")
    .eq("household_id", ctx.household.id)
    .maybeSingle();
  if (profileRes.error) throw new Error(profileRes.error.message);
  if (!profileRes.data) redirect("/onboarding/profile");

  const profile = profileRes.data as HouseholdProfile;
  const matchingTags = deriveMatchingTags(profile);

  // Fetch ALL standard tasks; partition client-side.
  const tasksRes = await svc
    .from("tasks")
    .select("id, title, recurrence_frequency, recurrence_interval, recurrence_byweekday, recurrence_bymonthday, due_time, relevance_tags")
    .is("household_id", null)
    .is("archived_at", null)
    .order("recurrence_frequency", { ascending: true })
    .order("recurrence_interval", { ascending: true })
    .order("recurrence_bymonthday", { ascending: true, nullsFirst: false })
    .order("due_time", { ascending: true, nullsFirst: false });
  if (tasksRes.error) throw new Error(tasksRes.error.message);

  const draftRes = await svc
    .from("task_setup_drafts")
    .select("picked_task_ids")
    .eq("household_id", ctx.household.id)
    .maybeSingle();
  if (draftRes.error && draftRes.error.code !== "PGRST116") {
    throw new Error(draftRes.error.message);
  }
  const initialPicks = draftRes.data?.picked_task_ids ?? null;

  return (
    <main>
      <TopAppBar
        title="Pick your tasks"
        subtitle="Step 2 of 2 — tap tasks you want; deselect what you don't"
        leading={
          <Link href="/onboarding/profile" aria-label="Back">
            <IconButton variant="ghost" aria-label="Back"><ChevronLeft /></IconButton>
          </Link>
        }
      />
      <PickForm
        tasks={tasksRes.data ?? []}
        matchingTags={matchingTags}
        profileSummary={renderProfileSummary(profile)}
        initialPicks={initialPicks}
      />
    </main>
  );
}

/** Tiny helper so the form can render the chip text without knowing the option labels. */
function renderProfileSummary(p: HouseholdProfile): string {
  const parts: string[] = [];
  if (p.age_groups.includes("infants")) parts.push("Infants");
  if (p.age_groups.includes("school_age")) parts.push("Young children");
  if (p.age_groups.includes("teens")) parts.push("Teens");
  if (p.age_groups.includes("seniors")) parts.push("Seniors");
  if (p.pets !== "none") parts.push(p.pets.charAt(0).toUpperCase() + p.pets.slice(1));
  if (p.has_indoor_plants) parts.push("Plants");
  if (p.has_balcony) parts.push("Balcony");
  if (p.has_ac) parts.push("A/C");
  if (p.has_polishables) parts.push("Polish");
  if (parts.length === 0) parts.push("Adults only");
  return parts.join(" · ");
}
```

- [ ] **Step 2: Verify typecheck (PickForm signature will mismatch — that's expected, Task 5.2 fixes)**

```bash
pnpm typecheck
```

Expect errors in `pick-form.tsx` reference; ignore for now.

- [ ] **Step 3: Commit when Task 5.2 lands together**

Skip commit; bundle with 5.2.

---

### Task 5.2: Refit the picker client form

**Files:**
- Modify: `src/app/onboarding/tasks/pick-form.tsx`

- [ ] **Step 1: Replace the file**

Replace `src/app/onboarding/tasks/pick-form.tsx` with:

```tsx
// src/app/onboarding/tasks/pick-form.tsx
"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { finalizePicksAction, saveDraftAction } from "./actions";

type TaskRow = {
  id: string;
  title: string;
  recurrence_frequency: "daily" | "weekly" | "monthly";
  recurrence_interval: number;
  recurrence_byweekday: number[] | null;
  recurrence_bymonthday: number | null;
  due_time: string | null;
  relevance_tags: string[];
};

type Props = {
  tasks: TaskRow[];
  matchingTags: string[];
  profileSummary: string;
  initialPicks: string[] | null;
};

const FREQ_LABEL_ORDER: { label: string; predicate: (t: TaskRow) => boolean }[] = [
  { label: "Daily", predicate: t => t.recurrence_frequency === "daily" && t.recurrence_interval === 1 },
  { label: "Every 2 days", predicate: t => t.recurrence_frequency === "daily" && t.recurrence_interval === 2 },
  { label: "Every 3 days", predicate: t => t.recurrence_frequency === "daily" && t.recurrence_interval === 3 },
  { label: "Weekly", predicate: t => t.recurrence_frequency === "weekly" && t.recurrence_interval === 1 },
  { label: "Bi-weekly", predicate: t => t.recurrence_frequency === "weekly" && t.recurrence_interval === 2 },
  { label: "Monthly", predicate: t => t.recurrence_frequency === "monthly" },
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtMeta(t: TaskRow): string {
  const time = t.due_time?.slice(0, 5) ?? "";
  if (t.recurrence_frequency === "weekly") {
    const days = (t.recurrence_byweekday ?? []).map(d => DAY_NAMES[d]).join(", ");
    return `${days} ${time}`.trim();
  }
  if (t.recurrence_frequency === "monthly") {
    return `Day ${t.recurrence_bymonthday} ${time}`.trim();
  }
  // daily
  if (t.recurrence_interval === 1) return `${time} daily`;
  return `${time} every ${t.recurrence_interval} days`;
}

function tagCategory(tags: string[]): string | null {
  if (tags.some(t => t.startsWith("pets:"))) return "pet";
  if (tags.some(t => t.startsWith("age:"))) return "age";
  if (tags.some(t => t.startsWith("school:"))) return "school";
  if (tags.some(t => t.startsWith("feature:"))) return "feature";
  return null;
}

function isMatched(task: TaskRow, matchingTags: string[]): boolean {
  if (task.relevance_tags.length === 0) return true;
  return task.relevance_tags.some(t => matchingTags.includes(t));
}

export function PickForm({ tasks, matchingTags, profileSummary, initialPicks }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { matched, unmatched } = useMemo(() => {
    const m: TaskRow[] = [];
    const u: TaskRow[] = [];
    for (const t of tasks) (isMatched(t, matchingTags) ? m : u).push(t);
    return { matched: m, unmatched: u };
  }, [tasks, matchingTags]);

  // Default: all matched picked; if a draft exists, honor it instead.
  const [picked, setPicked] = useState<Set<string>>(() => {
    if (initialPicks !== null) return new Set(initialPicks);
    return new Set(matched.map(t => t.id));
  });
  const [showAll, setShowAll] = useState(false);

  function toggle(id: string) {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Persist draft asynchronously; ignore errors here (best-effort).
      void saveDraftAction(Array.from(next));
      return next;
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await finalizePicksAction(Array.from(picked));
      if (result?.error) {
        // For brevity, dump to console; could surface inline in a future polish pass.
        console.error(result.error);
        return;
      }
      router.push("/dashboard");
    });
  }

  const matchedSections = FREQ_LABEL_ORDER.map(({ label, predicate }) => ({
    label,
    items: matched.filter(predicate),
  })).filter(s => s.items.length > 0);

  const unmatchedSections = FREQ_LABEL_ORDER.map(({ label, predicate }) => ({
    label,
    items: unmatched.filter(predicate),
  })).filter(s => s.items.length > 0);

  return (
    <form onSubmit={onSubmit} className="pb-32">

      {/* Profile chip */}
      <div className="mx-4 mt-3 bg-surface-1 border border-border rounded-md p-2.5 flex items-start gap-2.5">
        <span className="inline-flex w-6 h-6 items-center justify-center bg-primary-subtle text-primary rounded text-[11px] font-semibold flex-shrink-0">P</span>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-text-muted uppercase tracking-wider font-semibold">Filtering by your profile</div>
          <div className="text-[13px] text-text-primary mt-0.5">{profileSummary}</div>
        </div>
        <Link href="/onboarding/profile?edit=1" className="text-[12px] text-primary font-semibold self-center">Edit</Link>
      </div>

      {/* Count line */}
      <div className="px-4 pt-3 pb-1 text-[12px] text-text-muted">
        Showing <strong className="text-text-primary">{matched.length} of {tasks.length}</strong> tasks matched to your home
      </div>

      {/* Matched sections */}
      {matchedSections.map(({ label, items }) => (
        <Section key={label} label={label} items={items} picked={picked} onToggle={toggle} />
      ))}

      {/* Show more */}
      {unmatched.length > 0 && !showAll ? (
        <div className="mx-4 mt-5 bg-surface-1 border border-dashed border-border-strong rounded-md p-3.5 text-center cursor-pointer" onClick={() => setShowAll(true)}>
          <div className="text-primary text-[13px] font-semibold">Show {unmatched.length} more tasks (not matched to your profile)</div>
          <div className="text-[11.5px] text-text-muted mt-0.5">Tasks for pets/school/features you said no to</div>
        </div>
      ) : null}

      {showAll && unmatchedSections.map(({ label, items }) => (
        <Section key={`u-${label}`} label={label} items={items} picked={picked} onToggle={toggle} dimmed />
      ))}

      {/* Submit bar */}
      <div className="fixed bottom-14 left-0 right-0 bg-surface-1 border-t border-border p-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <Button type="submit" loading={pending} className="w-full">
          Done · Set up {picked.size} tasks
        </Button>
        <p className="text-[12px] text-text-muted text-center mt-1.5">You can add/remove tasks later in Tasks settings.</p>
      </div>
    </form>
  );
}

function Section({
  label,
  items,
  picked,
  onToggle,
  dimmed = false,
}: {
  label: string;
  items: TaskRow[];
  picked: Set<string>;
  onToggle: (id: string) => void;
  dimmed?: boolean;
}) {
  return (
    <div className="px-4 mt-4">
      <div className={`text-[11px] uppercase tracking-wider font-semibold mb-1.5 ${dimmed ? "text-text-disabled" : "text-text-muted"}`}>{label}</div>
      <div className="bg-surface-1 border border-border rounded-md overflow-hidden">
        {items.map(t => {
          const isPicked = picked.has(t.id);
          const cat = tagCategory(t.relevance_tags);
          return (
            <label key={t.id} className="flex items-center gap-3 px-3.5 py-2.5 border-b border-border last:border-0 min-h-14 cursor-pointer hover:bg-surface-0">
              <input type="checkbox" checked={isPicked} onChange={() => onToggle(t.id)} className="size-[18px] accent-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary font-medium flex items-center gap-1.5">
                  <span className="truncate">{t.title}</span>
                  {cat ? <span className="inline-flex items-center px-1.5 py-0.5 bg-primary-subtle text-primary text-[10.5px] font-semibold rounded-full flex-shrink-0">{cat}</span> : null}
                </div>
                <div className="text-[12px] text-text-muted tabular-nums">{fmtMeta(t)}</div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit (bundled with 5.1 + 5.3)**

Skip commit; bundle with 5.3 once actions land.

---

### Task 5.3: Update the picker server actions

**Files:**
- Modify: `src/app/onboarding/tasks/actions.ts`

- [ ] **Step 1: Read current actions file to preserve helpers**

```bash
cat src/app/onboarding/tasks/actions.ts
```

Expected: has `saveDraftAction` and `finalizePicksAction` already; uses `requireHousehold`; the latter inserts tasks into `tasks` table and sets `task_setup_completed_at`.

- [ ] **Step 2: Drop ALL owner-only checks from this file**

In `src/app/onboarding/tasks/actions.ts`, find every line matching:

```ts
if (ctx.membership.role !== "owner") throw new Error("only the owner can …");
```

There are **3** of them today (`saveDraftAction`, `finalizePicksAction`, `resetTaskSetupForEmptyState`). **Delete all three.** Verify with:

```bash
grep -c "role.*!== \"owner\"" src/app/onboarding/tasks/actions.ts
```

Expected after deletion: `0`.

All three actions become role-agnostic. RLS on `tasks` / `task_setup_drafts` still enforces "owner OR maid only" — already covered. The action bodies (insert into tasks, flip `task_setup_completed_at`, reset state) work as-is against the new seed library; only the role checks change.

- [ ] **Step 3: Verify typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: clean.

- [ ] **Step 4: Run picker-related tests if they exist**

```bash
pnpm test tests/actions/onboarding-tasks 2>&1 | tail -20 || echo "no picker action tests"
```

If existing tests assert on owner-only behavior, update them to expect either-role behavior.

- [ ] **Step 5: Commit Phase 5 as one logical change**

```bash
git add src/app/onboarding/tasks/page.tsx \
        src/app/onboarding/tasks/pick-form.tsx \
        src/app/onboarding/tasks/actions.ts
git commit -m "refactor(onboarding): refit picker with profile chip + filter + show-more (either-role)"
```

---

## Phase 6 — Integration

### Task 6.1: Delete the task-setup-waiting card

**Files:**
- Delete: `src/components/site/task-setup-waiting-card.tsx`
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Remove the dashboard usage**

In `src/app/dashboard/page.tsx`:

1. Remove the import:
   ```tsx
   import { TaskSetupWaitingCard } from "@/components/site/task-setup-waiting-card";
   ```
2. Remove the JSX rendering it (line ~352-353 area):
   ```tsx
   {showTaskSetupWaitingCard ? <TaskSetupWaitingCard /> : null}
   ```
3. Remove the computation of `showTaskSetupWaitingCard`.

- [ ] **Step 2: Delete the file**

```bash
rm src/components/site/task-setup-waiting-card.tsx
```

- [ ] **Step 3: Verify no other references**

```bash
grep -rn "task-setup-waiting-card\|TaskSetupWaitingCard" src/
```

Expected: empty.

- [ ] **Step 4: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add -A src/components/site/task-setup-waiting-card.tsx src/app/dashboard/page.tsx
git commit -m "refactor(dashboard): delete task-setup-waiting-card (either-role now drives setup)"
```

---

### Task 6.2: Update dashboard prompt-card logic for profile-pending state

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/components/site/task-setup-prompt-card.tsx`

- [ ] **Step 1: Update task-setup-prompt-card variants**

Replace `src/components/site/task-setup-prompt-card.tsx` with:

```tsx
// src/components/site/task-setup-prompt-card.tsx
import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resetTaskSetupForEmptyState } from "@/app/onboarding/tasks/actions";

type Variant = "profile" | "picker" | "rerun";

const COPY: Record<Variant, { title: string; body: string; cta: string; href: string; isLink: boolean }> = {
  profile: {
    title: "Set up your household",
    body: "5 quick questions so the task picker only shows what fits your home.",
    cta: "Set up profile →",
    href: "/onboarding/profile",
    isLink: true,
  },
  picker: {
    title: "Pick your tasks",
    body: "Choose the chores that apply.",
    cta: "Pick tasks →",
    href: "/onboarding/tasks",
    isLink: true,
  },
  rerun: {
    title: "No tasks yet",
    body: "Your task list is empty. Re-run setup to pick from the standard list.",
    cta: "Re-run setup →",
    href: "",          // action form, no href
    isLink: false,
  },
};

export function TaskSetupPromptCard({ variant = "picker" }: { variant?: Variant }) {
  const copy = COPY[variant];
  return (
    <Banner
      tone="info"
      title={copy.title}
      action={
        copy.isLink ? (
          <Link href={copy.href} className={cn(buttonVariants({ size: "sm" }))}>
            {copy.cta}
          </Link>
        ) : (
          <form action={resetTaskSetupForEmptyState}>
            <Button type="submit" size="sm">{copy.cta}</Button>
          </form>
        )
      }
    >
      {copy.body}
    </Banner>
  );
}
```

(Note: variant `"initial"` from before is renamed `"picker"`. Variant `"profile"` is new. The dashboard wiring in step 2 updates call sites accordingly.)

- [ ] **Step 2: Update dashboard logic**

In `src/app/dashboard/page.tsx`, replace the existing `showTaskSetupPromptCard`/`showTaskSetupRerunCard` computation block with:

```tsx
// Replace the old showTaskSetupPromptCard / showTaskSetupRerunCard logic with:
const setupCompleted = ctx.household.task_setup_completed_at !== null;

// Profile presence check
const profileRes = await supabase
  .from("household_profiles")
  .select("household_id", { count: "exact", head: true })
  .eq("household_id", ctx.household.id);
if (profileRes.error) throw new Error(profileRes.error.message);
const profileExists = (profileRes.count ?? 0) > 0;

const showProfilePromptCard =
  ctx.household.maid_mode !== "unset" &&
  !profileExists;

const showTaskSetupPromptCard =
  ctx.household.maid_mode !== "unset" &&
  profileExists &&
  !setupCompleted;

// Recovery (unchanged condition shape, but role gate dropped)
let showTaskSetupRerunCard = false;
if (setupCompleted) {
  const { count, error } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("household_id", ctx.household.id);
  if (error) throw new Error(error.message);
  showTaskSetupRerunCard = (count ?? 0) === 0;
}
```

And in the JSX where these cards render:

```tsx
{showProfilePromptCard ? <TaskSetupPromptCard variant="profile" /> : null}
{showTaskSetupPromptCard ? <TaskSetupPromptCard variant="picker" /> : null}
{showTaskSetupRerunCard ? <TaskSetupPromptCard variant="rerun" /> : null}
```

(Note: the `supabase` variable already exists earlier in the page from the inventory-card block — reuse it. If you find the call placement makes the page hard to read, factor the profile-check into the existing gate block.)

- [ ] **Step 3: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/page.tsx src/components/site/task-setup-prompt-card.tsx
git commit -m "feat(dashboard): split profile-pending vs picker-pending prompt cards"
```

---

### Task 6.3: Add Household Profile section to settings page

**Files:**
- Modify: `src/app/household/settings/page.tsx`

- [ ] **Step 1: Read current settings page**

```bash
cat src/app/household/settings/page.tsx | head -80
```

- [ ] **Step 2: Add the section**

In `src/app/household/settings/page.tsx`, find a good location (probably near the top of the main content area, after the page header). Add:

```tsx
import { Banner } from "@/components/ui/banner";
import Link from "next/link";
// (these imports may already exist)

// In the JSX, somewhere visible:
<section className="mb-6">
  <h2 className="text-[15px] font-semibold text-text-primary mb-2 px-4">Household profile</h2>
  <div className="px-4">
    <Banner
      tone="neutral"
      title="About your home"
      action={
        <Link href="/onboarding/profile?edit=1" className="text-primary font-semibold text-sm">
          Update →
        </Link>
      }
    >
      Who lives here, pets, work hours, and home features — used to filter task suggestions.
    </Banner>
  </div>
</section>
```

Adjust the surrounding spacing/structure to match the existing settings page conventions.

- [ ] **Step 3: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add src/app/household/settings/page.tsx
git commit -m "feat(settings): add Household profile section linking to questionnaire edit"
```

---

### Task 6.4: Delete tune subdirectory

**Files:**
- Delete: `src/app/onboarding/tasks/tune/` (entire directory)

- [ ] **Step 1: Verify no callers reference tune**

```bash
grep -rn "/onboarding/tasks/tune" src/
```

Expected: empty (or only the tune directory itself).

- [ ] **Step 2: Delete the directory**

```bash
rm -rf src/app/onboarding/tasks/tune
```

- [ ] **Step 3: Typecheck + build**

```bash
pnpm typecheck && pnpm build
```

Expected: clean; the route is gone from the route table.

- [ ] **Step 4: Commit**

```bash
git add -A src/app/onboarding/tasks/tune
git commit -m "refactor(onboarding): delete tune step (pre-seeded times serve as defaults)"
```

---

## Phase 7 — Re-baseline broken existing tests

### Task 7.1: Update existing DB tests broken by new seed shape

**Files:** Whatever `pnpm test` reveals.

- [ ] **Step 1: Run the full test suite to identify breakage**

```bash
pnpm test 2>&1 | tee /tmp/onboarding-redesign-test-output.txt
```

Expected: passes EXCEPT possibly for:
- `tests/db/mealplan-autofill.test.ts` etc. — may have been already-broken pre-existing failures unrelated to this work (carry-over from main).
- Any test that hardcoded the old 13-task seed shape (e.g., expected specific task titles or counts).

- [ ] **Step 2: For each test broken by THIS work**, update the test to work against the new ~98-task seed.

Common patterns:
- A test that does `select count(*) from tasks where household_id is null` and expects 13 → update to expect 95-110.
- A test that inserts a household task by referring to "Wash dishes after dinner" → update to use "Wash dishes — dinner".
- A test that selects all tasks then iterates → update to handle the new task titles, OR change the selection to be by ID rather than title.

For each fix:

```bash
pnpm test <failing-test-file>
```

- [ ] **Step 3: Pre-existing failures (those that fail on `origin/main` too) — leave alone**

Use:
```bash
git stash
pnpm test <test-file>
git stash pop
```

to confirm if a failure is pre-existing.

- [ ] **Step 4: Commit batched fixes**

```bash
git add tests/
git commit -m "test(db): re-baseline against new ~98-task seed library"
```

---

## Phase 8 — Final verification

### Task 8.1: Full suite + lint + build + manual smoke pointer

**Files:** none.

- [ ] **Step 1: Run everything**

```bash
pnpm test && pnpm lint && pnpm typecheck && pnpm build
```

Expected:
- `pnpm test`: passes except for pre-existing DB test failures from main (verified separately in Task 7.1).
- `pnpm lint`: clean.
- `pnpm typecheck`: only pre-existing eslint-rules-test noise.
- `pnpm build`: succeeds with `/onboarding/profile` in the route list.

- [ ] **Step 2: Check route list**

```bash
pnpm build 2>&1 | grep -E "/onboarding/(profile|tasks)"
```

Expected: `/onboarding/profile` and `/onboarding/tasks` both appear. `/onboarding/tasks/tune` does NOT appear (deleted).

- [ ] **Step 3: Tell the user to test locally**

The branch is ready for manual UX validation. Suggest the user:

1. `pnpm db:reset` (apply migration cleanly to local DB).
2. `pnpm dev`, sign in as an owner, navigate to `/dashboard`.
3. Confirm the "Set up your household" banner appears.
4. Fill the questionnaire, submit, land on the picker.
5. Verify the profile chip shows their answers, the matched count + show-more behavior works.
6. Submit picks, return to dashboard, confirm tasks generate.
7. Repeat as a maid (separate account) to confirm either-role works.

- [ ] **Step 4: Final commit (if any tweaks needed during step 3 surfacing)**

```bash
git status   # if dirty, commit; if clean, no-op
git log --oneline ce1d9bc..HEAD
```

Expected log: ~12 commits since the spec commit (`ce1d9bc`), one per task above.

---

## Notes for the engineer

- **Frequent commits** — one per task, bundled where the spec marks "skip commit; bundle with Task X.Y".
- **TDD** — Phase 2 + 3 establish failing tests before implementation. Phase 4-6 are UI plumbing where pre-test is awkward; trust typecheck + lint + manual smoke.
- **`tasks.relevance_tags` filter semantics** — universal tasks (`'{}'`) ALWAYS match. Tagged tasks match if ANY tag intersects with the user's tag set. `pets:multiple` profile expands to imply `pets:dog`, `pets:cat`, `pets:other` (handled in `deriveMatchingTags`, not in DB).
- **Server-side fetch-all + client-side partition** (spec deviation): Task 5.1 fetches ALL standard tasks server-side (no `&&` predicate) and Task 5.2's `PickForm` partitions matched-vs-unmatched client-side via `deriveMatchingTags` + `isMatched`. The spec described "Re-fetches via the same query without the predicate" on Show-more click. The deviation is intentional: ~100 task rows is small, one query is simpler than fetch-on-click, and the user-perceived behavior ("Show more" reveals additional tasks) is identical. If the library grows past ~500 rows, revisit.
- **Draft state** — `task_setup_drafts` table is preserved. The new picker still saves picks to it on every toggle so a refresh/back doesn't lose state.
- **No push, no merge.** The user explicitly asked to keep this branch local. After Task 8.1 the branch is in a verified-locally state, awaiting their decision.
