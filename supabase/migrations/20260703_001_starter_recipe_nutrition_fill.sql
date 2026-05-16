-- Hand-curated per-serving nutrition for the 55 starter recipes seeded by
-- 20260606_001_recipes_starter_pack_data_fill.sql. Values are realistic
-- ballparks derived from standard food-composition references (USDA SR,
-- Singapore HPB Energy & Nutrient Composition tables for Asian dishes,
-- IFCT for Indian items) — typical home-cook portion sizes, scaled by
-- the recipe's default serving count. Rounded: kcal to nearest 10,
-- macros to nearest 1g.
--
-- Bias bands used (see design notes):
--   * Carb-heavy mains: 400–700 kcal, 50–90g C, 8–20g F, 15–25g P
--   * Protein-heavy mains: 450–700 kcal, 20–40g C, 25–45g F, 30–50g P
--   * Lighter / soup / breakfast: 200–400 kcal, 30–60g C, 5–15g F, 8–15g P
--   * Snacks / sides: 100–350 kcal, 15–50g C, 3–20g F, 2–10g P
--   * Vegetable mains: 250–500 kcal, 20–50g C, 10–30g F, 10–25g P

with nutrition(name, kcal, carbs, fat, protein) as (values
  -- ── Singaporean / Malay / Chinese starters ─────────────────────────────
  ('Kaya Toast with Soft-Boiled Eggs',  330, 38, 14, 13),
  ('Nasi Lemak',                        640, 75, 28, 22),
  ('Roti Prata with Dhal',              450, 55, 18, 12),
  ('Mee Goreng',                        520, 70, 18, 18),
  ('Idli with Sambar',                  260, 50,  4, 10),
  ('Bee Hoon Soup',                     310, 45,  6, 18),
  ('Congee with Pork Floss',            290, 50,  5, 12),
  ('Oats with Banana',                  280, 55,  5,  8),
  ('Hainanese Chicken Rice',            580, 70, 18, 30),
  ('Char Kway Teow',                    700, 80, 28, 22),
  ('Laksa',                             620, 60, 32, 22),
  ('Fried Rice with Egg',               520, 70, 18, 14),
  ('Bak Kut Teh',                       480, 22, 28, 38),
  ('Wonton Noodles',                    470, 60, 14, 22),
  ('Vegetable Briyani',                 540, 80, 18, 12),
  ('Hokkien Mee',                       560, 65, 22, 22),
  ('Ondeh-Ondeh',                       180, 32,  6,  2),
  ('Kueh Lapis',                        220, 30, 10,  2),
  ('Fresh Fruit Bowl',                  120, 28,  1,  2),
  ('Curry Puffs',                       260, 28, 14,  6),
  ('Coconut Pancakes',                  240, 35, 10,  5),
  ('Yam Cake',                          250, 38,  8,  6),
  ('Sambal Kangkong with Rice',         420, 65, 12, 10),
  ('Steamed Fish with Ginger',          280, 10, 12, 34),
  ('Black Pepper Beef',                 520, 28, 28, 38),
  ('Dhal Curry with Roti',              420, 60, 12, 16),
  ('Sweet & Sour Pork',                 560, 55, 24, 30),
  ('Stir-fried Tofu and Vegetables',    320, 25, 18, 18),
  ('Chicken Curry with Rice',           620, 70, 22, 32),
  ('Mee Soto',                          440, 55, 12, 22),

  -- ── Indian starters ────────────────────────────────────────────────────
  ('Masala Dosa',                       380, 60, 10, 10),
  ('Poha',                              280, 50,  6,  7),
  ('Upma',                              260, 42,  7,  8),
  ('Aloo Paratha',                      380, 50, 14, 10),
  ('Medu Vada',                         220, 28, 10,  7),
  ('Pongal',                            340, 55,  8, 10),
  ('Rajma Chawal',                      520, 85, 10, 18),
  ('Chole Bhature',                     660, 80, 28, 18),
  ('Palak Paneer with Rice',            520, 60, 22, 20),
  ('Veg Pulao',                         460, 75, 12, 10),
  ('Sambar Rice',                       420, 70,  8, 12),
  ('Aloo Gobi with Roti',               360, 55, 12, 10),
  ('Curd Rice',                         340, 55,  8, 10),
  ('Samosa',                            260, 32, 12,  5),
  ('Pani Puri',                         180, 35,  3,  4),
  ('Bhel Puri',                         220, 40,  5,  5),
  ('Pakora',                            240, 25, 14,  6),
  ('Masala Chai with Biscuits',         180, 25,  7,  3),
  ('Butter Chicken with Naan',          680, 55, 30, 38),
  ('Paneer Tikka Masala',               480, 28, 30, 22),
  ('Fish Curry',                        420, 18, 22, 32),
  ('Mutton Rogan Josh',                 560, 18, 38, 38),
  ('Baingan Bharta with Roti',          340, 45, 14,  9),
  ('Kadai Paneer',                      460, 25, 30, 22),
  ('Egg Curry with Rice',               520, 65, 20, 22)
)
update public.recipes r
   set kcal_per_serving      = n.kcal,
       carbs_g_per_serving   = n.carbs,
       fat_g_per_serving     = n.fat,
       protein_g_per_serving = n.protein
  from nutrition n
 where r.name = n.name
   and r.household_id is null;
