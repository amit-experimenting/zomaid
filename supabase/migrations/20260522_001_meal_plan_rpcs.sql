-- Slice 2a — Meal plan RPCs.
-- Helper to resolve caller's current household (most-recent active membership).
create or replace function public.current_household_id_for_caller()
  returns uuid
  language sql stable security invoker
  set search_path = public
  as $$
    select hm.household_id
    from public.household_memberships hm
    join public.profiles p on p.id = hm.profile_id
    where p.clerk_user_id = (auth.jwt() ->> 'sub')
      and hm.status = 'active'
    order by hm.joined_at desc, hm.id desc
    limit 1;
  $$;

-- Manual override / clear a slot.
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

grant execute on function public.mealplan_set_slot(date, public.meal_slot, uuid) to authenticated;

-- Pick a fresh recipe for one slot using the non-repeat rule.
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
    -- Try non-repeat eligible
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
    -- Fallback: any eligible regardless of history
    if v_recipe is null then
      select id into v_recipe
      from public.effective_recipes(v_household) r
      where r.slot = p_slot
      order by random()
      limit 1;
    end if;
    -- v_recipe may still be NULL (empty library for slot) — that's valid.
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

grant execute on function public.mealplan_regenerate_slot(date, public.meal_slot) to authenticated;

-- Batch suggest for a date across all active households. Called by pg_cron.
create or replace function public.mealplan_suggest_for_date(p_date date)
  returns void
  language plpgsql security invoker
  set search_path = public
  as $$
  declare
    v_household uuid;
    v_slot      public.meal_slot;
    v_recipe    uuid;
  begin
    for v_household in
      select distinct household_id from public.household_memberships where status = 'active'
    loop
      foreach v_slot in array array['breakfast','lunch','snacks','dinner']::public.meal_slot[]
      loop
        if exists (
          select 1 from public.meal_plans
          where household_id = v_household and plan_date = p_date and slot = v_slot
        ) then
          continue;
        end if;
        -- Non-repeat eligible
        select id into v_recipe
        from public.effective_recipes(v_household) r
        where r.slot = v_slot
          and r.id not in (
            select recipe_id from public.meal_plans
            where household_id = v_household
              and slot = v_slot
              and plan_date between p_date - 4 and p_date - 1
              and recipe_id is not null
          )
        order by random()
        limit 1;
        -- Fallback
        if v_recipe is null then
          select id into v_recipe
          from public.effective_recipes(v_household) r
          where r.slot = v_slot
          order by random()
          limit 1;
        end if;
        insert into public.meal_plans
          (household_id, plan_date, slot, recipe_id, set_by_profile_id)
        values (v_household, p_date, v_slot, v_recipe, null)
        on conflict (household_id, plan_date, slot) do nothing;
        v_recipe := null;
      end loop;
    end loop;
  end;
  $$;

revoke execute on function public.mealplan_suggest_for_date(date) from public;
grant  execute on function public.mealplan_suggest_for_date(date) to postgres;
