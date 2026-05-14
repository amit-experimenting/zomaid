-- Slice 1 of the recipes-and-allocation overhaul (2026-05-14).
-- Adds YouTube video URL and serving-size baseline to recipes so the
-- subsequent data-fill migration can populate them, and so a future
-- inventory deduction can scale by (people_today / default_servings).

alter table public.recipes
  add column youtube_url       text,
  add column default_servings  int not null default 4;

alter table public.recipes
  add constraint recipes_default_servings_range
    check (default_servings between 1 and 20);

-- Allowlist YouTube URL shape. Blocks arbitrary embed URLs and reduces
-- the XSS surface if the field is ever rendered as an iframe in future.
alter table public.recipes
  add constraint recipes_youtube_url_https
    check (
      youtube_url is null
      or youtube_url ~ '^https://(www\.)?(youtube\.com/watch\?v=|youtu\.be/)[A-Za-z0-9_-]+'
    );
