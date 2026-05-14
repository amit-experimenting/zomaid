-- Slice 2 inventory — the cook-deduct RPC.
-- Called by the cron sweep (as postgres) and by manual user invocations.
-- security definer + internal permission check so both callers work.

create or replace function public.inventory_cook_deduct(p_meal_plan_id uuid)
  returns jsonb
  language plpgsql security definer
  set search_path = public
  as $$
  declare
    v_meal              public.meal_plans;
    v_recipe            public.recipes;
    v_effective_people  int;
    v_scale             numeric;
    v_ingredient        record;
    v_inv               public.inventory_items;
    v_needed_qty        numeric;
    v_deduct_qty        numeric;
    v_converted_qty     numeric;
    v_warnings          jsonb := '[]'::jsonb;
    v_final_status      public.meal_deduction_status;
    v_caller_role       text;
  begin
    -- Lock the meal_plan row so concurrent runs serialize.
    select * into v_meal from public.meal_plans where id = p_meal_plan_id for update;
    if v_meal is null then
      return jsonb_build_object('status', 'error', 'reason', 'meal_plan_not_found');
    end if;

    -- Permission: cron runs as postgres (bypass); otherwise require active owner/maid.
    -- session_user is the role that connected to Postgres; for cron it's `postgres`.
    if session_user not in ('postgres', 'supabase_admin') then
      if not public.is_active_owner_or_maid(v_meal.household_id) then
        raise exception 'permission denied' using errcode = 'P0001';
      end if;
    end if;

    -- Idempotent: do nothing if already processed.
    if v_meal.deduction_status <> 'pending' then
      return jsonb_build_object('status', v_meal.deduction_status::text, 'idempotent', true);
    end if;

    -- Skipped: no recipe attached.
    if v_meal.recipe_id is null then
      update public.meal_plans
        set deduction_status = 'skipped',
            cooked_at = now()
        where id = p_meal_plan_id;
      return jsonb_build_object('status', 'skipped');
    end if;

    select * into v_recipe from public.recipes where id = v_meal.recipe_id;
    v_effective_people := coalesce(v_meal.people_eating, public.household_roster_size(v_meal.household_id));
    v_scale := v_effective_people::numeric / v_recipe.default_servings::numeric;

    for v_ingredient in
      select ri.item_name, ri.quantity, ri.unit
        from public.recipe_ingredients ri
        where ri.recipe_id = v_meal.recipe_id
        order by ri.position
    loop
      v_needed_qty := v_ingredient.quantity * v_scale;
      v_inv := public.inventory_lookup(v_meal.household_id, v_ingredient.item_name, v_ingredient.unit);

      if v_inv.id is null then
        v_warnings := v_warnings || jsonb_build_object(
          'item_name', v_ingredient.item_name,
          'requested_qty', v_needed_qty,
          'deducted_qty', 0,
          'unit', v_ingredient.unit,
          'reason', 'not_in_stock'
        );
        continue;
      end if;

      v_deduct_qty := v_needed_qty;
      if lower(v_inv.unit) <> lower(v_ingredient.unit) then
        v_converted_qty := public.inventory_convert(
          v_meal.household_id, v_ingredient.item_name, v_ingredient.unit, v_inv.unit, v_needed_qty
        );
        if v_converted_qty is null then
          v_warnings := v_warnings || jsonb_build_object(
            'item_name', v_ingredient.item_name,
            'requested_qty', v_needed_qty,
            'deducted_qty', 0,
            'unit', v_ingredient.unit,
            'reason', 'no_conversion'
          );
          continue;
        end if;
        v_deduct_qty := v_converted_qty;
      end if;

      if v_deduct_qty > v_inv.quantity then
        v_warnings := v_warnings || jsonb_build_object(
          'item_name', v_ingredient.item_name,
          'requested_qty', v_deduct_qty,
          'deducted_qty', v_inv.quantity,
          'unit', v_inv.unit,
          'reason', 'short'
        );
        v_deduct_qty := v_inv.quantity;
      end if;

      update public.inventory_items
        set quantity = quantity - v_deduct_qty
        where id = v_inv.id;

      insert into public.inventory_transactions
        (household_id, inventory_item_id, delta, unit, reason, meal_plan_id, actor_profile_id)
        values
        (v_meal.household_id, v_inv.id, -v_deduct_qty, v_inv.unit, 'cook_deduct', p_meal_plan_id, null);
    end loop;

    v_final_status := case when jsonb_array_length(v_warnings) > 0 then 'partial'::public.meal_deduction_status
                            else 'deducted'::public.meal_deduction_status end;

    update public.meal_plans
      set deduction_status = v_final_status,
          cooked_at = now(),
          deduction_warnings = case when jsonb_array_length(v_warnings) > 0 then v_warnings else null end
      where id = p_meal_plan_id;

    return jsonb_build_object('status', v_final_status::text, 'warnings', v_warnings);
  end;
  $$;

grant execute on function public.inventory_cook_deduct(uuid) to authenticated;
