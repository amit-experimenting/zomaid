-- Slice 2a — Per-household hide of starter recipes.
-- Households can "hide" starter recipes they don't want to see; forks live in `recipes` itself.

create table public.household_recipe_hides (
  household_id          uuid not null references public.households(id) on delete cascade,
  recipe_id             uuid not null references public.recipes(id) on delete cascade,
  hidden_at             timestamptz not null default now(),
  hidden_by_profile_id  uuid not null references public.profiles(id) on delete set null,
  primary key (household_id, recipe_id)
);

-- Enforce: only starter recipes can be hidden.
create or replace function public.household_recipe_hides_check_starter()
  returns trigger language plpgsql as $$
  declare v_household_id uuid;
  begin
    select household_id into v_household_id from public.recipes where id = new.recipe_id;
    if v_household_id is not null then
      raise exception 'can only hide starter recipes' using errcode = '23514';
    end if;
    return new;
  end;
  $$;

create trigger household_recipe_hides_check_starter
  before insert on public.household_recipe_hides
  for each row execute function public.household_recipe_hides_check_starter();

alter table public.household_recipe_hides enable row level security;

create policy hrh_read on public.household_recipe_hides
  for select to authenticated
  using (public.has_active_membership(household_id));

create policy hrh_insert on public.household_recipe_hides
  for insert to authenticated
  with check (public.is_active_owner_or_maid(household_id));

create policy hrh_delete on public.household_recipe_hides
  for delete to authenticated
  using (public.is_active_owner_or_maid(household_id));
