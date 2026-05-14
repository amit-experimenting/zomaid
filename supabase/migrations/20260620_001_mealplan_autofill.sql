-- Slice 3 auto-allocation — scoring helper, autofill RPC, and upgrades to
-- mealplan_regenerate_slot + mealplan_suggest_for_date.

-- ── Helper: stock-fit score per recipe ────────────────────────────────────
-- Returns fraction in [0, 1]. Score = (ingredients in stock with enough qty
-- after scaling to people-count) / (total ingredient count). Binary per
-- ingredient. Returns 0 for recipes with no ingredients.
--
-- security definer because callers may not have direct read access to
-- inventory_items; the function does its own scoping by household.
create or replace function public.mealplan_recipe_stock_score(
  p_household uuid,
  p_recipe_id uuid,
  p_people    int
) returns numeric
  language plpgsql stable security definer
  set search_path = public
  as $$
  declare
    v_default_servings int;
    v_total_ingredients int;
    v_in_stock int := 0;
    v_scale numeric;
    v_ing record;
    v_inv public.inventory_items;
    v_needed_qty numeric;
    v_converted_qty numeric;
  begin
    select default_servings into v_default_servings from public.recipes where id = p_recipe_id;
    if v_default_servings is null then
      return 0;  -- recipe not found
    end if;

    select count(*)::int into v_total_ingredients
      from public.recipe_ingredients where recipe_id = p_recipe_id;
    if v_total_ingredients = 0 then
      return 0;
    end if;

    v_scale := p_people::numeric / v_default_servings::numeric;

    for v_ing in
      select item_name, quantity, unit
        from public.recipe_ingredients
        where recipe_id = p_recipe_id
          and quantity is not null
          and unit is not null
    loop
      v_needed_qty := v_ing.quantity * v_scale;
      v_inv := public.inventory_lookup(p_household, v_ing.item_name, v_ing.unit);

      if v_inv.id is null then
        continue;  -- not in stock
      end if;

      if lower(v_inv.unit) = lower(v_ing.unit) then
        if v_inv.quantity >= v_needed_qty then
          v_in_stock := v_in_stock + 1;
        end if;
      else
        v_converted_qty := public.inventory_convert(
          p_household, v_ing.item_name, v_ing.unit, v_inv.unit, v_needed_qty
        );
        if v_converted_qty is not null and v_inv.quantity >= v_converted_qty then
          v_in_stock := v_in_stock + 1;
        end if;
      end if;
    end loop;

    return (v_in_stock::numeric / v_total_ingredients::numeric);
  end;
  $$;

grant execute on function public.mealplan_recipe_stock_score(uuid, uuid, int) to authenticated;

-- ── Worker: fill all slots for one (household, date) ──────────────────────
-- Returns count of slots actually filled (excluding skipped: locked, already
-- filled, or no eligible candidates). Always called via either:
--   - mealplan_autofill_date(p_date)        - user-facing wrapper, resolves household from JWT
--   - mealplan_suggest_for_date(p_date)     - cron wrapper, loops all households
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
    foreach v_slot in array array['breakfast','lunch','snacks','dinner']::public.meal_slot[]
    loop
      -- Skip locked slots.
      if public.is_meal_slot_locked(p_household, p_date, v_slot) then
        continue;
      end if;

      -- Skip slots that are already filled (recipe_id non-null) OR cooked (cron has touched).
      select * into v_existing from public.meal_plans
        where household_id = p_household and plan_date = p_date and slot = v_slot;
      if v_existing.id is not null and (v_existing.recipe_id is not null or v_existing.cooked_at is not null) then
        continue;
      end if;

      -- Effective people: row's override if set, else household roster size.
      v_people := coalesce(v_existing.people_eating, public.household_roster_size(p_household));
      if v_people is null or v_people < 1 then
        v_people := 1;
      end if;

      -- Build eligible candidates: effective_recipes for this slot, minus
      -- recipes used in the same slot in the last 4 days.
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
        continue;  -- no eligible candidates
      end if;

      -- Upsert: insert or update only if the row was empty + unprocessed.
      insert into public.meal_plans
        (household_id, plan_date, slot, recipe_id, set_by_profile_id)
      values (p_household, p_date, v_slot, v_chosen, null)
      on conflict (household_id, plan_date, slot) do update
        set recipe_id = excluded.recipe_id
        where meal_plans.recipe_id is null
          and meal_plans.cooked_at is null;

      -- Only count slots that actually changed (the ON CONFLICT WHERE may reject).
      get diagnostics v_rows = row_count;
      v_filled := v_filled + v_rows;
    end loop;

    return v_filled;
  end;
  $$;

revoke execute on function public.mealplan_autofill_date_for_household(uuid, date) from public;
grant  execute on function public.mealplan_autofill_date_for_household(uuid, date) to postgres;

-- ── User-facing wrapper: resolves household from JWT, enforces write perm ──
create or replace function public.mealplan_autofill_date(p_date date)
  returns int
  language plpgsql security definer
  set search_path = public
  as $$
  declare
    v_household uuid;
  begin
    v_household := public.current_household_id_for_caller();
    if v_household is null then
      raise exception 'no active household' using errcode = 'P0001';
    end if;
    -- Cron path doesn't go through here. User path requires meal-modify permission.
    if not public.can_modify_meal_plan(v_household) then
      raise exception 'permission denied' using errcode = 'P0001';
    end if;
    return public.mealplan_autofill_date_for_household(v_household, p_date);
  end;
  $$;

grant execute on function public.mealplan_autofill_date(date) to authenticated;

-- ── Upgrade: mealplan_regenerate_slot now uses stock scoring ──────────────
-- Replaces the random-eligible pick in slice 2's version. Same permissions,
-- same lock check, same upsert semantics. Only the inner candidate pick changes.
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

    -- Find existing row to honor people_eating override if set.
    select * into v_existing from public.meal_plans
      where household_id = v_household and plan_date = p_date and slot = p_slot;
    v_people := coalesce(v_existing.people_eating, public.household_roster_size(v_household));
    if v_people is null or v_people < 1 then
      v_people := 1;
    end if;

    -- Same scoring logic as mealplan_autofill_date_for_household, applied to one slot.
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

    -- Upsert (overwrites any existing recipe; that's the regenerate intent).
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

-- ── Upgrade: mealplan_suggest_for_date now delegates to the autofill worker ──
-- Called by the pg_cron job (mealplan-suggest-tomorrow, 0 22 * * *).
-- Loops over active households and runs the same scoring algorithm as on-view fill.
create or replace function public.mealplan_suggest_for_date(p_date date)
  returns void
  language plpgsql security invoker
  set search_path = public
  as $$
  declare
    v_household uuid;
  begin
    for v_household in
      select distinct household_id from public.household_memberships where status = 'active'
    loop
      perform public.mealplan_autofill_date_for_household(v_household, p_date);
    end loop;
  end;
  $$;

revoke execute on function public.mealplan_suggest_for_date(date) from public;
grant  execute on function public.mealplan_suggest_for_date(date) to postgres;
