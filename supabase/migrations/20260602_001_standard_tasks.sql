-- Slice 5 extension — Standard (system-wide) tasks alongside household-owned tasks.
-- Mirrors the recipes starter-pack pattern: tasks.household_id = NULL means standard;
-- households see standard tasks by default and can hide them via household_task_hides.

-- 1. Allow tasks.household_id to be NULL (= standard task).
alter table public.tasks
  alter column household_id drop not null;

-- 2. Drop the existing read policy so we can recreate it with standard-task awareness.
drop policy if exists tasks_read on public.tasks;

create policy tasks_read on public.tasks
  for select to authenticated
  using (
    -- Standard task: any authenticated user can read.
    (household_id is null and (auth.jwt() ->> 'sub') is not null)
    or
    -- Household task: active member of that household.
    (household_id is not null and public.has_active_membership(household_id))
  );

-- Insert/update/delete policies remain as-is — they already gate on
-- public.is_active_owner_or_maid(household_id) which is NULL-safe (returns
-- false when household_id is NULL), so app users can't mutate standard tasks.

-- 3. Add household_id to task_occurrences. Backfill from joined task,
--    then make NOT NULL.
alter table public.task_occurrences
  add column household_id uuid references public.households(id) on delete cascade;

update public.task_occurrences toc
  set household_id = t.household_id
  from public.tasks t
  where toc.task_id = t.id
    and t.household_id is not null;

-- Delete any orphan occurrences that can't be back-filled (shouldn't exist;
-- defensive). After backfill, any remaining NULL household_id means the
-- occurrence's task is standard, which couldn't have existed before this
-- migration; drop those if any.
delete from public.task_occurrences where household_id is null;

alter table public.task_occurrences
  alter column household_id set not null;

create index task_occurrences_household_idx
  on public.task_occurrences (household_id);

-- 4. Replace the unique constraint to include household_id.
--    Two different households can now have the same standard-task occurrence
--    on the same day, each with their own row.
alter table public.task_occurrences
  drop constraint task_occurrences_task_id_due_at_key;

alter table public.task_occurrences
  add constraint task_occurrences_hh_task_due_unique
  unique (household_id, task_id, due_at);

-- 5. Recreate the RLS policies on task_occurrences to use the new
--    household_id column directly (simpler + faster than the EXISTS join).
drop policy if exists task_occurrences_read on public.task_occurrences;
drop policy if exists task_occurrences_write on public.task_occurrences;

create policy task_occurrences_read on public.task_occurrences
  for select to authenticated
  using (public.has_active_membership(household_id));

create policy task_occurrences_write on public.task_occurrences
  for all to authenticated
  using (public.is_active_owner_or_maid(household_id))
  with check (public.is_active_owner_or_maid(household_id));

-- 6. household_task_hides — per-household "not applicable" flag for standard tasks.
create table public.household_task_hides (
  household_id           uuid not null references public.households(id) on delete cascade,
  task_id                uuid not null references public.tasks(id) on delete cascade,
  hidden_at              timestamptz not null default now(),
  hidden_by_profile_id   uuid references public.profiles(id) on delete set null,
  primary key (household_id, task_id)
);

create or replace function public.household_task_hides_check_standard()
  returns trigger language plpgsql as $$
  declare v_household_id uuid;
  begin
    select household_id into v_household_id from public.tasks where id = new.task_id;
    if v_household_id is not null then
      raise exception 'can only hide standard tasks' using errcode = '23514';
    end if;
    return new;
  end;
  $$;

create trigger household_task_hides_check_standard
  before insert on public.household_task_hides
  for each row execute function public.household_task_hides_check_standard();

alter table public.household_task_hides enable row level security;

create policy hth_read on public.household_task_hides
  for select to authenticated
  using (public.has_active_membership(household_id));

create policy hth_insert on public.household_task_hides
  for insert to authenticated
  with check (public.is_active_owner_or_maid(household_id));

create policy hth_delete on public.household_task_hides
  for delete to authenticated
  using (public.is_active_owner_or_maid(household_id));

-- 7. Rewrite tasks_generate_occurrences:
--    For each (household, applicable task) pair, materialize occurrences.
--    Applicable = (household-owned, active) OR (standard NOT in hides).
create or replace function public.tasks_generate_occurrences(p_horizon_date date)
  returns int
  language plpgsql security definer
  set search_path = public
  as $$
  declare
    v_inserted int := 0;
    v_household uuid;
    v_task     record;
    v_day      date;
    v_matches  boolean;
  begin
    for v_household in
      select distinct household_id
      from public.household_memberships
      where status = 'active'
    loop
      for v_task in
        select * from public.tasks t
        where archived_at is null
          and recurrence_starts_on <= p_horizon_date
          and (recurrence_ends_on is null or recurrence_ends_on >= current_date)
          and (
            t.household_id = v_household
            or (
              t.household_id is null
              and not exists (
                select 1 from public.household_task_hides h
                where h.household_id = v_household
                  and h.task_id = t.id
              )
            )
          )
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
            insert into public.task_occurrences (household_id, task_id, due_at)
            values (v_household, v_task.id, (v_day + v_task.due_time) at time zone 'Asia/Singapore')
            on conflict (household_id, task_id, due_at) do nothing;

            if found then
              v_inserted := v_inserted + 1;
            end if;
          end if;
        end loop;
      end loop;
    end loop;

    return v_inserted;
  end;
  $$;
