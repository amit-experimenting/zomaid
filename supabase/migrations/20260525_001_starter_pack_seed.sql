-- Slice 2a — Starter pack: 30 common SG household recipes.
-- v1 carries name + slot only. Ingredients/steps/photos to follow in a later migration.

insert into public.recipes (id, household_id, parent_recipe_id, name, slot, created_by_profile_id) values
  -- Breakfast (8)
  (gen_random_uuid(), null, null, 'Kaya Toast with Soft-Boiled Eggs', 'breakfast', null),
  (gen_random_uuid(), null, null, 'Nasi Lemak',                       'breakfast', null),
  (gen_random_uuid(), null, null, 'Roti Prata with Dhal',              'breakfast', null),
  (gen_random_uuid(), null, null, 'Mee Goreng',                        'breakfast', null),
  (gen_random_uuid(), null, null, 'Idli with Sambar',                  'breakfast', null),
  (gen_random_uuid(), null, null, 'Bee Hoon Soup',                     'breakfast', null),
  (gen_random_uuid(), null, null, 'Congee with Pork Floss',            'breakfast', null),
  (gen_random_uuid(), null, null, 'Oats with Banana',                  'breakfast', null),
  -- Lunch (8)
  (gen_random_uuid(), null, null, 'Hainanese Chicken Rice',            'lunch', null),
  (gen_random_uuid(), null, null, 'Char Kway Teow',                    'lunch', null),
  (gen_random_uuid(), null, null, 'Laksa',                             'lunch', null),
  (gen_random_uuid(), null, null, 'Fried Rice with Egg',               'lunch', null),
  (gen_random_uuid(), null, null, 'Bak Kut Teh',                       'lunch', null),
  (gen_random_uuid(), null, null, 'Wonton Noodles',                    'lunch', null),
  (gen_random_uuid(), null, null, 'Vegetable Briyani',                 'lunch', null),
  (gen_random_uuid(), null, null, 'Hokkien Mee',                       'lunch', null),
  -- Snacks (6)
  (gen_random_uuid(), null, null, 'Ondeh-Ondeh',                       'snacks', null),
  (gen_random_uuid(), null, null, 'Kueh Lapis',                        'snacks', null),
  (gen_random_uuid(), null, null, 'Fresh Fruit Bowl',                  'snacks', null),
  (gen_random_uuid(), null, null, 'Curry Puffs',                       'snacks', null),
  (gen_random_uuid(), null, null, 'Coconut Pancakes',                  'snacks', null),
  (gen_random_uuid(), null, null, 'Yam Cake',                          'snacks', null),
  -- Dinner (8)
  (gen_random_uuid(), null, null, 'Sambal Kangkong with Rice',         'dinner', null),
  (gen_random_uuid(), null, null, 'Steamed Fish with Ginger',          'dinner', null),
  (gen_random_uuid(), null, null, 'Black Pepper Beef',                 'dinner', null),
  (gen_random_uuid(), null, null, 'Dhal Curry with Roti',              'dinner', null),
  (gen_random_uuid(), null, null, 'Sweet & Sour Pork',                 'dinner', null),
  (gen_random_uuid(), null, null, 'Stir-fried Tofu and Vegetables',    'dinner', null),
  (gen_random_uuid(), null, null, 'Chicken Curry with Rice',           'dinner', null),
  (gen_random_uuid(), null, null, 'Mee Soto',                          'dinner', null);
