-- Ingredient aliases: map recipe "processed" ingredient names to the form the
-- household actually buys. Applied inside shopping_auto_add_from_plans so the
-- shopping list gets shoppable items (e.g. "boiled potato" → "potato"). The
-- manual addShoppingItem path is intentionally untouched.

create table public.ingredient_aliases (
  processed_name text primary key
    check (length(processed_name) between 1 and 120),
  shoppable_name text not null
    check (length(shoppable_name) between 1 and 120),
  created_at     timestamptz not null default now()
);

alter table public.ingredient_aliases enable row level security;

-- Read-only for authenticated users. Writes happen via migrations
-- (service_role / postgres), which bypass RLS.
create policy ingredient_aliases_read_authenticated
  on public.ingredient_aliases for select
  to authenticated
  using (true);

-- Seed from starter-pack ingredient name review. Re-running this migration
-- upserts shoppable_name so corrections land cleanly.
insert into public.ingredient_aliases (processed_name, shoppable_name) values
  ('boiled potato',    'potato'),
  ('boiled chickpeas', 'chickpeas'),
  ('cooked rice',      'rice'),
  ('roasted peanuts',  'peanuts'),
  ('minced chicken',   'chicken thighs'),
  ('minced pork',      'pork shoulder'),
  ('grated coconut',   'coconut')
on conflict (processed_name)
  do update set shoppable_name = excluded.shoppable_name;

-- Rewrite shopping_auto_add_from_plans to resolve aliases before grouping,
-- so "boiled potato" and "potato" collapse into one "potato" row with summed
-- quantities. Aggregation semantics are otherwise unchanged.
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
    with resolved as (
      select
        coalesce(ia.shoppable_name, ri.item_name) as item_name,
        ri.quantity                                as quantity,
        ri.unit                                    as unit
      from public.meal_plans mp
      join public.recipe_ingredients ri on ri.recipe_id = mp.recipe_id
      left join public.ingredient_aliases ia
        on ia.processed_name = lower(ri.item_name)
      where mp.household_id = v_household
        and mp.plan_date between current_date and current_date + 6
        and mp.recipe_id is not null
    ),
    candidates as (
      select
        lower(r.item_name)                                      as key_name,
        r.unit                                                  as unit,
        min(r.item_name)                                        as display_name,
        bool_or(r.quantity is null)                             as has_null_qty,
        sum(r.quantity) filter (where r.quantity is not null)   as qty_sum
      from resolved r
      group by lower(r.item_name), r.unit
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
