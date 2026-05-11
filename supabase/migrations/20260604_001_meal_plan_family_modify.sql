-- Activates the foundations `meal_modify` privilege for meal_plans writes.
-- Owner/maid retain full edit; family_members with privilege in ('full','meal_modify')
-- can now insert/update/delete meal_plans rows. view_only family_members remain read-only.

create or replace function public.can_modify_meal_plan(p_household uuid)
  returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select exists (
      select 1
      from public.household_memberships hm
      join public.profiles p on p.id = hm.profile_id
      where hm.household_id = p_household
        and hm.status = 'active'
        and p.clerk_user_id = (auth.jwt() ->> 'sub')
        and (
          hm.role in ('owner', 'maid')
          or (hm.role = 'family_member' and hm.privilege in ('full', 'meal_modify'))
        )
    );
  $$;

drop policy if exists meal_plans_insert on public.meal_plans;
drop policy if exists meal_plans_update on public.meal_plans;
drop policy if exists meal_plans_delete on public.meal_plans;

create policy meal_plans_insert on public.meal_plans
  for insert to authenticated
  with check (public.can_modify_meal_plan(household_id));

create policy meal_plans_update on public.meal_plans
  for update to authenticated
  using (public.can_modify_meal_plan(household_id))
  with check (public.can_modify_meal_plan(household_id));

create policy meal_plans_delete on public.meal_plans
  for delete to authenticated
  using (public.can_modify_meal_plan(household_id));
