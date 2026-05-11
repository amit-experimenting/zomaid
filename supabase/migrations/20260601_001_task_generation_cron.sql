-- Slice 5 — Generation + prune functions called nightly by pg_cron.

create or replace function public.tasks_generate_occurrences(p_horizon_date date)
  returns int
  language plpgsql security definer
  set search_path = public
  as $$
  declare
    v_inserted int := 0;
    v_task     record;
    v_day      date;
    v_due_at   timestamptz;
    v_matches  boolean;
  begin
    for v_task in
      select * from public.tasks
      where archived_at is null
        and recurrence_starts_on <= p_horizon_date
        and (recurrence_ends_on is null or recurrence_ends_on >= current_date)
    loop
      for v_day in
        select generate_series(
          greatest(v_task.recurrence_starts_on, current_date),
          least(p_horizon_date, coalesce(v_task.recurrence_ends_on, p_horizon_date)),
          '1 day'::interval
        )::date
      loop
        v_matches := false;

        if v_task.recurrence_frequency = 'daily' then
          v_matches := ((v_day - v_task.recurrence_starts_on) % v_task.recurrence_interval) = 0;

        elsif v_task.recurrence_frequency = 'weekly' then
          -- ISO week_start is Monday for date_trunc; convert to date.
          v_matches :=
            extract(dow from v_day)::int = any(v_task.recurrence_byweekday)
            and (((date_trunc('week', v_day)::date - date_trunc('week', v_task.recurrence_starts_on)::date) / 7)
                 % v_task.recurrence_interval) = 0;

        elsif v_task.recurrence_frequency = 'monthly' then
          v_matches :=
            extract(day from v_day)::int = v_task.recurrence_bymonthday
            and (
              (extract(year from v_day)::int * 12 + extract(month from v_day)::int)
              - (extract(year from v_task.recurrence_starts_on)::int * 12
                 + extract(month from v_task.recurrence_starts_on)::int)
            ) % v_task.recurrence_interval = 0;
        end if;

        if v_matches then
          v_due_at := (v_day + v_task.due_time) at time zone 'Asia/Singapore';

          insert into public.task_occurrences (task_id, due_at)
          values (v_task.id, v_due_at)
          on conflict (task_id, due_at) do nothing;

          if found then
            v_inserted := v_inserted + 1;
          end if;
        end if;
      end loop;
    end loop;

    return v_inserted;
  end;
  $$;

revoke execute on function public.tasks_generate_occurrences(date) from public;
grant  execute on function public.tasks_generate_occurrences(date) to postgres;
grant  execute on function public.tasks_generate_occurrences(date) to service_role;
grant  execute on function public.tasks_generate_occurrences(date) to authenticated;
-- ↑ authenticated grant is so server actions can call it after createTask
--   to materialize new tasks immediately without waiting for the cron.

create or replace function public.tasks_prune_old(p_days int default 90)
  returns int
  language sql security definer
  set search_path = public
  as $$
    with deleted as (
      delete from public.task_occurrences
      where status in ('done', 'skipped')
        and completed_at is not null
        and completed_at < now() - (p_days || ' days')::interval
      returning 1
    )
    select count(*)::int from deleted;
  $$;

revoke execute on function public.tasks_prune_old(int) from public;
grant  execute on function public.tasks_prune_old(int) to postgres;
grant  execute on function public.tasks_prune_old(int) to service_role;

-- pg_cron schedule: nightly at 22:00 SGT (db tz).
do $$ begin
  if exists (select 1 from cron.job where jobname = 'tasks-generate-and-prune') then
    perform cron.unschedule('tasks-generate-and-prune');
  end if;
  perform cron.schedule(
    'tasks-generate-and-prune',
    '0 22 * * *',
    $cmd$
      select public.tasks_generate_occurrences(current_date + 7);
      select public.tasks_prune_old(90);
    $cmd$
  );
end $$;
