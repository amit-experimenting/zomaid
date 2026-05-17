-- supabase/migrations/20260709_001_household_profile_v2.sql
-- 2026-05-17 — Household profile + task library v2.
-- Adds household_profiles table, relevance_tags on tasks, wipes existing
-- task setup state, reseeds ~100 standard tasks with relevance tags.

-- 1. household_profiles table -----------------------------------------------

create table public.household_profiles (
  household_id      uuid primary key references public.households(id) on delete cascade,

  -- Demographics
  age_groups        text[] not null check (
    array_length(age_groups, 1) >= 1
    and age_groups <@ array['infants','school_age','teens','adults','seniors']
  ),
  pets              text not null check (pets in ('none','dog','cat','other','multiple')),
  work_hours        text not null check (work_hours in ('wfh','office','mixed','retired')),
  school_children   text not null check (school_children in ('all','some','homeschool','none_school_age')),

  -- Home features
  has_indoor_plants boolean not null,
  has_balcony       boolean not null,
  has_ac            boolean not null,
  has_polishables   boolean not null,

  completed_at      timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.household_profiles enable row level security;

create policy hp_read on public.household_profiles for select to authenticated
  using (public.is_active_owner_or_maid(household_id));

create policy hp_write on public.household_profiles for all to authenticated
  using (public.is_active_owner_or_maid(household_id))
  with check (public.is_active_owner_or_maid(household_id));

create trigger hp_touch_updated_at before update on public.household_profiles
  for each row execute function public.touch_updated_at();

-- 2. tasks.relevance_tags ---------------------------------------------------

alter table public.tasks
  add column relevance_tags text[] not null default '{}';

create index tasks_relevance_tags_gin on public.tasks using gin (relevance_tags);

-- 3. Wipe existing setup ----------------------------------------------------
--    No real users yet — intentional (matches the 2026-07-05 setup-gates pattern).
--    Clears household tasks, occurrences, hides, and resets the gate flag.

delete from public.task_occurrences;
delete from public.household_task_hides;
delete from public.tasks where household_id is not null;
delete from public.tasks where household_id is null;  -- old 13 standards
update public.households set task_setup_completed_at = null;
truncate public.task_setup_drafts;

-- 4. Seed new standards -----------------------------------------------------
insert into public.tasks
  (household_id, title, recurrence_frequency, recurrence_interval, recurrence_byweekday, recurrence_bymonthday, due_time, relevance_tags)
values
  -- DAILY · universal (morning)
  (null, 'Make tea/coffee for family',                  'daily', 1, null, null, '06:30', '{}'),
  (null, 'Prepare breakfast',                            'daily', 1, null, null, '07:00', '{}'),
  (null, 'Serve breakfast',                              'daily', 1, null, null, '08:00', '{}'),
  (null, 'Sweep and mop main living area',               'daily', 1, null, null, '09:00', '{}'),
  (null, 'Wash dishes — breakfast',                      'daily', 1, null, null, '09:30', '{}'),
  (null, 'Wipe kitchen counters and stove — morning',    'daily', 1, null, null, '09:45', '{}'),
  (null, 'Make beds in all bedrooms',                    'daily', 1, null, null, '10:00', '{}'),
  (null, 'Dust furniture and surfaces',                  'daily', 1, null, null, '10:30', '{}'),
  (null, 'Organize and tidy bedrooms',                   'daily', 1, null, null, '11:00', '{}'),

  -- DAILY · universal (lunch)
  (null, 'Prepare lunch ingredients',                    'daily', 1, null, null, '11:30', '{}'),
  (null, 'Cook lunch',                                   'daily', 1, null, null, '12:00', '{}'),
  (null, 'Serve lunch',                                  'daily', 1, null, null, '12:30', '{}'),
  (null, 'Wash dishes — lunch',                          'daily', 1, null, null, '13:00', '{}'),
  (null, 'Wipe kitchen counters and stove — afternoon',  'daily', 1, null, null, '13:30', '{}'),
  (null, 'Fold and put away dried laundry',              'daily', 1, null, null, '14:00', '{}'),

  -- DAILY · universal (evening)
  (null, 'Prepare evening tea/coffee',                   'daily', 1, null, null, '16:00', '{}'),
  (null, 'Start dinner preparation',                     'daily', 1, null, null, '16:30', '{}'),
  (null, 'Sweep kitchen floor',                          'daily', 1, null, null, '17:00', '{}'),
  (null, 'Serve dinner',                                 'daily', 1, null, null, '18:30', '{}'),
  (null, 'Clear dinner table',                           'daily', 1, null, null, '19:30', '{}'),
  (null, 'Take out kitchen trash',                       'daily', 1, null, null, '20:00', '{}'),
  (null, 'Wash dishes — dinner',                         'daily', 1, null, null, '20:30', '{}'),
  (null, 'Wipe kitchen counters and stove — evening',    'daily', 1, null, null, '21:00', '{}'),
  (null, 'Final kitchen cleanup',                        'daily', 1, null, null, '21:15', '{}'),

  -- DAILY · school (tagged)
  (null, 'Help children get ready for school',           'daily', 1, null, null, '07:30', '{school:all,school:some}'),
  (null, 'Pack school lunch boxes',                      'daily', 1, null, null, '08:30', '{school:all,school:some}'),
  (null, 'Accompany children to school bus stop',        'daily', 1, null, null, '08:45', '{school:all,school:some}'),
  (null, 'Receive children from school bus',             'daily', 1, null, null, '15:00', '{school:all,school:some}'),
  (null, 'Serve snacks to children',                     'daily', 1, null, null, '15:30', '{age:school_age,age:teens}'),

  -- DAILY · pet (tagged)
  (null, 'Feed pets — morning',                          'daily', 1, null, null, '07:30', '{pets:dog,pets:cat,pets:other,pets:multiple}'),
  (null, 'Feed pets — evening',                          'daily', 1, null, null, '18:30', '{pets:dog,pets:cat,pets:other,pets:multiple}'),
  (null, 'Walk dog — morning',                           'daily', 1, null, null, '07:00', '{pets:dog,pets:multiple}'),
  (null, 'Walk dog — evening',                           'daily', 1, null, null, '18:00', '{pets:dog,pets:multiple}'),

  -- DAILY · infant (tagged)
  (null, 'Sterilize baby bottles — morning',             'daily', 1, null, null, '10:00', '{age:infants}'),
  (null, 'Sterilize baby bottles — evening',             'daily', 1, null, null, '22:00', '{age:infants}'),
  (null, 'Prepare baby food / formula — morning',        'daily', 1, null, null, '11:00', '{age:infants}'),
  (null, 'Prepare baby food / formula — evening',        'daily', 1, null, null, '17:00', '{age:infants}'),

  -- DAILY · child (tagged)
  (null, 'Help with homework supervision',               'daily', 1, null, null, '16:00', '{age:school_age,age:teens}'),

  -- DAILY · elderly (tagged)
  (null, 'Assist with mobility as needed',               'daily', 1, null, null, '09:00', '{age:seniors}'),
  (null, 'Prepare special dietary meals',                'daily', 1, null, null, '12:00', '{age:seniors}'),
  (null, 'Medication reminders — morning',               'daily', 1, null, null, '09:00', '{age:seniors}'),
  (null, 'Medication reminders — afternoon',             'daily', 1, null, null, '14:00', '{age:seniors}'),
  (null, 'Medication reminders — evening',               'daily', 1, null, null, '21:00', '{age:seniors}'),

  -- EVERY 2 DAYS
  (null, 'Water indoor plants',                          'daily', 2, null, null, '08:00', '{feature:plants}'),
  (null, 'Iron clothes',                                 'daily', 2, null, null, '15:00', '{}'),

  -- EVERY 3 DAYS
  (null, 'Mop all bedroom floors',                       'daily', 3, null, null, '09:00', '{}'),
  (null, 'Clean kitchen cabinets (exterior)',            'daily', 3, null, null, '10:00', '{}'),
  (null, 'Wash and change kitchen towels',               'daily', 3, null, null, '14:00', '{}'),
  (null, 'Clean refrigerator shelves',                   'daily', 3, null, null, '15:00', '{}'),

  -- WEEKLY · Monday (byweekday: 0=Sun, 1=Mon, ... 6=Sat — Postgres int convention)
  (null, 'Wash and refill water-bottle drinking station','weekly', 1, '{1}', null, '09:00', '{}'),
  (null, 'Clean mirrors throughout house',               'weekly', 1, '{1}', null, '10:00', '{}'),
  (null, 'Wash doormats',                                'weekly', 1, '{1}', null, '14:00', '{}'),

  -- WEEKLY · Tuesday
  (null, 'Deep clean stovetop and oven',                 'weekly', 1, '{2}', null, '09:00', '{}'),
  (null, 'Clean bathrooms (toilets, sinks, tiles)',      'weekly', 1, '{2}', null, '10:00', '{}'),
  (null, 'Vacuum carpet and rugs',                       'weekly', 1, '{2}', null, '10:30', '{}'),
  (null, 'Organize kitchen pantry',                      'weekly', 1, '{2}', null, '11:00', '{}'),
  (null, 'Clean ceiling fans',                           'weekly', 1, '{2}', null, '14:00', '{}'),

  -- WEEKLY · Wednesday
  (null, 'Dust all photo frames and decorative items',   'weekly', 1, '{3}', null, '09:00', '{}'),
  (null, 'Clean balcony / terrace area',                 'weekly', 1, '{3}', null, '10:00', '{feature:balcony}'),
  (null, 'Wipe down all switches and door handles',      'weekly', 1, '{3}', null, '11:00', '{}'),

  -- WEEKLY · Thursday
  (null, 'Clean washing machine (empty cycle)',          'weekly', 1, '{4}', null, '09:00', '{}'),
  (null, 'Organize wardrobes and closets',               'weekly', 1, '{4}', null, '10:00', '{}'),
  (null, 'Vacuum under furniture and hard-to-reach areas','weekly', 1, '{4}', null, '11:00', '{}'),
  (null, 'Accompany to medical appointments',            'weekly', 1, '{4}', null, '10:00', '{age:seniors}'),

  -- WEEKLY · Friday
  (null, 'Deep clean bathrooms (scrub tiles, grout)',    'weekly', 1, '{5}', null, '09:00', '{}'),
  (null, 'Vacuum carpet and rugs — second pass',         'weekly', 1, '{5}', null, '10:30', '{}'),
  (null, 'Clean exhaust fans in kitchen and bathrooms',  'weekly', 1, '{5}', null, '11:00', '{}'),
  (null, 'Wipe windows and glass doors (interior)',      'weekly', 1, '{5}', null, '14:00', '{}'),

  -- WEEKLY · Saturday
  (null, 'Buy groceries from wet market or NTUC',        'weekly', 1, '{6}', null, '08:00', '{}'),
  (null, 'Clean litter boxes',                           'weekly', 1, '{6}', null, '09:00', '{pets:cat,pets:multiple}'),
  (null, 'Clean pet beds',                               'weekly', 1, '{6}', null, '09:30', '{pets:dog,pets:cat,pets:other,pets:multiple}'),
  (null, 'Clean and organize refrigerator thoroughly',   'weekly', 1, '{6}', null, '10:00', '{}'),
  (null, 'Wash curtains (rotate rooms each week)',       'weekly', 1, '{6}', null, '11:00', '{}'),
  (null, 'Polish wooden furniture',                      'weekly', 1, '{6}', null, '14:00', '{feature:polishables}'),

  -- WEEKLY · Sunday
  (null, 'Wash bedsheets and pillowcases',               'weekly', 1, '{0}', null, '09:00', '{}'),
  (null, 'Deep clean one room thoroughly (rotate weekly)','weekly', 1, '{0}', null, '10:00', '{}'),
  (null, 'Organize children''s study area',              'weekly', 1, '{0}', null, '11:00', '{age:school_age,age:teens}'),
  (null, 'Mop all floors with disinfectant',             'weekly', 1, '{0}', null, '11:30', '{}'),
  (null, 'Prepare weekly meal plan and shopping list',   'weekly', 1, '{0}', null, '14:00', '{}'),

  -- BI-WEEKLY (all on Wednesday, interval=2)
  (null, 'Clean microwave thoroughly',                   'weekly', 2, '{3}', null, '09:00', '{}'),
  (null, 'Descale kettle and coffee maker',              'weekly', 2, '{3}', null, '10:00', '{}'),
  (null, 'Clean A/C filters',                            'weekly', 2, '{3}', null, '11:00', '{feature:ac}'),
  (null, 'Wipe baseboards and skirting',                 'weekly', 2, '{3}', null, '14:00', '{}'),
  (null, 'Clean light fixtures and lampshades',          'weekly', 2, '{3}', null, '15:00', '{}'),

  -- MONTHLY · first week (days 1-4)
  (null, 'Deep clean oven and stovetop',                 'monthly', 1, null, 1, '09:00', '{}'),
  (null, 'Clean behind large appliances',                'monthly', 1, null, 2, '09:00', '{}'),
  (null, 'Wash windows and glass doors (exterior)',      'monthly', 1, null, 3, '09:00', '{}'),
  (null, 'Clean grout in bathrooms and kitchen',         'monthly', 1, null, 4, '09:00', '{}'),
  (null, 'Organize and declutter storage areas',         'monthly', 1, null, 4, '14:00', '{}'),

  -- MONTHLY · second week (days 8-11)
  (null, 'Clean under beds and heavy furniture',         'monthly', 1, null, 8, '09:00', '{}'),
  (null, 'Bathe and groom pets',                         'monthly', 1, null, 8, '10:00', '{pets:dog,pets:cat,pets:multiple}'),
  (null, 'Vacuum and flip mattresses',                   'monthly', 1, null, 9, '09:00', '{}'),
  (null, 'Clean window tracks and frames',               'monthly', 1, null, 10, '09:00', '{}'),
  (null, 'Wipe down walls and remove marks',             'monthly', 1, null, 11, '09:00', '{}'),

  -- MONTHLY · third week (days 15-18)
  (null, 'Deep clean kitchen cabinets (interior)',       'monthly', 1, null, 15, '09:00', '{}'),
  (null, 'Clean and organize utility / store room',      'monthly', 1, null, 16, '09:00', '{}'),
  (null, 'Wash and clean trash bins thoroughly',         'monthly', 1, null, 17, '09:00', '{}'),
  (null, 'Clean garage or car porch area',               'monthly', 1, null, 18, '09:00', '{}'),

  -- MONTHLY · fourth week (days 22-25)
  (null, 'Polish silverware and brass items',            'monthly', 1, null, 22, '09:00', '{feature:polishables}'),
  (null, 'Clean and organize children''s toy storage',   'monthly', 1, null, 23, '09:00', '{age:school_age,age:teens}'),
  (null, 'Seasonal clothing rotation and storage',       'monthly', 1, null, 24, '09:00', '{}'),
  (null, 'Check and replace air fresheners',             'monthly', 1, null, 25, '09:00', '{}');

-- 5. Sanity check -----------------------------------------------------------

do $$
declare v_count int;
begin
  select count(*) into v_count from public.tasks where household_id is null;
  if v_count < 95 or v_count > 110 then
    raise exception 'Seed row count out of expected range: % (expected 95-110)', v_count;
  end if;
end$$;
