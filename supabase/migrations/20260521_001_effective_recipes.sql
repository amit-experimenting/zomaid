-- Slice 2a — effective_recipes(household): the single source of truth for
-- "what recipes does this household see." Used by library browse + suggestion engine.

create or replace function public.effective_recipes(p_household uuid)
  returns setof public.recipes
  language sql stable security invoker
  set search_path = public
  as $$
    -- Starter recipes not forked and not hidden by p_household.
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
    -- Household-owned recipes (forks and customs).
    select r.* from public.recipes r
    where r.household_id = p_household
      and r.archived_at is null;
  $$;

grant execute on function public.effective_recipes(uuid) to authenticated;
