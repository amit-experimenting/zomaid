-- Slice 5 — Tasks, occurrences, and push subscriptions.
-- See docs/specs/2026-05-11-slice-5-tasks-reminders-push-design.md §4-5.

create type public.recurrence_frequency as enum ('daily', 'weekly', 'monthly');
create type public.task_occurrence_status as enum ('pending', 'done', 'skipped');

create table public.tasks (
  id                       uuid primary key default gen_random_uuid(),
  household_id             uuid not null references public.households(id) on delete cascade,
  title                    text not null check (length(title) between 1 and 120),
  notes                    text check (notes is null or length(notes) <= 1000),
  assigned_to_profile_id   uuid references public.profiles(id) on delete set null,
  recurrence_frequency     public.recurrence_frequency not null,
  recurrence_interval      int not null default 1 check (recurrence_interval > 0),
  recurrence_byweekday     int[],
  recurrence_bymonthday    int check (recurrence_bymonthday is null
                                      or recurrence_bymonthday between 1 and 31),
  recurrence_starts_on     date not null default current_date,
  recurrence_ends_on       date,
  due_time                 time not null default '09:00:00',
  created_by_profile_id    uuid references public.profiles(id) on delete set null,
  archived_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint tasks_recurrence_shape check (
    (recurrence_frequency = 'daily'
      and recurrence_byweekday is null
      and recurrence_bymonthday is null)
    or
    (recurrence_frequency = 'weekly'
      and recurrence_byweekday is not null
      and array_length(recurrence_byweekday, 1) between 1 and 7
      and recurrence_bymonthday is null)
    or
    (recurrence_frequency = 'monthly'
      and recurrence_byweekday is null
      and recurrence_bymonthday is not null)
  )
);

create index tasks_household_active_idx
  on public.tasks (household_id)
  where archived_at is null;

create index tasks_assigned_idx
  on public.tasks (assigned_to_profile_id)
  where assigned_to_profile_id is not null;

create trigger tasks_touch_updated_at
  before update on public.tasks
  for each row execute function public.touch_updated_at();

alter table public.tasks enable row level security;

create policy tasks_read on public.tasks
  for select to authenticated
  using (public.has_active_membership(household_id));

create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (public.is_active_owner_or_maid(household_id));

create policy tasks_update on public.tasks
  for update to authenticated
  using (public.is_active_owner_or_maid(household_id))
  with check (public.is_active_owner_or_maid(household_id));

create policy tasks_delete on public.tasks
  for delete to authenticated
  using (public.is_active_owner_or_maid(household_id));

-- Occurrences
create table public.task_occurrences (
  id                       uuid primary key default gen_random_uuid(),
  task_id                  uuid not null references public.tasks(id) on delete cascade,
  due_at                   timestamptz not null,
  status                   public.task_occurrence_status not null default 'pending',
  completed_by_profile_id  uuid references public.profiles(id) on delete set null,
  completed_at             timestamptz,
  notified_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (task_id, due_at)
);

create index task_occurrences_pending_due_idx
  on public.task_occurrences (due_at)
  where status = 'pending';

create index task_occurrences_task_due_idx
  on public.task_occurrences (task_id, due_at desc);

create trigger task_occurrences_touch_updated_at
  before update on public.task_occurrences
  for each row execute function public.touch_updated_at();

alter table public.task_occurrences enable row level security;

create policy task_occurrences_read on public.task_occurrences
  for select to authenticated
  using (
    exists (select 1 from public.tasks t
            where t.id = task_id
              and public.has_active_membership(t.household_id))
  );

create policy task_occurrences_write on public.task_occurrences
  for all to authenticated
  using (
    exists (select 1 from public.tasks t
            where t.id = task_id
              and public.is_active_owner_or_maid(t.household_id))
  )
  with check (
    exists (select 1 from public.tasks t
            where t.id = task_id
              and public.is_active_owner_or_maid(t.household_id))
  );

-- Push subscriptions: per-profile, not per-household.
create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint      text not null unique,
  p256dh_key    text not null,
  auth_key      text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

create index push_subscriptions_profile_active_idx
  on public.push_subscriptions (profile_id)
  where revoked_at is null;

alter table public.push_subscriptions enable row level security;

-- Subscriptions are personal: caller can only see/manage their own profile's.
create policy push_subscriptions_read on public.push_subscriptions
  for select to authenticated
  using (
    profile_id in (select id from public.profiles
                   where clerk_user_id = (auth.jwt() ->> 'sub'))
  );

create policy push_subscriptions_insert on public.push_subscriptions
  for insert to authenticated
  with check (
    profile_id in (select id from public.profiles
                   where clerk_user_id = (auth.jwt() ->> 'sub'))
  );

create policy push_subscriptions_update on public.push_subscriptions
  for update to authenticated
  using (
    profile_id in (select id from public.profiles
                   where clerk_user_id = (auth.jwt() ->> 'sub'))
  )
  with check (
    profile_id in (select id from public.profiles
                   where clerk_user_id = (auth.jwt() ->> 'sub'))
  );

create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated
  using (
    profile_id in (select id from public.profiles
                   where clerk_user_id = (auth.jwt() ->> 'sub'))
  );
