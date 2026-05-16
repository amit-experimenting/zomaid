-- 2026-05-16 — Task setup gates + family-run household mode.
-- Adds maid_mode enum + two flag columns on households. Gates
-- tasks_generate_occurrences behind task_setup_completed_at. Resets every
-- household so the new wizard runs (no real users yet — intentional).

-- 1. Enum + columns ----------------------------------------------------------

create type public.maid_mode as enum ('unset', 'invited', 'family_run');

alter table public.households
  add column maid_mode               public.maid_mode not null default 'unset',
  add column task_setup_completed_at timestamptz null;

-- 2. task_setup_drafts -------------------------------------------------------
--    One row per household captures wizard-in-progress state so a refresh
--    or Back/Next round-trip doesn't lose picks/tunings.

create table public.task_setup_drafts (
  household_id     uuid primary key references public.households(id) on delete cascade,
  picked_task_ids  uuid[] not null default array[]::uuid[],
  tuned_json       jsonb null,
  updated_at       timestamptz not null default now()
);

alter table public.task_setup_drafts enable row level security;

create policy task_setup_drafts_read on public.task_setup_drafts
  for select to authenticated
  using (public.is_active_owner_or_maid(household_id));

create policy task_setup_drafts_write on public.task_setup_drafts
  for all to authenticated
  using (public.is_active_owner_or_maid(household_id))
  with check (public.is_active_owner_or_maid(household_id));

-- 3. Destructive reset -------------------------------------------------------
--    No real users yet. Wipe so the new gated flow surfaces for every
--    household on next visit. Standards (household_id IS NULL) are kept.

delete from public.task_occurrences;
delete from public.household_task_hides;
delete from public.tasks where household_id is not null;

-- All existing households are now back at the gate: maid_mode='unset'
-- (default), task_setup_completed_at IS NULL (default).

-- 4. Gated tasks_generate_occurrences ---------------------------------------
--    Skip households whose task_setup_completed_at IS NULL. Otherwise
--    identical to the previous version.

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
      select hm.household_id
      from public.household_memberships hm
      join public.households h on h.id = hm.household_id
      where hm.status = 'active'
        and h.task_setup_completed_at is not null
      group by hm.household_id
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

-- 5. Maid-join trigger -------------------------------------------------------
--    When an active maid membership appears, ensure maid_mode = 'invited'.
--    Covers both invite-redemption (INSERT) and reactivation (UPDATE).

create or replace function public.households_sync_maid_mode_on_join()
  returns trigger language plpgsql security definer
  set search_path = public
  as $$
  begin
    if new.role = 'maid' and new.status = 'active' then
      update public.households
        set maid_mode = 'invited'
        where id = new.household_id
          and maid_mode <> 'invited';
    end if;
    return new;
  end;
  $$;

create trigger household_memberships_sync_maid_mode
  after insert or update on public.household_memberships
  for each row execute function public.households_sync_maid_mode_on_join();
