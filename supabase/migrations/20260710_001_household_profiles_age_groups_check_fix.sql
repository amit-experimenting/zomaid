-- supabase/migrations/20260710_001_household_profiles_age_groups_check_fix.sql
-- 2026-05-17 — Fix age_groups non-empty check.
--
-- The original constraint used `array_length(age_groups, 1) >= 1`, which is
-- NULL for empty arrays (Postgres returns NULL from array_length on a 0-length
-- dimension). Check constraints pass on NULL, so empty arrays slipped through.
-- Use cardinality() instead — it returns 0 for empty arrays.

alter table public.household_profiles
  drop constraint household_profiles_age_groups_check;

alter table public.household_profiles
  add constraint household_profiles_age_groups_check check (
    cardinality(age_groups) >= 1
    and age_groups <@ array['infants','school_age','teens','adults','seniors']
  );
