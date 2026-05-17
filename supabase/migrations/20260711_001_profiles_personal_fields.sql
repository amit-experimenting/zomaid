-- Personal-profile fields collected during maid onboarding. All nullable.
-- onboarding_completed_at: NULL = "show onboarding when the gate fires";
-- set = "user has been through the flow and continued."
-- Per spec: no backfill — existing maids must pass through the new form on
-- next visit. Owners are protected by a role-scoped gate, not by data.

alter table public.profiles
  add column passport_number       text,
  add column passport_expiry       date,
  add column preferred_language    text,
  add column onboarding_completed_at timestamptz;
