-- supabase/migrations/20260709_001_household_profile_v2.sql
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
