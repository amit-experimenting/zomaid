-- Slice 2 inventory — periodic sweep that calls inventory_cook_deduct
-- for any meal whose lock window has passed.
--
-- Lock window = next slot's meal_time minus 1 hour. For dinner (last slot),
-- end-of-day (23:59 same date) substitutes.
--
-- The sweep limits itself to plan_date between current_date - 2 and current_date
-- to keep its work bounded; older missed meals can be processed manually by an
-- owner via the UI if needed.

create or replace function public.inventory_sweep_due_meals()
  returns int
  language plpgsql security definer
  set search_path = public
  as $$
  declare
    v_row record;
    v_processed int := 0;
    v_meal_time time;
    v_next_meal_time time;
    v_meal_dt timestamptz;
    v_window_start timestamptz;
  begin
    for v_row in
      select m.id, m.household_id, m.plan_date, m.slot
        from public.meal_plans m
        where m.deduction_status = 'pending'
          and m.plan_date between current_date - 2 and current_date
    loop
      select meal_time into v_meal_time
        from public.household_meal_times
        where household_id = v_row.household_id and slot = v_row.slot;
      if v_meal_time is null then continue; end if;

      v_next_meal_time := case v_row.slot
        when 'breakfast' then (select meal_time from public.household_meal_times where household_id = v_row.household_id and slot = 'lunch')
        when 'lunch'     then (select meal_time from public.household_meal_times where household_id = v_row.household_id and slot = 'snacks')
        when 'snacks'    then (select meal_time from public.household_meal_times where household_id = v_row.household_id and slot = 'dinner')
        when 'dinner'    then '23:59'::time
      end;
      if v_next_meal_time is null then continue; end if;

      v_meal_dt := (v_row.plan_date::timestamp + v_next_meal_time);
      v_window_start := v_meal_dt - interval '1 hour';

      if now() >= v_window_start then
        perform public.inventory_cook_deduct(v_row.id);
        v_processed := v_processed + 1;
      end if;
    end loop;

    return v_processed;
  end;
  $$;

revoke execute on function public.inventory_sweep_due_meals() from public;
grant  execute on function public.inventory_sweep_due_meals() to postgres;

-- Schedule the sweep every 15 minutes.
create extension if not exists pg_cron;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'inventory-sweep') then
    perform cron.unschedule('inventory-sweep');
  end if;
  perform cron.schedule(
    'inventory-sweep',
    '*/15 * * * *',
    $cmd$ select public.inventory_sweep_due_meals(); $cmd$
  );
end $$;
