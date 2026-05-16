-- Set recipes.diet column default so inserts that don't specify diet (test
-- fixtures, ad-hoc SQL, future third-party tooling) fall back to the safest
-- classification instead of failing the NOT-NULL constraint added in
-- 20260624_001_diet_preferences.sql. non_vegetarian is the most-inclusive
-- bucket: stricter household filters still hide it, which is the right
-- default for an unclassified recipe.

alter table public.recipes
  alter column diet set default 'non_vegetarian';
