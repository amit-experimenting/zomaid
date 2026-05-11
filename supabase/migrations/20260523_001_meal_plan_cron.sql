-- Slice 2a — pg_cron schedule for nightly meal plan suggestions.
-- DB timezone is Asia/Singapore (per foundations); 0 22 * * * = 22:00 SGT.

create extension if not exists pg_cron;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'mealplan-suggest-tomorrow') then
    perform cron.unschedule('mealplan-suggest-tomorrow');
  end if;
  perform cron.schedule(
    'mealplan-suggest-tomorrow',
    '0 22 * * *',
    $cmd$ select public.mealplan_suggest_for_date(current_date + 1); $cmd$
  );
end $$;
