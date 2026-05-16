# Zomaid — Slice 5: Tasks + Reminders + Web Push — Design

> **Superseded as the living architecture doc for the tasks area by [`features/tasks.md`](features/tasks.md).** This dated spec is retained for historical context.

- **Date**: 2026-05-11
- **Status**: Approved (brainstorming) — pending implementation plan
- **Slice**: 5 of 7
- **Owner**: amit@instigence.com
- **Depends on**: [2026-05-10 Foundations Design](./2026-05-10-foundations-design.md), [2026-05-11 Slice 2a Design](./2026-05-11-slice-2a-recipes-meal-plan-design.md), [2026-05-11 Slice 2b Design](./2026-05-11-slice-2b-shopping-list-design.md), [2026-05-11 Slice 3 Design](./2026-05-11-slice-3-bill-scanning-ocr-design.md)

## 1. Context

Slice 5 delivers the **tasks + reminders** module: recurring household chores ("wash bedsheets every Sunday", "water plants every other day", "pay electricity bill on the 5th"), with Web Push notifications that buzz the owner's and maid's phones when a task is due. The foundations slice wired Serwist into the PWA; this slice extends the service worker with `push` and `notificationclick` handlers, plus adds a VAPID-keyed Web Push fan-out from a Vercel Cron job.

Tasks are first-class household entities. Each task carries a recurrence rule (preset frequency + interval), an assigned-to profile (or "anyone"), and a due time-of-day. A nightly pg_cron job materializes the next 7 days of occurrences. A second cron (every 5 minutes, on Vercel) scans for occurrences that have just come due and fires push notifications to the owner + maid via the `web-push` library.

## 2. Decomposition

| # | Slice | Status |
|---|---|---|
| 1 | Foundations | Done |
| 2a | Recipes + meal plan + suggestion engine | Done |
| 2b | Shopping list | Done |
| 3 | Bill scanning + OCR | Done (pre-flight pending) |
| 4 | Fridge with expiry recommendations | Pending |
| 5 | Tasks + reminders + Web Push (this doc) | Designing |
| 6 | Billing + subscription tiers | Pending |
| 7 | Admin tools | Pending |

## 3. Decisions log (from brainstorming, 2026-05-11)

| Q | Decision |
|---|---|
| Task shape | **Title + recurrence + assigned-to + optional notes.** Each scheduled firing becomes a `task_occurrence` row. |
| Recurrence model | **Presets + interval** — daily / weekly+days-of-week / monthly+day-of-month, each with an `every N units` interval. Covers "every other Sunday." No iCal RRULE in v1. |
| Permissions | **Owner + maid create/edit AND mark done; family read-only** (matches slice 2a/2b/3). |
| Occurrence firing | **Nightly pg_cron at 22:00 SGT** materializes the next 7 days of occurrences. **Every-5-min Vercel Cron** scans for due+unnotified occurrences and dispatches push. |
| Notification scope | **Only owner + maid** get push (the people who can mark done). Family sees tasks in the app but never gets a notification. |
| Occurrence actions | **Done + Skip** only. No snooze. If notification ignored, next 5-minute scan **does not** re-notify (notified_at is set on first send; only manual undone state would re-trigger). |
| Opt-in UX | **Chip at top of `/tasks` page** — "Notifications: Off | Enable." Tapping triggers `Notification.requestPermission()` + push subscription. Per-profile, per-device. |
| UI views | **Today list + upcoming list** (next 7 days, grouped by date). No calendar view in v1. |
| Retention | **Auto-prune** completed/skipped occurrences older than 90 days via daily cron. |

## 4. Domain model

### 4.1 Enums

```
recurrence_frequency: 'daily' | 'weekly' | 'monthly'
task_occurrence_status: 'pending' | 'done' | 'skipped'
```

### 4.2 Tables

```
tasks
  id                        (uuid pk, default gen_random_uuid())
  household_id              (uuid fk → households, ON DELETE CASCADE, not null)
  title                     (text not null, CHECK length between 1 and 120)
  notes                     (text, NULL ok, CHECK length <= 1000)
  assigned_to_profile_id    (uuid fk → profiles, ON DELETE SET NULL, NULL = "anyone")
  recurrence_frequency      (recurrence_frequency, not null)
  recurrence_interval       (int, not null, default 1, CHECK > 0)
  recurrence_byweekday      (int[], NULL ok)
                              -- Only for frequency='weekly'. Values 0..6 (0=Sun). Must have at least 1 entry.
  recurrence_bymonthday     (int, NULL ok, CHECK is null or between 1 and 31)
                              -- Only for frequency='monthly'. The day-of-month the task fires.
  recurrence_starts_on      (date, not null, default current_date)
  recurrence_ends_on        (date, NULL ok)
                              -- Optional end-date. NULL = forever.
  due_time                  (time, not null, default '09:00:00')
                              -- Time-of-day to fire (SGT-local).
  created_by_profile_id     (uuid fk → profiles, ON DELETE SET NULL, not null)
  archived_at               (timestamptz, NULL ok)
  created_at, updated_at    (timestamptz, defaults; updated_at maintained by trigger)

  CHECK tasks_recurrence_shape (
    (recurrence_frequency = 'daily' AND recurrence_byweekday IS NULL AND recurrence_bymonthday IS NULL)
    OR
    (recurrence_frequency = 'weekly' AND recurrence_byweekday IS NOT NULL
     AND array_length(recurrence_byweekday, 1) BETWEEN 1 AND 7
     AND recurrence_bymonthday IS NULL)
    OR
    (recurrence_frequency = 'monthly' AND recurrence_byweekday IS NULL AND recurrence_bymonthday IS NOT NULL)
  )

  index on (household_id, archived_at) where archived_at is null
  index on (assigned_to_profile_id) where assigned_to_profile_id is not null

task_occurrences
  id                          (uuid pk)
  task_id                     (uuid fk → tasks, ON DELETE CASCADE, not null)
  due_at                      (timestamptz, not null)
                                -- Materialized due time. Stored UTC, computed from task.due_time + task.tz (SGT).
  status                      (task_occurrence_status, not null, default 'pending')
  completed_by_profile_id     (uuid fk → profiles, ON DELETE SET NULL, NULL ok)
  completed_at                (timestamptz, NULL ok)
  notified_at                 (timestamptz, NULL ok)
                                -- When push was last sent. Used to suppress re-notify.
  created_at, updated_at      (timestamptz)
  UNIQUE (task_id, due_at)    -- idempotent generation; cron can re-run safely

  index on (status, due_at)   where status = 'pending'
  index on (task_id, due_at desc)

push_subscriptions
  id              (uuid pk)
  profile_id      (uuid fk → profiles, ON DELETE CASCADE, not null)
  endpoint        (text not null, UNIQUE)
                    -- The Web Push endpoint URL the browser hands us.
  p256dh_key      (text not null)
  auth_key        (text not null)
  user_agent      (text, NULL ok)
  created_at      (timestamptz, default now())
  last_used_at    (timestamptz, NULL ok)
  revoked_at      (timestamptz, NULL ok)
                    -- Set when a push send returns 410 Gone; we stop using this row.

  index on (profile_id) where revoked_at is null
```

### 4.3 Why `due_at` is stored UTC

`task.due_time` is local (SGT). When materializing occurrences, the cron computes `due_at = (occurrence_date at time zone 'Asia/Singapore' + due_time) at time zone 'UTC'`. Stored as `timestamptz`. The dispatcher cron compares against `now()` which is also `timestamptz`-aware. This avoids DST traps (Singapore has none, but the pattern stays portable).

## 5. Authorization (RLS)

Reuses slice 2a helpers (`has_active_membership`, `is_active_owner_or_maid`).

```
tasks
  read:   has_active_membership(household_id)
  write:  is_active_owner_or_maid(household_id)

task_occurrences
  read:   EXISTS (task where caller can read it)
  write:  EXISTS (task where caller can write it)
  -- pg_cron runs as postgres → bypasses RLS, can insert across all households.

push_subscriptions
  read:   profile_id IN (SELECT id FROM profiles WHERE clerk_user_id = auth.jwt() ->> 'sub')
  insert: same (caller can only create subscriptions on their own profile)
  update: same (revoke, update last_used_at)
  delete: same
```

The Vercel Cron route handler uses the **service-role Supabase client** (from slice 3) to read across households and dispatch.

## 6. Architecture

### 6.1 Nightly occurrence generation

```sql
tasks_generate_occurrences(p_horizon_date date)
  RETURNS int    -- count of occurrences inserted
  -- security definer (runs as postgres via pg_cron; granted only to postgres/service_role)
  --
  -- For each task where archived_at IS NULL and recurrence is still in effect:
  --   1. For each date D in [current_date, p_horizon_date] where the task fires:
  --        - daily, interval=N → fires every N days from recurrence_starts_on
  --        - weekly, interval=N → fires every N weeks from recurrence_starts_on,
  --          on weekdays in recurrence_byweekday
  --        - monthly, interval=N → fires every N months from recurrence_starts_on,
  --          on day-of-month = recurrence_bymonthday
  --   2. Compute due_at = (D + task.due_time) AT TIME ZONE 'Asia/Singapore' AT TIME ZONE 'UTC'.
  --   3. INSERT INTO task_occurrences (task_id, due_at) ON CONFLICT (task_id, due_at) DO NOTHING.
  --
  -- Returns total inserted count.

tasks_prune_old(p_days int default 90)
  RETURNS int
  -- DELETE FROM task_occurrences WHERE status IN ('done','skipped')
  --   AND completed_at < now() - (p_days || ' days')::interval.
  -- Returns deleted count.
```

pg_cron schedule:

```sql
SELECT cron.schedule(
  'tasks-generate-and-prune',
  '0 22 * * *',                      -- 22:00 SGT (DB timezone)
  $$ SELECT tasks_generate_occurrences(current_date + 7); SELECT tasks_prune_old(90); $$
);
```

### 6.2 Vercel Cron push dispatch (every 5 minutes)

`vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/dispatch-task-pushes",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

`/api/cron/dispatch-task-pushes` handler:

1. Verify `Authorization: Bearer ${CRON_SECRET}` header. (Vercel Cron adds this automatically when `CRON_SECRET` env var is set.)
2. Create service-role Supabase client.
3. Query: `SELECT * FROM task_occurrences WHERE status='pending' AND notified_at IS NULL AND due_at <= now() LIMIT 200`. (Caps the per-run fanout for safety.)
4. For each occurrence, join up: task → household → memberships with `role IN ('owner','maid') AND status='active'` → profile_ids → active `push_subscriptions` (revoked_at IS NULL).
5. For each subscription, call `web-push.sendNotification(subscription, payload)` with:
   - `title`: task title
   - `body`: e.g., "Due now" or "Assigned to <name>"
   - `data`: `{ taskId, occurrenceId }` so the SW can deep-link
   - `vapidDetails`: from `VAPID_*` env vars
6. On 410 Gone response: mark that `push_subscriptions.revoked_at = now()`.
7. On any successful send for an occurrence: mark `task_occurrences.notified_at = now()` (do this once per occurrence, not per subscription).
8. Return `{ processed: N }`.

### 6.3 Service worker push handlers (`src/app/sw.ts`)

Add to the existing Serwist setup:

```ts
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const payload = event.data.json() as {
    title: string;
    body: string;
    data?: { taskId?: string; occurrenceId?: string };
  };
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",      // assumes foundations PWA manifest icon
      badge: "/icon-192.png",
      tag: payload.data?.occurrenceId ?? "task",  // collapses duplicate pushes
      data: payload.data ?? {},
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const url = "/tasks";
      const existing = clients.find((c) => c.url.includes("/tasks"));
      if (existing) {
        existing.focus();
      } else {
        self.clients.openWindow(url);
      }
    }),
  );
});
```

## 7. API surface

### 7.1 Server actions — `src/app/tasks/actions.ts`

```
createTask(input)
  input: { title, notes?, assignedToProfileId?,
           recurrence: {
             frequency: 'daily'|'weekly'|'monthly',
             interval: number,
             byweekday?: number[],      // weekly only
             bymonthday?: number,       // monthly only
             startsOn?: 'YYYY-MM-DD',
             endsOn?: 'YYYY-MM-DD',
           },
           dueTime?: 'HH:MM:SS' }
  effect: owner/maid only. Zod-validates the recurrence shape against frequency.
          Inserts tasks row. Returns { taskId }. Optionally triggers an immediate
          tasks_generate_occurrences(current_date + 7) so the new task appears in
          today's/this-week's UI without waiting for tonight's cron.

updateTask({ taskId, ...patches })
  effect: owner/maid only. Patches scalar fields. If recurrence changes, deletes
          all FUTURE pending occurrences (due_at > now) and regenerates them.

archiveTask({ taskId })
  effect: owner/maid only. Sets archived_at = now(). Deletes future pending
          occurrences. Past occurrences are retained for history.

markOccurrenceDone({ occurrenceId })
markOccurrenceSkipped({ occurrenceId })
  effect: owner/maid only. Sets status + completed_by_profile_id + completed_at.

subscribePush({ endpoint, p256dh, auth, userAgent })
  effect: any active member. Upserts a push_subscriptions row for the caller's
          profile. If a row with this endpoint already exists for a different
          profile (browser shared), revoke the old row and create new.

unsubscribePush({ endpoint })
  effect: any active member. Sets revoked_at = now() on the matching row owned
          by the caller.
```

### 7.2 Cron route — `src/app/api/cron/dispatch-task-pushes/route.ts`

POST handler (Vercel Cron triggers POST):

1. `Authorization: Bearer ${CRON_SECRET}` check — return 401 if mismatched.
2. Run the §6.2 query and dispatch logic.
3. Return JSON `{ processed: int, errors: int }`.

### 7.3 Error codes added by this slice

```
TASK_NOT_FOUND
TASK_FORBIDDEN
TASK_INVALID                       -- Zod validation failed
TASK_RECURRENCE_INVALID            -- frequency-vs-byweekday/bymonthday mismatch
OCCURRENCE_NOT_FOUND
OCCURRENCE_ALREADY_RESOLVED        -- mark-done/skip on already done/skipped
PUSH_SUBSCRIPTION_INVALID
PUSH_CRON_UNAUTHORIZED             -- 401 from cron route
```

## 8. UI

### 8.1 Routes added

```
/tasks           Today + upcoming list
/tasks/new       Create form
/tasks/[id]/edit Edit form
```

### 8.2 `/tasks` — landing

- **Top bar**: title "Tasks" + **+ New** button (owner/maid only).
- **Notifications chip** (right of title): "Notifications: Off" → tap → browser permission prompt → on grant, subscribe to push, store subscription, chip becomes "Notifications: On (this device)". Tap again → unsubscribe. Hidden for family role.
- **Today section**: pending+overdue occurrences for today. Each row: task title + assignee chip + time → tap shows action sheet (Done / Skip / Open task).
- **Upcoming section**: pending occurrences for the next 7 days, grouped by date. Read-only display per day; tap a row to open the task.
- **Empty state**: "No tasks yet. Add one →" linking to `/tasks/new`.

### 8.3 `/tasks/new` and `/tasks/[id]/edit`

Form fields:
1. **Title** — required, max 120.
2. **Notes** — optional, max 1000.
3. **Assignee** — dropdown of active household members + "Anyone" (default).
4. **Recurrence**:
   - **Frequency** segmented control: Daily / Weekly / Monthly.
   - **Interval**: "every [N] {days|weeks|months}".
   - **If Weekly**: 7-day chip selector (Sun..Sat); at least one required.
   - **If Monthly**: day-of-month number input (1–31).
5. **Due time**: time input (default 09:00).
6. **Starts on**: date input (default today).
7. **Ends on**: date input (optional).

Submit calls `createTask` / `updateTask`.

### 8.4 MainNav

5 links now: Plan · Recipes · Shopping · Bills · **Tasks**. `MainNav.Route` type widens to include `"tasks"`. Inserted at the top of `/tasks`, `/tasks/new`, `/tasks/[id]/edit`.

### 8.5 Proxy gate

`src/proxy.ts` adds `"/tasks(.*)"` to `isAuthGated`.

## 9. Edge cases

- **Task created mid-week**: `createTask` triggers an immediate `tasks_generate_occurrences(current_date + 7)` so today's/this-week's instances appear without waiting for the 22:00 cron.
- **Task recurrence edited**: future pending occurrences are deleted and re-materialized. Past + already-completed rows are untouched.
- **Task archived**: future pending occurrences are deleted. Past rows kept for history (visible in the deferred "Done" history view — UI defers to v2; for v1 only pending+today is shown).
- **Browser permission denied**: chip stays "Off" + adds a small "(blocked — re-enable in site settings)" hint. No further automatic prompts.
- **iOS PWA notifications**: require iOS 16.4+ AND the app installed to home screen (`display: standalone`). Document in the UI: a small "?" tooltip explains the install-to-home-screen requirement on iOS.
- **Push subscription on multiple devices**: each device has its own endpoint → its own row. Fan-out hits all non-revoked rows. Acceptable for v1.
- **Push subscription returns 410 Gone**: dispatcher marks `revoked_at = now()`. The user's next visit to `/tasks` with the chip on will re-subscribe (creating a new row).
- **Notification fired but user never sees it (offline phone)**: when phone comes back online, the browser delivers queued pushes (~24h window per spec; varies by platform). After that, the next 5-min scan won't re-fire because `notified_at` is set. Acceptable: if missed, user will see the pending occurrence in the app.
- **Cron route accidentally invoked from outside Vercel**: `CRON_SECRET` mismatch → 401.
- **`web-push` payload size**: ≤ 4 KB. Our payloads are tiny (title + body + small data). Safe.
- **Task with `assigned_to_profile_id` set, but that profile is removed from the household**: assignment doesn't gate push — owner/maid still get notified. UI shows "Assigned to: (former member)" or similar. Acceptable.
- **Cron scan starves under load**: query has `LIMIT 200` per run. If more than 200 occurrences pile up, the next 5-min scan catches the rest. With per-household task volume in v1 (probably <50/day), this won't happen.
- **Vercel Cron not available** (Hobby plan, no Pro): explicitly flagged in pre-flight; the dispatcher just won't run. Tasks still work as a list-only app; notifications are silent. Document.
- **Concurrent dispatch runs**: in theory Vercel could overlap. Mitigation: the `notified_at IS NULL` filter + `UPDATE … SET notified_at = now() WHERE notified_at IS NULL` makes the marker idempotent; worst case is a duplicate push, not a missed one.

## 10. Testing strategy

Same shape as 2a/2b/3 — DB + actions + E2E. Slice 5 also needs **cron route tests**.

- **DB-level**: RLS coverage on `tasks`, `task_occurrences`, `push_subscriptions` (incl. per-profile isolation on push_subscriptions). Recurrence-shape CHECK constraint. `tasks_generate_occurrences` invariants (idempotency on re-run, weekly/monthly fanout correctness, daily-with-interval=2 generates every other day).
- **Server-action level**: createTask + Zod recurrence shape validation; updateTask with recurrence change deletes-and-regenerates future occurrences; archiveTask deletes future-only; markOccurrenceDone happy path + RLS rejection.
- **Cron route**: 401 on bad auth; correct fan-out to owner+maid subscriptions; 410 marks revoked; idempotency (notified_at not re-set).
- **E2E (Playwright)**: `/tasks` route gating; authenticated walkthrough is part of the manual checklist.

Per the user's "skip tests" instruction, the implementation plan ships test tasks as separate steps that can be deferred.

## 11. Out of scope (deferred)

- **Snooze** ("remind me in 1h"). User asked specifically for Done + Skip only.
- **Calendar / week view.**
- **Per-task lead-time reminder** ("notify 30 min before due").
- **Notification action buttons** (Mark done inline in the notification — inconsistent browser support).
- **Task templates / starter chores.**
- **Subtasks, dependencies, deadlines** (GTD-style).
- **Per-profile notification preferences** (mute specific tasks).
- **Categories / priorities.**
- **One-off (non-recurring) tasks** — all v1 tasks have recurrence.
- **Email digest fallback** when push isn't available.
- **History view** ("show me everything done in the last 30 days") — v2.
- **Task analytics** ("how often is this task actually completed on time?") — v2.

## 12. Pre-flight (one-time manual setup before Task 1)

- **A. Generate VAPID keys.** Run:
  ```bash
  npx web-push generate-vapid-keys
  ```
  Save:
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public key>`
  - `VAPID_PRIVATE_KEY=<private key>`
  - `VAPID_SUBJECT=mailto:dharni05@gmail.com`

  Set these in `.env.local` and (later) on Vercel Production + Preview.

- **B. Generate CRON_SECRET.** Run `openssl rand -hex 32`. Save as `CRON_SECRET` in `.env.local` and on Vercel.

- **C. (Prod) Vercel Cron requires Pro plan.** Hobby plan has cron but the minimum interval is 1/day. The 5-min push dispatch needs Pro. Document this; if you're on Hobby, slice 5 ships as a no-notification task tracker until you upgrade. Local dev: the cron can be triggered manually via `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/dispatch-task-pushes`.

- **D. (Optional, for iOS users)** Document: iOS users must install the app to home screen (Share → Add to Home Screen) before notifications work. Requires iOS 16.4+. Surface a tooltip on the notifications chip explaining this.

When A and B are green (C is optional for dev), start Task 1.

## 13. Risks & open questions

- **Vercel Cron Pro requirement**: 5-min interval needs Pro plan. Flagged in §12.C; v1 acceptable degradation on Hobby (list-only without push).
- **iOS 16.4+ + PWA-installed requirement**: documented in §12.D; user-facing tooltip will explain.
- **Push subscription churn**: each fresh browser install + re-grant generates a new endpoint. v1 keeps all (revoked_at filtered out); v2 cleanup task may delete revoked rows older than 30 days.
- **VAPID key rotation**: if `VAPID_PRIVATE_KEY` ever rotates, all existing subscriptions silently break (browsers tie to public key). Plan: v2 admin tool to rotate + force re-subscribe.
- **Family read-only + assigned-to**: tasks can be `assigned_to_profile_id = <family_member>` but that member can't mark done. The maid/owner sees the assignment as informational ("for Spouse") and records the completion. Acceptable for v1; revisit if it confuses users.
- **No retry budget on push failures** (non-410 errors): if `web-push.sendNotification` throws (transient), we just log + skip; the occurrence stays `notified_at = null` so the next 5-min scan retries. Acceptable.
- **Cron overlap producing duplicate pushes**: very unlikely (Vercel Cron is single-fire per schedule) but theoretically possible. Mitigation in §9. Worst case = duplicate push, not a missed one.
- **Open: deep-link to occurrence?**: `notificationclick` currently opens `/tasks`. A deeper link to `/tasks?occurrence=<id>` highlighting the relevant row would be nicer; deferred to v2.
- **Open: pg_cron + Vercel Cron coupling**: two scheduling systems (local DB + cloud HTTP). Could consolidate to pg_net + a single DB-side schedule once pg_net is enabled. v2.
