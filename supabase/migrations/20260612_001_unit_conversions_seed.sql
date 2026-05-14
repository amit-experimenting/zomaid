-- Slice 2 inventory — Zomaid-default unit conversions.
-- household_id IS NULL = default. item_name IS NULL = generic.
-- All values are approximations sufficient for kitchen-scale cooking.

insert into public.unit_conversions (household_id, item_name, from_unit, to_unit, multiplier) values
  -- ── Generic volume (item_name NULL) ────────────────────────────────
  (null, null, 'cup',  'ml',  240),
  (null, null, 'tbsp', 'ml',  15),
  (null, null, 'tsp',  'ml',  5),
  (null, null, 'l',    'ml',  1000),

  -- ── Generic mass (item_name NULL) ─────────────────────────────────
  (null, null, 'kg', 'g',  1000),
  (null, null, 'lb', 'g',  453.6),
  (null, null, 'oz', 'g',  28.35),

  -- ── Generic volume ↔ mass for water-like density (1 ml ~= 1 g) ────
  (null, null, 'ml',  'g',   1),
  (null, null, 'cup', 'g',   240),
  (null, null, 'tbsp','g',   15),
  (null, null, 'tsp', 'g',   5),

  -- ── Rice (idli rice, basmati rice, jasmine rice — match by lowercased item_name)
  (null, 'rice',          'cup', 'g', 195),
  (null, 'basmati rice',  'cup', 'g', 195),
  (null, 'jasmine rice',  'cup', 'g', 195),
  (null, 'idli rice',     'cup', 'g', 200),
  (null, 'cooked rice',   'cup', 'g', 195),
  (null, 'flattened rice','cup', 'g', 100),

  -- ── Flour (plain flour, whole wheat flour, gram flour, rice flour) ─
  (null, 'plain flour',       'cup', 'g', 120),
  (null, 'whole wheat flour', 'cup', 'g', 120),
  (null, 'gram flour',        'cup', 'g', 100),
  (null, 'rice flour',        'cup', 'g', 120),
  (null, 'tapioca flour',     'cup', 'g', 130),
  (null, 'glutinous rice flour','cup','g', 130),
  (null, 'semolina',          'cup', 'g', 170),

  -- ── Sugars / sweeteners ────────────────────────────────────────────
  (null, 'sugar',         'cup', 'g', 200),
  (null, 'palm sugar',    'cup', 'g', 230),
  (null, 'honey',         'tbsp','g', 21),

  -- ── Lentils / pulses ───────────────────────────────────────────────
  (null, 'toor dal',  'cup', 'g', 200),
  (null, 'urad dal',  'cup', 'g', 200),
  (null, 'moong dal', 'cup', 'g', 200),
  (null, 'rajma',     'cup', 'g', 180),
  (null, 'chickpeas', 'cup', 'g', 200),

  -- ── Dairy ──────────────────────────────────────────────────────────
  (null, 'milk',        'cup', 'g', 245),
  (null, 'yogurt',      'cup', 'g', 245),
  (null, 'cream',       'cup', 'g', 240),
  (null, 'fresh cream', 'cup', 'g', 240),
  (null, 'butter',      'cup', 'g', 227),
  (null, 'butter',      'tbsp','g', 14),
  (null, 'ghee',        'cup', 'g', 218),
  (null, 'ghee',        'tbsp','g', 14),
  (null, 'cooking oil', 'cup', 'g', 218),
  (null, 'cooking oil', 'tbsp','g', 14),
  (null, 'oil for frying','cup','g', 218),
  (null, 'coconut milk','cup', 'g', 245),

  -- ── Discrete items (1 piece ≈ X grams) ─────────────────────────────
  (null, 'eggs',         'piece', 'g', 50),
  (null, 'onion',        'piece', 'g', 150),
  (null, 'tomato',       'piece', 'g', 120),
  (null, 'potato',       'piece', 'g', 200),
  (null, 'banana',       'piece', 'g', 120),
  (null, 'apple',        'piece', 'g', 180),
  (null, 'orange',       'piece', 'g', 130),
  (null, 'green chili',  'piece', 'g', 3),
  (null, 'garlic',       'clove', 'g', 3)
on conflict (
  coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(lower(item_name), ''),
  lower(from_unit),
  lower(to_unit)
) do nothing;
