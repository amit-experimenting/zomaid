-- Starter recipes carry photo_path values like "starter/upma.jpg" pointing
-- into the public recipe-images bucket, but no actual files were ever
-- uploaded there. Every render attempts the URL, gets a 400, then falls
-- back to the deterministic SVG placeholder (commit bdfe6a5) — visually
-- fine, console-noisy. NULL the column so the UI skips the URL build
-- entirely and goes straight to the placeholder.
--
-- Household-owned recipes are untouched: those photo_paths can be real
-- uploads from the recipe form.

update public.recipes
   set photo_path = null
 where household_id is null
   and photo_path is not null;
