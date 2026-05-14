-- Slice 3 auto-allocation — one-time cleanup of orphan null-recipe meal_plan rows.
-- These predate slice 3's auto-fill flow. They have no useful data:
--   recipe_id IS NULL  → no meal planned
--   people_eating IS NULL  → not a slice-2 people-eating override
--   cooked_at IS NULL AND deduction_status = 'pending'  → cron sweep hasn't touched it
--
-- After this migration the auto-fill RPC's conditional upsert can safely
-- INSERT a fresh row OR UPDATE an existing null-recipe override row.

delete from public.meal_plans
where recipe_id is null
  and people_eating is null
  and cooked_at is null
  and deduction_status = 'pending';
