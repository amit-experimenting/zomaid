-- Slice 2 inventory — adds people_eating override RPC and lock checks on
-- mealplan_set_slot + mealplan_regenerate_slot.

-- Helper: check whether a (date, slot) is past its lock window for the household.
create or replace function public.is_meal_slot_locked(p_household uuid, p_date date, p_slot public.meal_slot)
  returns boolean
  language sql stable security invoker
  set search_path = public
  as $$
    select
      case
        when (select meal_time from public.household_meal_times where household_id = p_household and slot = p_slot) is null
        then false
        else now() >= (p_date::timestamp + (select meal_time from public.household_meal_times where household_id = p_household and slot = p_slot)) - interval '1 hour'
      end;
  $$;

grant execute on function public.is_meal_slot_locked(uuid, date, public.meal_slot) to authenticated;

-- New RPC: set people_eating override per slot.
create or replace function public.mealplan_set_people_eating(
  p_date    date,
  p_slot    public.meal_slot,
  p_people  int
) returns public.meal_plans
  language plpgsql security invoker
  set search_path = public
  as $$
  declare
    v_household uuid := public.current_household_id_for_caller();
    v_profile   uuid := public.current_profile_id();
    v_row       public.meal_plans;
  begin
    if v_household is null then
      raise exception 'no active household' using errcode = 'P0001';
    end if;
    if not public.can_modify_meal_plan(v_household) then
      raise exception 'permission denied' using errcode = 'P0001';
    end if;
    if public.is_meal_slot_locked(v_household, p_date, p_slot) then
      raise exception 'cannot_modify_after_lock' using errcode = 'P0001';
    end if;

    insert into public.meal_plans
      (household_id, plan_date, slot, recipe_id, set_by_profile_id, people_eating)
    values (v_household, p_date, p_slot, null, v_profile, p_people)
    on conflict (household_id, plan_date, slot) do update
      set people_eating = excluded.people_eating
    returning * into v_row;
    return v_row;
  end;
  $$;

grant execute on function public.mealplan_set_people_eating(date, public.meal_slot, int) to authenticated;

-- Patch existing mealplan_set_slot with the lock check (added before the upsert).
create or replace function public.mealplan_set_slot(
  p_date     date,
  p_slot     public.meal_slot,
  p_recipe_id uuid
) returns public.meal_plans
  language plpgsql security invoker
  set search_path = public
  as $$
  declare
    v_household uuid := public.current_household_id_for_caller();
    v_profile   uuid := public.current_profile_id();
    v_row       public.meal_plans;
  begin
    if v_household is null then
      raise exception 'no active household' using errcode = 'P0001';
    end if;
    if public.is_meal_slot_locked(v_household, p_date, p_slot) then
      raise exception 'cannot_modify_after_lock' using errcode = 'P0001';
    end if;
    insert into public.meal_plans
      (household_id, plan_date, slot, recipe_id, set_by_profile_id)
    values (v_household, p_date, p_slot, p_recipe_id, v_profile)
    on conflict (household_id, plan_date, slot) do update
      set recipe_id         = excluded.recipe_id,
          set_by_profile_id = excluded.set_by_profile_id
    returning * into v_row;
    return v_row;
  end;
  $$;

-- Patch mealplan_regenerate_slot with the same lock check.
create or replace function public.mealplan_regenerate_slot(
  p_date date,
  p_slot public.meal_slot
) returns public.meal_plans
  language plpgsql security invoker
  set search_path = public
  as $$
  declare
    v_household uuid := public.current_household_id_for_caller();
    v_profile   uuid := public.current_profile_id();
    v_recipe    uuid;
    v_row       public.meal_plans;
  begin
    if v_household is null then
      raise exception 'no active household' using errcode = 'P0001';
    end if;
    if public.is_meal_slot_locked(v_household, p_date, p_slot) then
      raise exception 'cannot_modify_after_lock' using errcode = 'P0001';
    end if;

    select id into v_recipe
    from public.effective_recipes(v_household) r
    where r.slot = p_slot
      and r.id not in (
        select recipe_id from public.meal_plans
        where household_id = v_household
          and slot = p_slot
          and plan_date between p_date - 4 and p_date - 1
          and recipe_id is not null
      )
    order by random()
    limit 1;
    if v_recipe is null then
      select id into v_recipe
      from public.effective_recipes(v_household) r
      where r.slot = p_slot
      order by random()
      limit 1;
    end if;

    insert into public.meal_plans
      (household_id, plan_date, slot, recipe_id, set_by_profile_id)
    values (v_household, p_date, p_slot, v_recipe, v_profile)
    on conflict (household_id, plan_date, slot) do update
      set recipe_id         = excluded.recipe_id,
          set_by_profile_id = excluded.set_by_profile_id
    returning * into v_row;
    return v_row;
  end;
  $$;
