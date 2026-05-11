-- Slice 2b — Aggregate next 7 days of plan ingredients into the shopping list.
-- Case-insensitive dedupe on (item_name, unit). Sums quantities for matching
-- pairs; if any contributing ingredient has NULL quantity, the inserted row
-- has NULL quantity. Skips pairs already unbought in the list.

create or replace function public.shopping_auto_add_from_plans()
  returns setof public.shopping_list_items
  language plpgsql security invoker
  set search_path = public
  as $$
  declare
    v_household uuid := public.current_household_id_for_caller();
    v_profile   uuid := public.current_profile_id();
  begin
    if v_household is null then
      raise exception 'no active household' using errcode = 'P0001';
    end if;

    return query
    with candidates as (
      select
        lower(ri.item_name)                                      as key_name,
        ri.unit                                                  as unit,
        min(ri.item_name)                                        as display_name,
        bool_or(ri.quantity is null)                             as has_null_qty,
        sum(ri.quantity) filter (where ri.quantity is not null)  as qty_sum
      from public.meal_plans mp
      join public.recipe_ingredients ri on ri.recipe_id = mp.recipe_id
      where mp.household_id = v_household
        and mp.plan_date between current_date and current_date + 6
        and mp.recipe_id is not null
      group by lower(ri.item_name), ri.unit
    ),
    to_insert as (
      select c.*
      from candidates c
      where not exists (
        select 1 from public.shopping_list_items s
        where s.household_id = v_household
          and s.bought_at is null
          and lower(s.item_name) = c.key_name
          and coalesce(s.unit, '') = coalesce(c.unit, '')
      )
    )
    insert into public.shopping_list_items
      (household_id, item_name, quantity, unit, created_by_profile_id, bought_at)
    select
      v_household,
      t.display_name,
      case when t.has_null_qty then null else t.qty_sum end,
      t.unit,
      v_profile,
      null
    from to_insert t
    returning *;
  end;
  $$;

revoke execute on function public.shopping_auto_add_from_plans() from public;
grant  execute on function public.shopping_auto_add_from_plans() to authenticated;
