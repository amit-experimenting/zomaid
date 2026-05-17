-- When the household-level diet preference or a member's preference
-- changes, existing meal_plans rows are not automatically refreshed.
-- The dashboard reads meal_plans directly and joins to recipes, so a
-- previously-chosen non-veg recipe keeps showing up even after the
-- household flips to vegetarian.
--
-- This helper nulls the recipe_id on today-or-future slots whose
-- recipe no longer satisfies the household's effective diet, leaving
-- locked and already-cooked slots alone. Callers should re-run
-- mealplan_autofill_date_for_household afterwards to repopulate the
-- freshly-cleared rows from the eligible pool.

create or replace function public.mealplan_clear_diet_violations(p_household uuid)
  returns int
  language plpgsql security definer
  set search_path = public
  as $$
  declare
    v_count int;
    v_effective public.diet;
    v_today date := (now() at time zone 'Asia/Singapore')::date;
  begin
    v_effective := public.household_effective_diet(p_household);

    update public.meal_plans mp
       set recipe_id         = null,
           set_by_profile_id = null
      from public.recipes r
     where mp.household_id = p_household
       and mp.plan_date   >= v_today
       and mp.recipe_id    = r.id
       and mp.cooked_at is null
       and not public.is_meal_slot_locked(p_household, mp.plan_date, mp.slot)
       and case
             when v_effective = 'non_vegetarian' then false
             when v_effective = 'eggitarian'    then r.diet not in ('vegan','vegetarian','eggitarian')
             when v_effective = 'vegetarian'    then r.diet not in ('vegan','vegetarian')
             when v_effective = 'vegan'         then r.diet <> 'vegan'
             else false
           end;
    get diagnostics v_count = row_count;
    return v_count;
  end;
  $$;

revoke execute on function public.mealplan_clear_diet_violations(uuid) from public;
grant  execute on function public.mealplan_clear_diet_violations(uuid) to postgres, service_role;

-- The diet-change action (server-side, service-role) needs to refill the
-- cleared slots immediately so users aren't left staring at blank meal
-- cards until the 22:00 cron. The function was previously granted only to
-- postgres; extend it to service_role for the same reason.
grant execute on function public.mealplan_autofill_date_for_household(uuid, date) to service_role;
