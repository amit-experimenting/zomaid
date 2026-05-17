-- Product rule: a household must explicitly set a diet preference (either
-- the household-level override or at least one non-maid member preference)
-- before any meal plan is generated. The dashboard surfaces a "set up your
-- family's diet preference" CTA in the unset case; this migration enforces
-- the same gate server-side so the 22:00 cron, manual regenerate, and
-- service-role refills all respect it.

create or replace function public.household_has_diet_preference(p_household uuid)
  returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select coalesce(
      (select diet_preference is not null from public.households where id = p_household),
      false
    ) or exists (
      select 1 from public.household_memberships
        where household_id = p_household
          and status = 'active'
          and role <> 'maid'
          and diet_preference is not null
    );
  $$;

grant execute on function public.household_has_diet_preference(uuid) to authenticated, service_role;

-- Re-issue mealplan_autofill_date_for_household so it short-circuits when
-- the household has no diet preference set. The body is otherwise byte-for-
-- byte identical to 20260620_001's version.
create or replace function public.mealplan_autofill_date_for_household(
  p_household uuid,
  p_date      date
) returns int
  language plpgsql security definer
  set search_path = public
  as $$
  declare
    v_slot       public.meal_slot;
    v_filled     int := 0;
    v_existing   public.meal_plans;
    v_people     int;
    v_chosen     uuid;
    v_rows       int;
  begin
    if not public.household_has_diet_preference(p_household) then
      return 0;
    end if;

    foreach v_slot in array array['breakfast','lunch','snacks','dinner']::public.meal_slot[]
    loop
      if public.is_meal_slot_locked(p_household, p_date, v_slot) then
        continue;
      end if;

      select * into v_existing from public.meal_plans
        where household_id = p_household and plan_date = p_date and slot = v_slot;
      if v_existing.id is not null and (v_existing.recipe_id is not null or v_existing.cooked_at is not null) then
        continue;
      end if;

      v_people := coalesce(v_existing.people_eating, public.household_roster_size(p_household));
      if v_people is null or v_people < 1 then
        v_people := 1;
      end if;

      with eligible as (
        select er.id, er.name
          from public.effective_recipes(p_household) er
          where er.slot = v_slot
            and er.id not in (
              select recipe_id
                from public.meal_plans
                where household_id = p_household
                  and slot = v_slot
                  and plan_date between p_date - 4 and p_date - 1
                  and recipe_id is not null
            )
      ),
      scored as (
        select id, public.mealplan_recipe_stock_score(p_household, id, v_people) as score
          from eligible
      )
      select case
        when (select max(score) from scored) >= 0.5
          then (select id from scored where score = (select max(score) from scored) order by random() limit 1)
        when exists (select 1 from scored)
          then (select id from scored order by random() limit 1)
        else null
        end
      into v_chosen;

      if v_chosen is null then
        continue;
      end if;

      insert into public.meal_plans
        (household_id, plan_date, slot, recipe_id, set_by_profile_id)
      values (p_household, p_date, v_slot, v_chosen, null)
      on conflict (household_id, plan_date, slot) do update
        set recipe_id = excluded.recipe_id
        where meal_plans.recipe_id is null
          and meal_plans.cooked_at is null;

      get diagnostics v_rows = row_count;
      v_filled := v_filled + v_rows;
    end loop;

    return v_filled;
  end;
  $$;

revoke execute on function public.mealplan_autofill_date_for_household(uuid, date) from public;
grant  execute on function public.mealplan_autofill_date_for_household(uuid, date) to postgres, service_role;

-- Re-issue mealplan_regenerate_slot with the same gate. The manual user flow
-- ("regenerate this slot") would otherwise produce a recipe based on the
-- non_vegetarian fallback. Raise a structured error so the UI can surface it.
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
    v_existing  public.meal_plans;
    v_people    int;
    v_chosen    uuid;
    v_row       public.meal_plans;
  begin
    if v_household is null then
      raise exception 'no active household' using errcode = 'P0001';
    end if;
    if public.is_meal_slot_locked(v_household, p_date, p_slot) then
      raise exception 'cannot_modify_after_lock' using errcode = 'P0001';
    end if;
    if not public.household_has_diet_preference(v_household) then
      raise exception 'diet_preference_required' using errcode = 'P0001';
    end if;

    select * into v_existing from public.meal_plans
      where household_id = v_household and plan_date = p_date and slot = p_slot;
    v_people := coalesce(v_existing.people_eating, public.household_roster_size(v_household));
    if v_people is null or v_people < 1 then
      v_people := 1;
    end if;

    with eligible as (
      select er.id, er.name
        from public.effective_recipes(v_household) er
        where er.slot = p_slot
          and er.id not in (
            select recipe_id from public.meal_plans
              where household_id = v_household
                and slot = p_slot
                and plan_date between p_date - 4 and p_date - 1
                and recipe_id is not null
          )
    ),
    scored as (
      select id, public.mealplan_recipe_stock_score(v_household, id, v_people) as score
        from eligible
    )
    select case
      when (select max(score) from scored) >= 0.5
        then (select id from scored where score = (select max(score) from scored) order by random() limit 1)
      when exists (select 1 from scored)
        then (select id from scored order by random() limit 1)
      else null
      end
    into v_chosen;

    insert into public.meal_plans
      (household_id, plan_date, slot, recipe_id, set_by_profile_id)
    values (v_household, p_date, p_slot, v_chosen, v_profile)
    on conflict (household_id, plan_date, slot) do update
      set recipe_id         = excluded.recipe_id,
          set_by_profile_id = excluded.set_by_profile_id
    returning * into v_row;
    return v_row;
  end;
  $$;

grant execute on function public.mealplan_regenerate_slot(date, public.meal_slot) to authenticated;
