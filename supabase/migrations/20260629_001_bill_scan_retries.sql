-- Bill-scan retry queue.
--
-- When /api/bills/scan's synchronous Sonnet call fails (timeout, 5xx,
-- malformed JSON), the route stashes the user's photo in a private
-- bill-scan-pending bucket and inserts a row here for the cron worker
-- (/api/cron/retry-bill-scans, */15) to pick up.
--
-- See docs/specs/2026-05-16-bill-scan-retry-queue-design.md.

create table public.bill_scan_attempts (
  id                       uuid primary key default gen_random_uuid(),
  household_id             uuid not null references public.households(id) on delete cascade,
  uploaded_by_profile_id   uuid references public.profiles(id) on delete set null,
  storage_path             text not null,                           -- inside bill-scan-pending bucket
  mime_type                text not null,
  status                   text not null default 'pending',         -- pending | succeeded | failed
  attempts                 int  not null default 0,
  max_attempts             int  not null default 3,
  last_error               text,
  last_attempted_at        timestamptz,
  parsed_payload           jsonb,                                   -- populated on success
  produced_bill_id         uuid references public.bills(id) on delete set null,
  reviewed_at              timestamptz,                             -- when user finalised (or admin resolved)
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint bill_scan_attempts_status_check
    check (status in ('pending', 'succeeded', 'failed'))
);

-- Cron pick-up: only ready-to-retry pending rows; nulls first so brand-new
-- inserts get picked up on the very next tick.
create index bill_scan_attempts_pending_idx
  on public.bill_scan_attempts (last_attempted_at nulls first)
  where status = 'pending' and attempts < max_attempts;

-- User queue: a caller's unreviewed-but-succeeded rows. Drives the
-- "ready to review" section + the inventory-tab dot badge.
create index bill_scan_attempts_user_unreviewed_idx
  on public.bill_scan_attempts (uploaded_by_profile_id)
  where status = 'succeeded' and reviewed_at is null;

-- Household queue: members can see the full list per household.
create index bill_scan_attempts_household_idx
  on public.bill_scan_attempts (household_id);

alter table public.bill_scan_attempts enable row level security;

-- Self-read: a user can see their own attempts (any status).
create policy bsa_self_read on public.bill_scan_attempts
  for select to authenticated
  using (uploaded_by_profile_id = public.current_profile_id());

-- Household-read: active members can see attempts for their household
-- (so an owner can spot a maid's pending bills on the household card).
create policy bsa_household_read on public.bill_scan_attempts
  for select to authenticated
  using (public.has_active_membership(household_id));

-- Admin-read (cross-tenant).
create policy bsa_admin_read on public.bill_scan_attempts
  for select to authenticated
  using (public.current_is_admin());

-- No write policies — all writes are service-role:
--   /api/bills/scan (insert on failure)
--   /api/cron/retry-bill-scans (update on retry)
--   /scans/actions (discard + cancel)
--   /admin/bill-scans/actions (reset + resolve)
--   uploadBillFromScan (stamp produced_bill_id + reviewed_at on save)

create trigger bsa_touch_updated_at
  before update on public.bill_scan_attempts
  for each row execute function public.touch_updated_at();

-- Bucket for queued bill images. Private — service-role only, accessed
-- via signed URLs from the review pages. No storage RLS policies because
-- no authenticated user ever reads/writes the bucket directly.
insert into storage.buckets (id, name, public)
  values ('bill-scan-pending', 'bill-scan-pending', false)
  on conflict (id) do nothing;
