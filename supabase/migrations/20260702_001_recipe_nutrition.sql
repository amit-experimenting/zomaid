-- Per-serving nutrition columns on recipes. All four are nullable: the
-- starter pack gets curated values in the companion data-fill migration,
-- but user-created recipes can leave them blank.
--
-- We store totals per serving (not per-ingredient and not per-recipe),
-- which lets the UI render "320 kcal · C 50g · F 8g · P 12g per serving"
-- directly without any math beyond formatting. `default_servings` stays
-- separate; it's only used for inventory scaling, not nutrition scaling.

alter table public.recipes
  add column kcal_per_serving      numeric check (kcal_per_serving      is null or kcal_per_serving      >= 0),
  add column carbs_g_per_serving   numeric check (carbs_g_per_serving   is null or carbs_g_per_serving   >= 0),
  add column fat_g_per_serving     numeric check (fat_g_per_serving     is null or fat_g_per_serving     >= 0),
  add column protein_g_per_serving numeric check (protein_g_per_serving is null or protein_g_per_serving >= 0);
