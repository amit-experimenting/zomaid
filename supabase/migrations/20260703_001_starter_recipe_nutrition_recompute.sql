-- Re-seed per-serving nutrition for the 55 starter recipes with values
-- computed from each recipe's actual ingredient list rather than the
-- category-based ballparks used in 20260702_002_starter_recipe_nutrition_fill.sql.
--
-- Method: for each ingredient in the SECTION C ingredient JSON of
-- 20260606_001_recipes_starter_pack_data_fill.sql, multiply the quantity
-- (after converting the unit to grams using common home-cooking norms —
-- 1 cup dry rice ≈ 185 g, 1 cup flour ≈ 125 g, 1 cup milk/liquid ≈ 240 g,
-- 1 cup coconut milk ≈ 225 g, 1 tbsp oil/ghee ≈ 14 g, 1 medium egg ≈ 50 g,
-- 1 medium onion ≈ 110 g, 1 medium tomato ≈ 120 g, 1 medium potato ≈ 170 g,
-- 1 clove garlic ≈ 5 g) by per-gram macro densities from the references
-- below, sum per recipe, divide by default_servings, then round kcal to
-- the nearest 10 and macros (C/F/P g) to the nearest 1. "Oil for frying"
-- entries assume realistic absorbed oil (≈ 80 g for batter-fried items,
-- ≈ 30 g for stir-fried), not the full pot volume.
--
-- References:
--   * USDA FoodData Central / SR Legacy (https://fdc.nal.usda.gov)
--   * Health Promotion Board Singapore Energy & Nutrient Composition tables
--     (https://focos.hpb.gov.sg/eservices/ENCF/)
--   * Indian Food Composition Tables 2017 (NIN, ICMR)
--   * Cronometer verified-source averages for compound items
--     (sambal belacan, laksa paste, kaya jam, ghee, biryani/garam masala,
--     dosa batter, kueh lapis).
--
-- Idempotent: every UPDATE assigns a constant per (name, household_id IS NULL),
-- so re-running yields the same row contents.
--
-- Scope: starter rows only (household_id IS NULL). Household-owned recipes
-- are untouched. Schema is unchanged — values only.

with nutrition(name, kcal, carbs, fat, protein) as (values
  -- ── Singaporean / Malay / Chinese starters ─────────────────────────────
  ('Kaya Toast with Soft-Boiled Eggs',  530,  56, 25, 19),
  ('Nasi Lemak',                        700,  82, 27, 26),
  ('Roti Prata with Dhal',              660, 106, 16, 21),
  ('Mee Goreng',                        370,  34, 16, 26),
  ('Idli with Sambar',                  750, 145,  6, 32),
  ('Bee Hoon Soup',                     270,  50,  1, 12),
  ('Congee with Pork Floss',            260,  44,  4,  9),
  ('Oats with Banana',                  470,  83, 11, 14),
  ('Hainanese Chicken Rice',            790,  79, 29, 46),
  ('Char Kway Teow',                    400,  34, 21, 22),
  ('Laksa',                             710,  73, 35, 26),
  ('Fried Rice with Egg',               410,  57, 12, 11),
  ('Bak Kut Teh',                       350,   4, 26, 23),
  ('Wonton Noodles',                    450,  53, 16, 25),
  ('Vegetable Briyani',                 500,  86, 12, 10),
  ('Hokkien Mee',                       600,  51, 30, 32),
  ('Ondeh-Ondeh',                       280,  52,  7,  2),
  ('Kueh Lapis',                        420,  61, 18,  3),
  ('Fresh Fruit Bowl',                  200,  51,  0,  2),
  ('Curry Puffs',                       400,  35, 23, 12),
  ('Coconut Pancakes',                  360,  39, 20,  8),
  ('Yam Cake',                          250,  46,  4,  7),
  ('Sambal Kangkong with Rice',         410,  79,  5, 10),
  ('Steamed Fish with Ginger',          180,   3,  5, 28),
  ('Black Pepper Beef',                 340,  12, 18, 35),
  ('Dhal Curry with Roti',              480,  84,  9, 18),
  ('Sweet & Sour Pork',                 480,  28, 30, 26),
  ('Stir-fried Tofu and Vegetables',    240,  10, 15, 18),
  ('Chicken Curry with Rice',           920,  97, 42, 38),
  ('Mee Soto',                          470,  24, 25, 33),

  -- ── Indian starters ────────────────────────────────────────────────────
  ('Masala Dosa',                       540,  93, 16, 14),
  ('Poha',                              310,  47, 10,  8),
  ('Upma',                              220,  33,  7,  6),
  ('Aloo Paratha',                      460,  73, 16, 12),
  ('Medu Vada',                         360,  32, 21, 13),
  ('Pongal',                            400,  55, 14, 11),
  ('Rajma Chawal',                      580, 111,  6, 19),
  ('Chole Bhature',                     690,  87, 29, 18),
  ('Palak Paneer with Rice',            630,  85, 20, 23),
  ('Veg Pulao',                         440,  83,  8,  8),
  ('Sambar Rice',                       370,  64,  9, 11),
  ('Aloo Gobi with Roti',               460,  83,  9, 15),
  ('Curd Rice',                         320,  50,  8,  8),
  ('Samosa',                            560,  80, 21, 11),
  ('Pani Puri',                         320,  54,  9,  8),
  ('Bhel Puri',                         170,  30,  4,  3),
  ('Pakora',                            360,  33, 22,  7),
  ('Masala Chai with Biscuits',         190,  24,  8,  5),
  ('Butter Chicken with Naan',          880,  57, 54, 43),
  ('Paneer Tikka Masala',               450,  12, 32, 21),
  ('Fish Curry',                        310,   4, 20, 28),
  ('Mutton Rogan Josh',                 680,  10, 49, 46),
  ('Baingan Bharta with Roti',          330,  56,  9, 11),
  ('Kadai Paneer',                      460,  13, 33, 20),
  ('Egg Curry with Rice',               570,  83, 15, 20)
)
update public.recipes r
   set kcal_per_serving      = n.kcal,
       carbs_g_per_serving   = n.carbs,
       fat_g_per_serving     = n.fat,
       protein_g_per_serving = n.protein
  from nutrition n
 where r.name = n.name
   and r.household_id is null;
