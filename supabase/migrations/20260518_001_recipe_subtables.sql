-- Slice 2a — Structured ingredients + steps for recipes.

create table public.recipe_ingredients (
  id        uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  position  int  not null check (position >= 1),
  item_name text not null check (length(item_name) between 1 and 120),
  quantity  numeric,
  unit      text check (unit is null or length(unit) between 1 and 24),
  unique (recipe_id, position)
);
create index recipe_ingredients_recipe_id_idx on public.recipe_ingredients (recipe_id);

create table public.recipe_steps (
  id          uuid primary key default gen_random_uuid(),
  recipe_id   uuid not null references public.recipes(id) on delete cascade,
  position    int  not null check (position >= 1),
  instruction text not null check (length(instruction) between 1 and 2000),
  unique (recipe_id, position)
);
create index recipe_steps_recipe_id_idx on public.recipe_steps (recipe_id);

alter table public.recipe_ingredients enable row level security;
alter table public.recipe_steps       enable row level security;

-- Piggy-back on recipes RLS: ingredients/steps inherit visibility/writability.
create policy recipe_ingredients_read on public.recipe_ingredients
  for select to authenticated
  using (
    exists (select 1 from public.recipes r
            where r.id = recipe_id
              and (
                (r.household_id is null and (auth.jwt() ->> 'sub') is not null)
                or public.has_active_membership(r.household_id)
              ))
  );

create policy recipe_ingredients_write on public.recipe_ingredients
  for all to authenticated
  using (
    exists (select 1 from public.recipes r
            where r.id = recipe_id
              and r.household_id is not null
              and public.is_active_owner_or_maid(r.household_id))
  )
  with check (
    exists (select 1 from public.recipes r
            where r.id = recipe_id
              and r.household_id is not null
              and public.is_active_owner_or_maid(r.household_id))
  );

create policy recipe_steps_read on public.recipe_steps
  for select to authenticated
  using (
    exists (select 1 from public.recipes r
            where r.id = recipe_id
              and (
                (r.household_id is null and (auth.jwt() ->> 'sub') is not null)
                or public.has_active_membership(r.household_id)
              ))
  );

create policy recipe_steps_write on public.recipe_steps
  for all to authenticated
  using (
    exists (select 1 from public.recipes r
            where r.id = recipe_id
              and r.household_id is not null
              and public.is_active_owner_or_maid(r.household_id))
  )
  with check (
    exists (select 1 from public.recipes r
            where r.id = recipe_id
              and r.household_id is not null
              and public.is_active_owner_or_maid(r.household_id))
  );
