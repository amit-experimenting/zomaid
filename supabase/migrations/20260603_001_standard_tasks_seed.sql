-- Slice 5 — Seed standard household tasks for SG maids.
-- household_id IS NULL → visible to every household by default.
-- Households can mark any of these "not applicable" via household_task_hides.

-- Day-of-week reference: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat.

insert into public.tasks
  (household_id, title, notes, recurrence_frequency, recurrence_interval,
   recurrence_byweekday, recurrence_bymonthday, due_time, recurrence_starts_on)
values
  -- Daily essentials
  (null, 'Sweep and mop main living area',
   'Living room, dining, kitchen floor.',
   'daily', 1, null, null, '09:00:00', current_date),

  (null, 'Take out kitchen trash',
   'Tie bag, replace liner, take to chute/bin.',
   'daily', 1, null, null, '20:00:00', current_date),

  (null, 'Wash dishes after dinner',
   'Includes pots & pans; wipe stovetop after.',
   'daily', 1, null, null, '20:30:00', current_date),

  (null, 'Wipe kitchen counters and stove',
   null,
   'daily', 1, null, null, '20:30:00', current_date),

  -- Every-other-day chores
  (null, 'Water indoor plants',
   'Lightly mist leaves on hot days; check soil before watering.',
   'daily', 2, null, null, '08:00:00', current_date),

  (null, 'Iron clothes',
   'Whatever''s in the ironing pile; hang in wardrobe after.',
   'daily', 2, null, null, '15:00:00', current_date),

  -- Twice-weekly
  (null, 'Clean bathrooms',
   'Toilets, sinks, shower; replace toilet roll if low.',
   'weekly', 1, array[2, 5], null, '10:00:00', current_date),  -- Tue + Fri

  (null, 'Vacuum carpet and rugs',
   null,
   'weekly', 1, array[2, 5], null, '10:30:00', current_date),  -- Tue + Fri

  -- Weekly
  (null, 'Wash bedsheets',
   'All beds; pillowcases and duvet covers too.',
   'weekly', 1, array[0], null, '09:00:00', current_date),     -- Sun

  (null, 'Wipe windows and glass doors',
   'Inside surfaces; use glass cleaner.',
   'weekly', 1, array[6], null, '14:00:00', current_date),     -- Sat

  (null, 'Wash and refill water-bottle drinking station',
   null,
   'weekly', 1, array[1], null, '09:00:00', current_date),     -- Mon

  (null, 'Buy groceries from wet market or NTUC',
   'Use the shopping list from /shopping.',
   'weekly', 1, array[6], null, '08:00:00', current_date),     -- Sat

  -- Monthly
  (null, 'Wipe ceiling fans and air-con vents',
   'Step ladder; damp cloth followed by dry cloth.',
   'monthly', 1, null, 15, '10:00:00', current_date),

  (null, 'Defrost and clean fridge',
   'Throw expired items; wipe shelves with bicarb solution.',
   'monthly', 1, null, 1, '09:00:00', current_date);
