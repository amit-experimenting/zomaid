-- One-shot backfill for the bug fixed in 20260712_001/_002. Existing
-- meal_plans rows created before those migrations may have recipes that
-- violate the household's current diet preference (e.g. a household that
-- flipped to vegetarian still showed Mutton Rogan Josh in tonight's slot).
-- The clear/autofill helpers only ran on subsequent diet changes; this
-- block walks every household with a preference set today and reconciles
-- their non-locked, non-cooked slots.

do $$
declare
  v_household uuid;
  v_today date := (now() at time zone 'Asia/Singapore')::date;
  v_tomorrow date := v_today + 1;
begin
  for v_household in
    select id from public.households
    where public.household_has_diet_preference(id)
  loop
    perform public.mealplan_clear_diet_violations(v_household);
    perform public.mealplan_autofill_date_for_household(v_household, v_today);
    perform public.mealplan_autofill_date_for_household(v_household, v_tomorrow);
  end loop;
end;
$$;
