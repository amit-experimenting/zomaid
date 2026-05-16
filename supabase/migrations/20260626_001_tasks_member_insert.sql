-- Allow any active household member (owner, maid, or family_member) to insert
-- tasks. Previously restricted to owner/maid; broadened so family members can
-- add tasks (one-off reminders, future-dated chores) directly from /tasks/new.
--
-- Update/delete remain owner/maid-only — family adds a task, owner/maid edit
-- the recurrence or archive it. Occurrence writes (mark done/skipped) also
-- remain owner/maid via the existing task_occurrences_write policy.

drop policy if exists tasks_insert on public.tasks;

create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    household_id is not null
    and public.has_active_membership(household_id)
  );
