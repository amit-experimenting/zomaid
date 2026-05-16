-- Household-level diet preference. When set, overrides every member's
-- personal preference for recipe / plan filtering. Renames the existing
-- household_strictest_diet helper to household_effective_diet and gives
-- it short-circuit logic on the new column.

alter table public.households
  add column diet_preference public.diet;

-- Drop the old helper. effective_recipes (recreated below) is the only
-- in-tree caller; the rename is intentional to reflect the new semantics.
drop function if exists public.household_strictest_diet(uuid);

create or replace function public.household_effective_diet(p_household uuid)
  returns public.diet
  language sql stable security definer
  set search_path = public
  as $$
    select coalesce(
      -- 1. Household-level override wins outright.
      (select diet_preference from public.households where id = p_household),
      -- 2. Else strictest non-maid active member preference.
      (select case
        when bool_or(hm.diet_preference = 'vegan')      then 'vegan'::public.diet
        when bool_or(hm.diet_preference = 'vegetarian') then 'vegetarian'::public.diet
        when bool_or(hm.diet_preference = 'eggitarian') then 'eggitarian'::public.diet
        else 'non_vegetarian'::public.diet
       end
       from public.household_memberships hm
       where hm.household_id = p_household
         and hm.status = 'active'
         and hm.role <> 'maid'
         and hm.diet_preference is not null),
      -- 3. Fallback when neither household nor any member has a pref.
      'non_vegetarian'::public.diet
    );
  $$;

grant execute on function public.household_effective_diet(uuid) to authenticated;

-- Recreate effective_recipes calling the renamed helper. Body identical to
-- the 20260624_001 version except for the helper name on line 1 of the CTE.
create or replace function public.effective_recipes(p_household uuid)
  returns setof public.recipes
  language sql stable security invoker
  set search_path = public
  as $$
    with strictest as (
      select public.household_effective_diet(p_household) as d
    )
    select all_recipes.* from (
      select r.* from public.recipes r
      where r.household_id is null
        and r.archived_at is null
        and not exists (
          select 1 from public.recipes f
          where f.household_id = p_household
            and f.parent_recipe_id = r.id
        )
        and not exists (
          select 1 from public.household_recipe_hides h
          where h.household_id = p_household
            and h.recipe_id = r.id
        )
      union all
      select r.* from public.recipes r
      where r.household_id = p_household
        and r.archived_at is null
    ) all_recipes
    cross join strictest s
    where
      s.d = 'non_vegetarian'
      or (s.d = 'eggitarian' and all_recipes.diet in ('vegan','vegetarian','eggitarian'))
      or (s.d = 'vegetarian' and all_recipes.diet in ('vegan','vegetarian'))
      or (s.d = 'vegan'      and all_recipes.diet  = 'vegan');
  $$;
