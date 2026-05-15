-- Diet preferences: per-member preference + per-recipe classification +
-- filter inside effective_recipes. Maid preferences are tracked but
-- intentionally excluded from the household-strictest calculation.

create type public.diet as enum
  ('vegan', 'vegetarian', 'eggitarian', 'non_vegetarian');

alter table public.recipes
  add column diet public.diet;

alter table public.household_memberships
  add column diet_preference public.diet;

-- ── Starter pack classification ───────────────────────────────────────────
-- Each row matches by name + household_id IS NULL (starter rows). Manual
-- review of ingredient lists; see the design doc for rationale on edge
-- cases (sambal belacan / oyster sauce / honey → non-veg or veg).

with classification(name, diet) as (values
  ('Kaya Toast with Soft-Boiled Eggs', 'eggitarian'),
  ('Nasi Lemak',                       'non_vegetarian'),
  ('Roti Prata with Dhal',             'vegetarian'),
  ('Mee Goreng',                       'non_vegetarian'),
  ('Idli with Sambar',                 'vegan'),
  ('Bee Hoon Soup',                    'non_vegetarian'),
  ('Congee with Pork Floss',           'non_vegetarian'),
  ('Oats with Banana',                 'vegetarian'),
  ('Hainanese Chicken Rice',           'non_vegetarian'),
  ('Char Kway Teow',                   'non_vegetarian'),
  ('Laksa',                            'non_vegetarian'),
  ('Fried Rice with Egg',              'eggitarian'),
  ('Bak Kut Teh',                      'non_vegetarian'),
  ('Wonton Noodles',                   'non_vegetarian'),
  ('Vegetable Briyani',                'vegetarian'),
  ('Hokkien Mee',                      'non_vegetarian'),
  ('Ondeh-Ondeh',                      'vegan'),
  ('Kueh Lapis',                       'vegan'),
  ('Fresh Fruit Bowl',                 'vegetarian'),
  ('Curry Puffs',                      'non_vegetarian'),
  ('Coconut Pancakes',                 'eggitarian'),
  ('Yam Cake',                         'non_vegetarian'),
  ('Sambal Kangkong with Rice',        'non_vegetarian'),
  ('Steamed Fish with Ginger',         'non_vegetarian'),
  ('Black Pepper Beef',                'non_vegetarian'),
  ('Dhal Curry with Roti',             'vegetarian'),
  ('Sweet & Sour Pork',                'non_vegetarian'),
  ('Stir-fried Tofu and Vegetables',   'non_vegetarian'),
  ('Chicken Curry with Rice',          'non_vegetarian'),
  ('Mee Soto',                         'non_vegetarian'),
  ('Masala Dosa',                      'vegetarian'),
  ('Poha',                             'vegan'),
  ('Upma',                             'vegetarian'),
  ('Aloo Paratha',                     'vegetarian'),
  ('Medu Vada',                        'vegan'),
  ('Pongal',                           'vegetarian'),
  ('Rajma Chawal',                     'vegan'),
  ('Chole Bhature',                    'vegetarian'),
  ('Palak Paneer with Rice',           'vegetarian'),
  ('Veg Pulao',                        'vegetarian'),
  ('Sambar Rice',                      'vegetarian'),
  ('Aloo Gobi with Roti',              'vegan'),
  ('Curd Rice',                        'vegetarian'),
  ('Samosa',                           'vegan'),
  ('Pani Puri',                        'vegan'),
  ('Bhel Puri',                        'vegan'),
  ('Pakora',                           'vegan'),
  ('Masala Chai with Biscuits',        'vegetarian'),
  ('Butter Chicken with Naan',         'non_vegetarian'),
  ('Paneer Tikka Masala',              'vegetarian'),
  ('Fish Curry',                       'non_vegetarian'),
  ('Mutton Rogan Josh',                'non_vegetarian'),
  ('Baingan Bharta with Roti',         'vegan'),
  ('Kadai Paneer',                     'vegetarian'),
  ('Egg Curry with Rice',              'eggitarian')
)
update public.recipes r
   set diet = c.diet::public.diet
  from classification c
 where r.name = c.name
   and r.household_id is null;

-- Backfill any remaining recipes (household-owned forks/customs and any
-- starter the classification missed) to the safest default.
update public.recipes set diet = 'non_vegetarian' where diet is null;

alter table public.recipes
  alter column diet set not null;

-- ── household_strictest_diet helper ───────────────────────────────────────
-- Returns the strictest preference across non-maid active members.
-- NULL preferences ignored. Default 'non_vegetarian' if no signal.
-- security definer so it can read household_memberships unhindered when
-- called from inside effective_recipes under any caller.
create or replace function public.household_strictest_diet(p_household uuid)
  returns public.diet
  language sql stable security definer
  set search_path = public
  as $$
    select case
      when bool_or(hm.diet_preference = 'vegan'      ) then 'vegan'::public.diet
      when bool_or(hm.diet_preference = 'vegetarian' ) then 'vegetarian'::public.diet
      when bool_or(hm.diet_preference = 'eggitarian' ) then 'eggitarian'::public.diet
      else 'non_vegetarian'::public.diet
    end
    from public.household_memberships hm
    where hm.household_id = p_household
      and hm.status = 'active'
      and hm.role <> 'maid'
      and hm.diet_preference is not null;
  $$;

grant execute on function public.household_strictest_diet(uuid) to authenticated;

-- ── effective_recipes now filters by the household's strictest diet ──────
create or replace function public.effective_recipes(p_household uuid)
  returns setof public.recipes
  language sql stable security invoker
  set search_path = public
  as $$
    with strictest as (
      select public.household_strictest_diet(p_household) as d
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
