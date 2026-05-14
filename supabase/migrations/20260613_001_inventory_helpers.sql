-- Slice 2 inventory — small read-only helpers used by the cook-deduct RPC
-- and (later) the auto-allocation engine.

-- Count of active household members (used for default people_eating).
create or replace function public.household_roster_size(p_household uuid)
  returns int
  language sql stable security invoker
  set search_path = public
  as $$
    select count(*)::int from public.household_memberships
      where household_id = p_household and status = 'active';
  $$;

grant execute on function public.household_roster_size(uuid) to authenticated;

-- Pick an inventory_items row for a (household, item_name, ingredient_unit).
-- Prefers the same-unit row; falls back to any matching name otherwise.
create or replace function public.inventory_lookup(
  p_household  uuid,
  p_item_name  text,
  p_unit       text
) returns public.inventory_items
  language sql stable security invoker
  set search_path = public
  as $$
    select * from public.inventory_items
    where household_id = p_household
      and lower(item_name) = lower(p_item_name)
    order by
      case when lower(unit) = lower(p_unit) then 0 else 1 end,
      quantity desc
    limit 1;
  $$;

grant execute on function public.inventory_lookup(uuid, text, text) to authenticated;

-- Convert p_qty from p_from_unit to p_to_unit. Walks the spec's priority list:
--   1) household + item-specific
--   2) global   + item-specific
--   3) household + generic
--   4) global   + generic
-- Returns NULL if no conversion exists at any priority.
create or replace function public.inventory_convert(
  p_household  uuid,
  p_item_name  text,
  p_from_unit  text,
  p_to_unit    text,
  p_qty        numeric
) returns numeric
  language sql stable security invoker
  set search_path = public
  as $$
    with priorities as (
      select multiplier, 1 as pri
        from public.unit_conversions
        where household_id = p_household
          and p_item_name is not null and lower(item_name) = lower(p_item_name)
          and lower(from_unit) = lower(p_from_unit)
          and lower(to_unit)   = lower(p_to_unit)
      union all
      select multiplier, 2
        from public.unit_conversions
        where household_id is null
          and p_item_name is not null and lower(item_name) = lower(p_item_name)
          and lower(from_unit) = lower(p_from_unit)
          and lower(to_unit)   = lower(p_to_unit)
      union all
      select multiplier, 3
        from public.unit_conversions
        where household_id = p_household
          and item_name is null
          and lower(from_unit) = lower(p_from_unit)
          and lower(to_unit)   = lower(p_to_unit)
      union all
      select multiplier, 4
        from public.unit_conversions
        where household_id is null
          and item_name is null
          and lower(from_unit) = lower(p_from_unit)
          and lower(to_unit)   = lower(p_to_unit)
    )
    select (multiplier * p_qty)::numeric
      from priorities
      order by pri asc
      limit 1;
  $$;

grant execute on function public.inventory_convert(uuid, text, text, text, numeric) to authenticated;
