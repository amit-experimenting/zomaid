-- Slice 2 inventory — meal time configuration per household.
-- Default seeded on household creation; any active member may update.

create table public.household_meal_times (
  household_id  uuid not null references public.households(id) on delete cascade,
  slot          public.meal_slot not null,
  meal_time     time not null,
  updated_at    timestamptz not null default now(),
  primary key (household_id, slot)
);

create trigger household_meal_times_touch_updated_at
  before update on public.household_meal_times
  for each row execute function public.touch_updated_at();

alter table public.household_meal_times enable row level security;

create policy hmt_read on public.household_meal_times
  for select to authenticated
  using (public.has_active_membership(household_id));

-- Any active member can update meal times (per spec).
create policy hmt_insert on public.household_meal_times
  for insert to authenticated
  with check (public.has_active_membership(household_id));

create policy hmt_update on public.household_meal_times
  for update to authenticated
  using (public.has_active_membership(household_id))
  with check (public.has_active_membership(household_id));

create policy hmt_delete on public.household_meal_times
  for delete to authenticated
  using (public.has_active_membership(household_id));

-- Seed defaults on household creation. Trigger runs as the inserting role,
-- bypassing RLS via security definer so the insert works during onboarding.
create or replace function public.seed_default_meal_times()
  returns trigger
  language plpgsql security definer
  set search_path = public
  as $$
  begin
    insert into public.household_meal_times (household_id, slot, meal_time) values
      (new.id, 'breakfast', '08:00'),
      (new.id, 'lunch',     '13:00'),
      (new.id, 'snacks',    '17:00'),
      (new.id, 'dinner',    '20:00')
    on conflict (household_id, slot) do nothing;
    return new;
  end;
  $$;

create trigger households_seed_meal_times
  after insert on public.households
  for each row execute function public.seed_default_meal_times();

-- Backfill existing households (idempotent).
insert into public.household_meal_times (household_id, slot, meal_time)
select h.id, s.slot, s.meal_time
  from public.households h
  cross join (values
    ('breakfast'::public.meal_slot, '08:00'::time),
    ('lunch'::public.meal_slot,     '13:00'::time),
    ('snacks'::public.meal_slot,    '17:00'::time),
    ('dinner'::public.meal_slot,    '20:00'::time)
  ) as s(slot, meal_time)
on conflict (household_id, slot) do nothing;
