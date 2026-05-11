# Slice 5 — Tasks + Reminders + Web Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement slice 5 end-to-end: recurring household tasks with materialized occurrences, owner+maid edit + family read-only RLS, Web Push notifications via VAPID-keyed fan-out from a Vercel Cron route, and `/tasks` UI with today + upcoming list.

**Architecture:** Three new tables (`tasks`, `task_occurrences`, `push_subscriptions`). Two new SQL functions (`tasks_generate_occurrences`, `tasks_prune_old`) called by a pg_cron job nightly at 22:00 SGT to materialize next-7-days occurrences. A Vercel Cron every 5 minutes hits `/api/cron/dispatch-task-pushes`, which uses the service-role Supabase client (from slice 3) to find due+unnotified occurrences and fan out via `web-push` (Node library, VAPID-keyed) to owner+maid push subscriptions. Service worker (`src/app/sw.ts`) gets `push` + `notificationclick` event listeners on top of the existing Serwist precache setup. UI: `/tasks` (today + upcoming 7 days), `/tasks/new`, `/tasks/[id]/edit`, with a "Notifications" chip on `/tasks` for opt-in.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · Tailwind v4 · `@base-ui/react` · Supabase (`@supabase/ssr`, `@supabase/supabase-js`, service-role) · Postgres 17 + `pg_cron` · Vercel Cron (Pro plan for sub-hour intervals) · `web-push` (Node Web Push library) · Zod · Vitest · Playwright · pnpm.

**Spec reference:** [`docs/specs/2026-05-11-slice-5-tasks-reminders-push-design.md`](../specs/2026-05-11-slice-5-tasks-reminders-push-design.md) (commit `69ec157`).

**Depends on:** Slices 1, 2a, 2b, 3 — all done. Service-role Supabase helper (`src/lib/supabase/service.ts`) was added in slice 3 and is reused by the cron route here.

---

## Pre-flight (one-time user setup before Task 1)

These steps must be done before Task 1.

- [ ] **A. Generate VAPID keys**

  ```bash
  pnpm dlx web-push generate-vapid-keys
  ```

  Save the output to `.env.local`:

  ```
  NEXT_PUBLIC_VAPID_PUBLIC_KEY=B...   # the public key
  VAPID_PRIVATE_KEY=...               # the private key
  VAPID_SUBJECT=mailto:dharni05@gmail.com
  ```

  Also set the same three vars on Vercel Production + Preview when deploying.

- [ ] **B. Generate CRON_SECRET**

  ```bash
  openssl rand -hex 32
  ```

  Save as `CRON_SECRET` in `.env.local` (and on Vercel).

- [ ] **C. (Prod only) confirm Vercel plan**

  The 5-min cron interval requires Vercel **Pro**. Hobby only supports 1/day. If you're on Hobby, slice 5 ships without push (the dispatcher won't run); the task list UI still works.

- [ ] **D. Confirm env vars are set in `.env.local`**

  ```bash
  grep -E '^(NEXT_PUBLIC_VAPID_PUBLIC_KEY|VAPID_PRIVATE_KEY|VAPID_SUBJECT|CRON_SECRET)=' .env.local | sed -E 's/=.*/=<set>/'
  ```

  Expected: 4 lines printed. If any missing, finish A–B before continuing.

When A–B (and D-confirmation) are green, start Task 1.

---

## File-structure recap

```
supabase/migrations/
  20260531_001_tasks_and_occurrences.sql   (Task 2)
  20260601_001_task_generation_cron.sql    (Task 3)

src/lib/db/types.ts                         (extended in Task 4)
src/lib/push/webpush.ts                     (Task 6 — server-side web-push wrapper)

src/app/sw.ts                               (modified in Task 5)

src/app/tasks/actions.ts                    (Task 7)
src/app/push/actions.ts                     (Task 8)

src/app/api/cron/dispatch-task-pushes/route.ts   (Task 6)
vercel.json                                 (Task 6)

src/components/tasks/
  notification-toggle.tsx                   (Task 9)
  recurrence-picker.tsx                     (Task 9)
  task-form.tsx                             (Task 9)
  occurrence-row.tsx                        (Task 9)
  occurrence-action-sheet.tsx               (Task 9)

src/app/tasks/page.tsx                      (Task 10)
src/app/tasks/new/page.tsx                  (Task 10)
src/app/tasks/[id]/edit/page.tsx            (Task 10)

src/components/site/main-nav.tsx            (modified Task 11)
src/proxy.ts                                (modified Task 11)

.env.local.example                          (modified Task 1)

tests/e2e/tasks.spec.ts                     (Task 12)
docs/HANDOFF.md                             (modified Task 13)
```

> **Note on test tasks.** Vitest tests for this slice are deferred per the user's standing instruction; Task 12 (Playwright route-gating smoke) is the only test that lands.

---

## Task 1: Install `web-push` + document env vars

**Files:**

- Modify: `package.json`, `pnpm-lock.yaml`
- Modify: `.env.local.example`

- [ ] **Step 1: Install dependencies**

  ```bash
  pnpm add web-push@3.6.7
  pnpm add -D @types/web-push@3.6.4
  ```

  Expected: `web-push` added to `dependencies`, `@types/web-push` to `devDependencies`. Lockfile updated.

- [ ] **Step 2: Add new env vars to `.env.local.example`**

  Append to `.env.local.example`:

  ```
  # ── Web Push (slice 5) ───────────────────────────────────────────────
  # Generate with: pnpm dlx web-push generate-vapid-keys
  NEXT_PUBLIC_VAPID_PUBLIC_KEY=replace_me
  VAPID_PRIVATE_KEY=replace_me
  VAPID_SUBJECT=mailto:dharni05@gmail.com

  # ── Cron auth (slice 5) ─────────────────────────────────────────────
  # Vercel sends this in Authorization: Bearer <CRON_SECRET> on cron invocations.
  # Generate with: openssl rand -hex 32
  CRON_SECRET=replace_me
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean.

- [ ] **Step 4: Commit**

  ```bash
  git add package.json pnpm-lock.yaml .env.local.example
  git commit -m "$(cat <<'EOF'
  Add web-push dep + document VAPID/CRON env vars

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 2: Migration — enums + `tasks` + `task_occurrences` + `push_subscriptions` + RLS

**Files:**

- Create: `supabase/migrations/20260531_001_tasks_and_occurrences.sql`

- [ ] **Step 1: Write the migration**

  ```sql
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
  ```

- [ ] **Step 2: Apply**

  ```bash
  pnpm db:reset
  ```

  Expected: migration applies cleanly. Fix SQL on failure.

- [ ] **Step 3: Verify tables**

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "\d public.tasks" -c "\d public.task_occurrences" -c "\d public.push_subscriptions"
  ```

  Expected: 3 tables with the right columns, indexes, and RLS.

- [ ] **Step 4: Typecheck + DB tests still pass**

  ```bash
  pnpm typecheck && pnpm test tests/db
  ```

  Expected: clean + 18 DB tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/20260531_001_tasks_and_occurrences.sql
  git commit -m "$(cat <<'EOF'
  Add tasks + task_occurrences + push_subscriptions tables + RLS

  Owner+maid write tasks/occurrences; family read-only. push_subscriptions are
  per-profile (each member sees only their own). CHECK constraint enforces
  recurrence-frequency vs byweekday/bymonthday consistency.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3: Migration — generation + prune functions + pg_cron schedule

**Files:**

- Create: `supabase/migrations/20260601_001_task_generation_cron.sql`

- [ ] **Step 1: Write the migration**

  ```sql
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
  ```

- [ ] **Step 2: Apply**

  ```bash
  pnpm db:reset
  ```

  Expected: applies cleanly.

- [ ] **Step 3: Smoke-check the cron + functions exist**

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" \
    -c "\df public.tasks_generate_occurrences" \
    -c "\df public.tasks_prune_old" \
    -c "select jobname, schedule from cron.job where jobname='tasks-generate-and-prune';"
  ```

  Expected: 2 function rows + 1 cron row with schedule `0 22 * * *`.

- [ ] **Step 4: Commit**

  ```bash
  git add supabase/migrations/20260601_001_task_generation_cron.sql
  git commit -m "$(cat <<'EOF'
  Add tasks_generate_occurrences + tasks_prune_old + nightly pg_cron schedule

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4: Extend `src/lib/db/types.ts`

**Files:**

- Modify: `src/lib/db/types.ts`

- [ ] **Step 1: Add table entries to `Database["public"]["Tables"]`**

  Insert alongside slice 2a/2b/3 tables:

  ```ts
  tasks: {
    Row: {
      id: string;
      household_id: string;
      title: string;
      notes: string | null;
      assigned_to_profile_id: string | null;
      recurrence_frequency: "daily" | "weekly" | "monthly";
      recurrence_interval: number;
      recurrence_byweekday: number[] | null;
      recurrence_bymonthday: number | null;
      recurrence_starts_on: string;
      recurrence_ends_on: string | null;
      due_time: string;
      created_by_profile_id: string | null;
      archived_at: string | null;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      household_id: string;
      title: string;
      notes?: string | null;
      assigned_to_profile_id?: string | null;
      recurrence_frequency: "daily" | "weekly" | "monthly";
      recurrence_interval?: number;
      recurrence_byweekday?: number[] | null;
      recurrence_bymonthday?: number | null;
      recurrence_starts_on?: string;
      recurrence_ends_on?: string | null;
      due_time?: string;
      created_by_profile_id?: string | null;
      archived_at?: string | null;
      created_at?: string;
      updated_at?: string;
    };
    Update: Partial<Database["public"]["Tables"]["tasks"]["Insert"]>;
    Relationships: [];
  };

  task_occurrences: {
    Row: {
      id: string;
      task_id: string;
      due_at: string;
      status: "pending" | "done" | "skipped";
      completed_by_profile_id: string | null;
      completed_at: string | null;
      notified_at: string | null;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      task_id: string;
      due_at: string;
      status?: "pending" | "done" | "skipped";
      completed_by_profile_id?: string | null;
      completed_at?: string | null;
      notified_at?: string | null;
      created_at?: string;
      updated_at?: string;
    };
    Update: Partial<Database["public"]["Tables"]["task_occurrences"]["Insert"]>;
    Relationships: [];
  };

  push_subscriptions: {
    Row: {
      id: string;
      profile_id: string;
      endpoint: string;
      p256dh_key: string;
      auth_key: string;
      user_agent: string | null;
      created_at: string;
      last_used_at: string | null;
      revoked_at: string | null;
    };
    Insert: {
      id?: string;
      profile_id: string;
      endpoint: string;
      p256dh_key: string;
      auth_key: string;
      user_agent?: string | null;
      created_at?: string;
      last_used_at?: string | null;
      revoked_at?: string | null;
    };
    Update: Partial<Database["public"]["Tables"]["push_subscriptions"]["Insert"]>;
    Relationships: [];
  };
  ```

- [ ] **Step 2: Add enums**

  In `Database["public"]["Enums"]`:

  ```ts
  recurrence_frequency: "daily" | "weekly" | "monthly";
  task_occurrence_status: "pending" | "done" | "skipped";
  ```

- [ ] **Step 3: Add functions**

  In `Database["public"]["Functions"]`:

  ```ts
  tasks_generate_occurrences: {
    Args: { p_horizon_date: string };
    Returns: number;
  };
  tasks_prune_old: {
    Args: { p_days?: number };
    Returns: number;
  };
  ```

- [ ] **Step 4: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/db/types.ts
  git commit -m "$(cat <<'EOF'
  Extend Database types for tasks + occurrences + push_subscriptions

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5: Service worker push handlers

**Files:**

- Modify: `src/app/sw.ts`

- [ ] **Step 1: Read existing `sw.ts`**

  ```bash
  cat src/app/sw.ts
  ```

  Expected: existing Serwist precache setup (~20 lines).

- [ ] **Step 2: Replace with the extended version**

  Replace the entire file with:

  ```ts
  import { defaultCache } from "@serwist/next/worker";
  import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
  import { Serwist } from "serwist";

  declare global {
    interface WorkerGlobalScope extends SerwistGlobalConfig {
      __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
    }
  }

  declare const self: ServiceWorkerGlobalScope;

  const serwist = new Serwist({
    precacheEntries: self.__SW_MANIFEST,
    skipWaiting: true,
    clientsClaim: true,
    navigationPreload: true,
    runtimeCaching: defaultCache,
  });

  serwist.addEventListeners();

  // Slice 5 — Web Push event handlers.
  self.addEventListener("push", (event: PushEvent) => {
    if (!event.data) return;
    let payload: { title: string; body: string; data?: { taskId?: string; occurrenceId?: string } };
    try {
      payload = event.data.json();
    } catch {
      return;
    }
    event.waitUntil(
      self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: payload.data?.occurrenceId ?? "task",
        data: payload.data ?? {},
      }),
    );
  });

  self.addEventListener("notificationclick", (event: NotificationEvent) => {
    event.notification.close();
    event.waitUntil(
      (async () => {
        const allClients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        for (const c of allClients) {
          if (c.url.includes("/tasks")) {
            (c as WindowClient).focus();
            return;
          }
        }
        await self.clients.openWindow("/tasks");
      })(),
    );
  });
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean. Note: `/icon-192.png` is assumed by the foundations PWA manifest. If foundations doesn't have it, the notification falls back to no icon — non-fatal.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/sw.ts
  git commit -m "$(cat <<'EOF'
  Add Web Push handlers to service worker (push + notificationclick)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6: Web-push wrapper + Vercel Cron config + dispatch route

**Files:**

- Create: `src/lib/push/webpush.ts`
- Create: `src/app/api/cron/dispatch-task-pushes/route.ts`
- Create: `vercel.json`

- [ ] **Step 1: Write `src/lib/push/webpush.ts`**

  ```ts
  // Wrapper around the `web-push` library. Validates VAPID env vars up front
  // so misconfiguration produces a clear error rather than a silent failure.

  import webPush from "web-push";

  let configured = false;

  function configure(): void {
    if (configured) return;
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;
    if (!publicKey || !privateKey || !subject) {
      throw new Error(
        "VAPID env vars missing: NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT",
      );
    }
    webPush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  }

  export type WebPushSubscription = {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };

  export type WebPushResult =
    | { ok: true }
    | { ok: false; gone: boolean; status: number; message: string };

  export async function sendWebPush(
    subscription: WebPushSubscription,
    payload: { title: string; body: string; data?: Record<string, unknown> },
  ): Promise<WebPushResult> {
    configure();
    try {
      await webPush.sendNotification(subscription, JSON.stringify(payload));
      return { ok: true };
    } catch (e: unknown) {
      const status = (e as { statusCode?: number }).statusCode ?? 0;
      const message = e instanceof Error ? e.message : "send failed";
      // 410 Gone or 404 Not Found → subscription is dead, mark revoked
      const gone = status === 410 || status === 404;
      return { ok: false, gone, status, message };
    }
  }
  ```

- [ ] **Step 2: Write the cron route handler**

  Create `src/app/api/cron/dispatch-task-pushes/route.ts`:

  ```ts
  import { NextResponse } from "next/server";
  import { createServiceClient } from "@/lib/supabase/service";
  import { sendWebPush } from "@/lib/push/webpush";

  // Vercel Cron calls this every 5 minutes. Auth via Authorization: Bearer $CRON_SECRET.

  const BATCH_LIMIT = 200;

  export async function GET(request: Request) {
    const secret = process.env.CRON_SECRET;
    if (!secret) return NextResponse.json({ error: "CRON_SECRET unset" }, { status: 500 });
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const supabase = createServiceClient();

    // 1. Fetch due+unnotified pending occurrences (with task -> household join).
    const { data: occurrences, error: occErr } = await supabase
      .from("task_occurrences")
      .select("id, due_at, task_id, tasks!inner(id, title, household_id, assigned_to_profile_id, profiles!assigned_to_profile_id(display_name))")
      .eq("status", "pending")
      .is("notified_at", null)
      .lte("due_at", new Date().toISOString())
      .limit(BATCH_LIMIT);
    if (occErr) {
      return NextResponse.json({ error: occErr.message }, { status: 500 });
    }
    if (!occurrences || occurrences.length === 0) {
      return NextResponse.json({ processed: 0 });
    }

    let processed = 0;
    let errors = 0;

    for (const occ of occurrences as Array<{
      id: string;
      due_at: string;
      task_id: string;
      tasks: { id: string; title: string; household_id: string; assigned_to_profile_id: string | null; profiles: { display_name: string } | null };
    }>) {
      const task = occ.tasks;
      const householdId = task.household_id;
      const assignedName = task.profiles?.display_name ?? null;

      // 2. Find owner+maid profile IDs for this household.
      const { data: members } = await supabase
        .from("household_memberships")
        .select("profile_id")
        .eq("household_id", householdId)
        .eq("status", "active")
        .in("role", ["owner", "maid"]);
      const profileIds = (members ?? []).map((m) => m.profile_id);
      if (profileIds.length === 0) continue;

      // 3. Find active push subscriptions for those profiles.
      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh_key, auth_key")
        .in("profile_id", profileIds)
        .is("revoked_at", null);
      if (!subs || subs.length === 0) {
        // Nothing to notify; mark notified so we don't keep retrying.
        await supabase.from("task_occurrences").update({ notified_at: new Date().toISOString() }).eq("id", occ.id);
        processed++;
        continue;
      }

      const payload = {
        title: task.title,
        body: assignedName ? `Due now — for ${assignedName}` : "Due now",
        data: { taskId: task.id, occurrenceId: occ.id },
      };

      let anySent = false;
      for (const sub of subs) {
        const result = await sendWebPush(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh_key, auth: sub.auth_key } },
          payload,
        );
        if (result.ok) {
          anySent = true;
          await supabase
            .from("push_subscriptions")
            .update({ last_used_at: new Date().toISOString() })
            .eq("id", sub.id);
        } else if (result.gone) {
          await supabase
            .from("push_subscriptions")
            .update({ revoked_at: new Date().toISOString() })
            .eq("id", sub.id);
        } else {
          errors++;
        }
      }

      // Mark the occurrence notified regardless of per-sub failures: at least one
      // delivery was attempted. Even all-failed: we don't want to retry forever.
      await supabase
        .from("task_occurrences")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", occ.id);
      processed++;
      void anySent; // surfaced via processed count
    }

    return NextResponse.json({ processed, errors });
  }
  ```

- [ ] **Step 3: Write `vercel.json`**

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

- [ ] **Step 4: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean. The Supabase relation chain (`tasks!inner(...).profiles!assigned_to_profile_id(...)`) is fragile; if TS complains about the inferred shape, cast the row with `as any` at the destructure (matches slice 2a/3 pattern). The plan's code already uses an explicit `as Array<{...}>` cast on `occurrences`.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/push/webpush.ts src/app/api/cron/dispatch-task-pushes/route.ts vercel.json
  git commit -m "$(cat <<'EOF'
  Add web-push wrapper + Vercel Cron route for task notification dispatch

  Cron runs every 5 min, hits /api/cron/dispatch-task-pushes with the
  Vercel-supplied Authorization: Bearer \$CRON_SECRET. Handler queries due
  unnotified occurrences, fans out to owner+maid push subscriptions via the
  web-push library (VAPID-keyed), marks 410-Gone subscriptions revoked.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7: Task server actions

**Files:**

- Create: `src/app/tasks/actions.ts`

- [ ] **Step 1: Write the actions**

  ```ts
  "use server";

  import { revalidatePath } from "next/cache";
  import { z } from "zod";
  import { createClient } from "@/lib/supabase/server";
  import { requireHousehold } from "@/lib/auth/require";
  import type { Database } from "@/lib/db/types";

  export type TaskActionResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string> } };

  const FrequencySchema = z.enum(["daily", "weekly", "monthly"]);

  const RecurrenceSchema = z.object({
    frequency: FrequencySchema,
    interval: z.number().int().positive().max(365).default(1),
    byweekday: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    bymonthday: z.number().int().min(1).max(31).optional(),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  }).superRefine((val, ctx) => {
    if (val.frequency === "daily" && (val.byweekday || val.bymonthday !== undefined)) {
      ctx.addIssue({ code: "custom", message: "daily must not set byweekday or bymonthday" });
    }
    if (val.frequency === "weekly" && (!val.byweekday || val.byweekday.length === 0)) {
      ctx.addIssue({ code: "custom", message: "weekly requires at least one byweekday" });
    }
    if (val.frequency === "weekly" && val.bymonthday !== undefined) {
      ctx.addIssue({ code: "custom", message: "weekly must not set bymonthday" });
    }
    if (val.frequency === "monthly" && (val.bymonthday === undefined)) {
      ctx.addIssue({ code: "custom", message: "monthly requires bymonthday" });
    }
    if (val.frequency === "monthly" && val.byweekday !== undefined) {
      ctx.addIssue({ code: "custom", message: "monthly must not set byweekday" });
    }
  });

  const CreateInput = z.object({
    title: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(1000).nullable().optional(),
    assignedToProfileId: z.string().uuid().nullable().optional(),
    recurrence: RecurrenceSchema,
    dueTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).default("09:00:00"),
  });

  export async function createTask(input: z.infer<typeof CreateInput>): Promise<TaskActionResult<{ taskId: string }>> {
    const parsed = CreateInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: { code: "TASK_INVALID", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as unknown as Record<string, string> } };
    }
    const ctx = await requireHousehold();
    const supabase = await createClient();

    const r = parsed.data.recurrence;
    const { data: row, error } = await supabase
      .from("tasks")
      .insert({
        household_id: ctx.household.id,
        title: parsed.data.title,
        notes: parsed.data.notes ?? null,
        assigned_to_profile_id: parsed.data.assignedToProfileId ?? null,
        recurrence_frequency: r.frequency,
        recurrence_interval: r.interval,
        recurrence_byweekday: r.byweekday ?? null,
        recurrence_bymonthday: r.bymonthday ?? null,
        recurrence_starts_on: r.startsOn ?? new Date().toISOString().slice(0, 10),
        recurrence_ends_on: r.endsOn ?? null,
        due_time: parsed.data.dueTime.length === 5 ? `${parsed.data.dueTime}:00` : parsed.data.dueTime,
        created_by_profile_id: ctx.profile.id,
      })
      .select("id")
      .single();
    if (error || !row) {
      return { ok: false, error: { code: "TASK_FORBIDDEN", message: error?.message ?? "Insert failed" } };
    }

    // Immediately materialize next 7 days for this and other tasks.
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 7);
    await supabase.rpc("tasks_generate_occurrences", { p_horizon_date: horizon.toISOString().slice(0, 10) });

    revalidatePath("/tasks");
    return { ok: true, data: { taskId: row.id } };
  }

  const UpdateInput = CreateInput.partial().extend({ taskId: z.string().uuid() });

  export async function updateTask(input: z.infer<typeof UpdateInput>): Promise<TaskActionResult<{ taskId: string }>> {
    const parsed = UpdateInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: { code: "TASK_INVALID", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as unknown as Record<string, string> } };
    }
    await requireHousehold();
    const supabase = await createClient();

    const patch: Database["public"]["Tables"]["tasks"]["Update"] = {};
    if (parsed.data.title !== undefined) patch.title = parsed.data.title;
    if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes ?? null;
    if (parsed.data.assignedToProfileId !== undefined) patch.assigned_to_profile_id = parsed.data.assignedToProfileId ?? null;
    if (parsed.data.dueTime !== undefined) {
      patch.due_time = parsed.data.dueTime.length === 5 ? `${parsed.data.dueTime}:00` : parsed.data.dueTime;
    }
    let recurrenceChanged = false;
    if (parsed.data.recurrence !== undefined) {
      const r = parsed.data.recurrence;
      patch.recurrence_frequency = r.frequency;
      patch.recurrence_interval = r.interval;
      patch.recurrence_byweekday = r.byweekday ?? null;
      patch.recurrence_bymonthday = r.bymonthday ?? null;
      patch.recurrence_starts_on = r.startsOn ?? undefined;
      patch.recurrence_ends_on = r.endsOn ?? null;
      recurrenceChanged = true;
    }

    const { error } = await supabase.from("tasks").update(patch).eq("id", parsed.data.taskId);
    if (error) return { ok: false, error: { code: "TASK_FORBIDDEN", message: error.message } };

    // If recurrence changed, delete future pending occurrences and re-materialize.
    if (recurrenceChanged) {
      await supabase
        .from("task_occurrences")
        .delete()
        .eq("task_id", parsed.data.taskId)
        .eq("status", "pending")
        .gt("due_at", new Date().toISOString());
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 7);
      await supabase.rpc("tasks_generate_occurrences", { p_horizon_date: horizon.toISOString().slice(0, 10) });
    }

    revalidatePath("/tasks");
    revalidatePath(`/tasks/${parsed.data.taskId}/edit`);
    return { ok: true, data: { taskId: parsed.data.taskId } };
  }

  export async function archiveTask(input: { taskId: string }): Promise<TaskActionResult<{ taskId: string }>> {
    const parsed = z.object({ taskId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "TASK_INVALID", message: "Invalid input" } };
    await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase.from("tasks").update({ archived_at: new Date().toISOString() }).eq("id", parsed.data.taskId);
    if (error) return { ok: false, error: { code: "TASK_FORBIDDEN", message: error.message } };
    // Drop future pending occurrences.
    await supabase
      .from("task_occurrences")
      .delete()
      .eq("task_id", parsed.data.taskId)
      .eq("status", "pending")
      .gt("due_at", new Date().toISOString());
    revalidatePath("/tasks");
    return { ok: true, data: { taskId: parsed.data.taskId } };
  }

  export async function markOccurrenceDone(input: { occurrenceId: string }): Promise<TaskActionResult<{ occurrenceId: string }>> {
    const parsed = z.object({ occurrenceId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "TASK_INVALID", message: "Invalid input" } };
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase
      .from("task_occurrences")
      .update({ status: "done", completed_by_profile_id: ctx.profile.id, completed_at: new Date().toISOString() })
      .eq("id", parsed.data.occurrenceId)
      .eq("status", "pending");
    if (error) return { ok: false, error: { code: "TASK_FORBIDDEN", message: error.message } };
    revalidatePath("/tasks");
    return { ok: true, data: { occurrenceId: parsed.data.occurrenceId } };
  }

  export async function markOccurrenceSkipped(input: { occurrenceId: string }): Promise<TaskActionResult<{ occurrenceId: string }>> {
    const parsed = z.object({ occurrenceId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "TASK_INVALID", message: "Invalid input" } };
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase
      .from("task_occurrences")
      .update({ status: "skipped", completed_by_profile_id: ctx.profile.id, completed_at: new Date().toISOString() })
      .eq("id", parsed.data.occurrenceId)
      .eq("status", "pending");
    if (error) return { ok: false, error: { code: "TASK_FORBIDDEN", message: error.message } };
    revalidatePath("/tasks");
    return { ok: true, data: { occurrenceId: parsed.data.occurrenceId } };
  }
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean.

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/tasks/actions.ts
  git commit -m "$(cat <<'EOF'
  Add task server actions (create, update, archive, mark done/skip)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 8: Push subscription server actions

**Files:**

- Create: `src/app/push/actions.ts`

- [ ] **Step 1: Write the actions**

  ```ts
  "use server";

  import { z } from "zod";
  import { createClient } from "@/lib/supabase/server";
  import { getCurrentProfile } from "@/lib/auth/current-profile";

  export type PushActionResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string } };

  const SubscribeInput = z.object({
    endpoint: z.string().url(),
    p256dh: z.string().min(1),
    auth: z.string().min(1),
    userAgent: z.string().max(500).optional(),
  });

  export async function subscribePush(input: z.infer<typeof SubscribeInput>): Promise<PushActionResult<{ subscriptionId: string }>> {
    const parsed = SubscribeInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "PUSH_SUBSCRIPTION_INVALID", message: "Invalid input" } };
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: { code: "PUSH_SUBSCRIPTION_INVALID", message: "No profile" } };
    const supabase = await createClient();

    // If a row with this endpoint already exists (re-subscribe on same device),
    // revoke any stale rows and insert a fresh one tied to the current profile.
    await supabase
      .from("push_subscriptions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("endpoint", parsed.data.endpoint)
      .is("revoked_at", null);

    const { data, error } = await supabase
      .from("push_subscriptions")
      .insert({
        profile_id: profile.id,
        endpoint: parsed.data.endpoint,
        p256dh_key: parsed.data.p256dh,
        auth_key: parsed.data.auth,
        user_agent: parsed.data.userAgent ?? null,
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: { code: "PUSH_SUBSCRIPTION_INVALID", message: error?.message ?? "Insert failed" } };

    return { ok: true, data: { subscriptionId: data.id } };
  }

  const UnsubscribeInput = z.object({ endpoint: z.string().url() });

  export async function unsubscribePush(input: z.infer<typeof UnsubscribeInput>): Promise<PushActionResult<{ revoked: number }>> {
    const parsed = UnsubscribeInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "PUSH_SUBSCRIPTION_INVALID", message: "Invalid input" } };
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: { code: "PUSH_SUBSCRIPTION_INVALID", message: "No profile" } };
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("push_subscriptions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("profile_id", profile.id)
      .eq("endpoint", parsed.data.endpoint)
      .is("revoked_at", null)
      .select("id");
    if (error) return { ok: false, error: { code: "PUSH_SUBSCRIPTION_INVALID", message: error.message } };
    return { ok: true, data: { revoked: data?.length ?? 0 } };
  }
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean. Note: `getCurrentProfile` is the foundations helper (`src/lib/auth/current-profile.ts`).

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/push/actions.ts
  git commit -m "$(cat <<'EOF'
  Add push subscription server actions (subscribe + unsubscribe)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 9: UI components (notification toggle, recurrence picker, task form, occurrence row, action sheet)

**Files:**

- Create: `src/components/tasks/notification-toggle.tsx`
- Create: `src/components/tasks/recurrence-picker.tsx`
- Create: `src/components/tasks/occurrence-row.tsx`
- Create: `src/components/tasks/occurrence-action-sheet.tsx`
- Create: `src/components/tasks/task-form.tsx`

- [ ] **Step 1: Write `notification-toggle.tsx`**

  ```tsx
  "use client";
  import { useEffect, useState, useTransition } from "react";
  import { Button } from "@/components/ui/button";
  import { subscribePush, unsubscribePush } from "@/app/push/actions";

  function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function bufToBase64(buf: ArrayBuffer | null): string {
    if (!buf) return "";
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }

  type State = "loading" | "off" | "on" | "denied" | "unsupported";

  export function NotificationToggle() {
    const [state, setState] = useState<State>("loading");
    const [error, setError] = useState<string | null>(null);
    const [pending, start] = useTransition();

    useEffect(() => {
      if (typeof window === "undefined") return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      navigator.serviceWorker.ready.then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? "on" : "off");
      });
    }, []);

    async function enable() {
      setError(null);
      start(async () => {
        try {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") {
            setState("denied");
            return;
          }
          const reg = await navigator.serviceWorker.ready;
          const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
          if (!publicKey) {
            setError("VAPID public key not configured.");
            return;
          }
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
          const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
          const res = await subscribePush({
            endpoint: json.endpoint ?? sub.endpoint,
            p256dh: json.keys?.p256dh ?? bufToBase64(sub.getKey("p256dh")),
            auth: json.keys?.auth ?? bufToBase64(sub.getKey("auth")),
            userAgent: navigator.userAgent.slice(0, 500),
          });
          if (!res.ok) {
            setError(res.error.message);
            return;
          }
          setState("on");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to subscribe");
        }
      });
    }

    async function disable() {
      setError(null);
      start(async () => {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await unsubscribePush({ endpoint: sub.endpoint });
          await sub.unsubscribe();
        }
        setState("off");
      });
    }

    if (state === "loading") return <span className="text-xs text-muted-foreground">…</span>;
    if (state === "unsupported") return <span className="text-xs text-muted-foreground">Push not supported on this device</span>;
    if (state === "denied") return <span className="text-xs text-muted-foreground">Notifications: blocked (enable in site settings)</span>;
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Notifications: {state === "on" ? "On (this device)" : "Off"}
        </span>
        {state === "off" ? (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={enable}>Enable</Button>
        ) : (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={disable}>Disable</Button>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );
  }
  ```

- [ ] **Step 2: Write `recurrence-picker.tsx`**

  ```tsx
  "use client";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { cn } from "@/lib/utils";

  export type RecurrenceValue = {
    frequency: "daily" | "weekly" | "monthly";
    interval: number;
    byweekday: number[];
    bymonthday: number | null;
    startsOn: string;
    endsOn: string | null;
    dueTime: string;
  };

  const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

  export function RecurrencePicker({
    value, onChange,
  }: { value: RecurrenceValue; onChange: (next: RecurrenceValue) => void }) {
    function setFrequency(f: RecurrenceValue["frequency"]) {
      onChange({
        ...value,
        frequency: f,
        byweekday: f === "weekly" ? (value.byweekday.length > 0 ? value.byweekday : [1]) : [],
        bymonthday: f === "monthly" ? (value.bymonthday ?? 1) : null,
      });
    }
    function toggleDay(d: number) {
      const set = new Set(value.byweekday);
      if (set.has(d)) set.delete(d); else set.add(d);
      onChange({ ...value, byweekday: Array.from(set).sort() });
    }
    return (
      <fieldset className="space-y-3 rounded-md border border-border p-3">
        <legend className="text-sm font-medium">Recurrence</legend>

        <div className="flex gap-1">
          {(["daily", "weekly", "monthly"] as const).map((f) => (
            <Button
              key={f}
              type="button"
              variant={value.frequency === f ? "default" : "outline"}
              size="sm"
              className="flex-1 capitalize"
              onClick={() => setFrequency(f)}
            >
              {f}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm">every</span>
          <Input
            type="number"
            min={1}
            max={365}
            value={value.interval}
            onChange={(e) => onChange({ ...value, interval: Math.max(1, Number(e.target.value) || 1) })}
            className="w-20"
          />
          <span className="text-sm">
            {value.frequency === "daily" ? "day(s)" : value.frequency === "weekly" ? "week(s)" : "month(s)"}
          </span>
        </div>

        {value.frequency === "weekly" && (
          <div>
            <Label className="text-xs">On these days</Label>
            <div className="mt-1 flex gap-1">
              {DAYS.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleDay(i)}
                  className={cn(
                    "h-8 w-8 rounded-full text-xs font-medium",
                    value.byweekday.includes(i) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70",
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        )}

        {value.frequency === "monthly" && (
          <div>
            <Label htmlFor="rp-bmd" className="text-xs">Day of month</Label>
            <Input
              id="rp-bmd"
              type="number"
              min={1}
              max={31}
              value={value.bymonthday ?? 1}
              onChange={(e) => onChange({ ...value, bymonthday: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
              className="w-24"
            />
          </div>
        )}

        <div className="grid grid-cols-[1fr_1fr] gap-2">
          <div>
            <Label htmlFor="rp-starts" className="text-xs">Starts on</Label>
            <Input
              id="rp-starts"
              type="date"
              value={value.startsOn}
              onChange={(e) => onChange({ ...value, startsOn: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="rp-ends" className="text-xs">Ends on (optional)</Label>
            <Input
              id="rp-ends"
              type="date"
              value={value.endsOn ?? ""}
              onChange={(e) => onChange({ ...value, endsOn: e.target.value || null })}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="rp-time" className="text-xs">Due time of day</Label>
          <Input
            id="rp-time"
            type="time"
            value={value.dueTime.slice(0, 5)}
            onChange={(e) => onChange({ ...value, dueTime: `${e.target.value}:00` })}
          />
        </div>
      </fieldset>
    );
  }
  ```

- [ ] **Step 3: Write `occurrence-row.tsx`**

  ```tsx
  "use client";
  import { cn } from "@/lib/utils";

  export type OccurrenceRowItem = {
    occurrenceId: string;
    taskId: string;
    title: string;
    dueAt: string;
    assigneeName: string | null;
    status: "pending" | "done" | "skipped";
  };

  export function OccurrenceRow({
    item, readOnly, onTap,
  }: { item: OccurrenceRowItem; readOnly: boolean; onTap: () => void }) {
    const due = new Date(item.dueAt);
    const isOverdue = item.status === "pending" && due.getTime() < Date.now();
    return (
      <button
        type="button"
        onClick={onTap}
        disabled={readOnly}
        className={cn(
          "flex w-full items-center justify-between gap-3 border-b border-border px-4 py-3 text-left",
          !readOnly && "hover:bg-muted/50",
          item.status !== "pending" && "opacity-60",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className={cn("truncate font-medium", item.status === "done" && "line-through")}>
            {item.title}
          </div>
          <div className="text-xs text-muted-foreground">
            {due.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}
            {item.assigneeName ? ` · ${item.assigneeName}` : ""}
            {isOverdue ? " · overdue" : ""}
          </div>
        </div>
        <span className={cn(
          "rounded-full px-2 py-0.5 text-xs",
          item.status === "pending" && (isOverdue ? "bg-red-500/15 text-red-400" : "bg-blue-500/15 text-blue-400"),
          item.status === "done" && "bg-green-500/15 text-green-400",
          item.status === "skipped" && "bg-muted text-muted-foreground",
        )}>
          {item.status}
        </span>
      </button>
    );
  }
  ```

- [ ] **Step 4: Write `occurrence-action-sheet.tsx`**

  ```tsx
  "use client";
  import { useTransition } from "react";
  import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
  import { Button } from "@/components/ui/button";
  import Link from "next/link";
  import { markOccurrenceDone, markOccurrenceSkipped } from "@/app/tasks/actions";

  export type OccurrenceActionSheetProps = {
    occurrenceId: string;
    taskId: string;
    title: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  };

  export function OccurrenceActionSheet(p: OccurrenceActionSheetProps) {
    const [pending, start] = useTransition();
    const done = () => start(async () => { await markOccurrenceDone({ occurrenceId: p.occurrenceId }); p.onOpenChange(false); });
    const skip = () => start(async () => { await markOccurrenceSkipped({ occurrenceId: p.occurrenceId }); p.onOpenChange(false); });
    return (
      <Sheet open={p.open} onOpenChange={p.onOpenChange}>
        <SheetContent side="bottom">
          <SheetHeader><SheetTitle>{p.title}</SheetTitle></SheetHeader>
          <div className="flex flex-col gap-2 py-4">
            <Button type="button" onClick={done} disabled={pending}>Mark done</Button>
            <Button type="button" variant="outline" onClick={skip} disabled={pending}>Skip</Button>
            <Button type="button" variant="ghost" asChild>
              <Link href={`/tasks/${p.taskId}/edit`}>Edit task</Link>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }
  ```

- [ ] **Step 5: Write `task-form.tsx`**

  ```tsx
  "use client";
  import { useState, useTransition } from "react";
  import { useRouter } from "next/navigation";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { Textarea } from "@/components/ui/textarea";
  import { RecurrencePicker, type RecurrenceValue } from "./recurrence-picker";
  import { createTask, updateTask } from "@/app/tasks/actions";

  export type TaskFormProps = {
    mode: "create" | "edit";
    taskId?: string;
    members: { id: string; display_name: string }[];
    initial?: {
      title: string;
      notes: string | null;
      assignedToProfileId: string | null;
      recurrence: RecurrenceValue;
    };
  };

  const defaultRecurrence: RecurrenceValue = {
    frequency: "weekly",
    interval: 1,
    byweekday: [0],
    bymonthday: null,
    startsOn: new Date().toISOString().slice(0, 10),
    endsOn: null,
    dueTime: "09:00:00",
  };

  export function TaskForm({ mode, taskId, members, initial }: TaskFormProps) {
    const router = useRouter();
    const [pending, start] = useTransition();
    const [title, setTitle] = useState(initial?.title ?? "");
    const [notes, setNotes] = useState(initial?.notes ?? "");
    const [assignee, setAssignee] = useState<string>(initial?.assignedToProfileId ?? "");
    const [recurrence, setRecurrence] = useState<RecurrenceValue>(initial?.recurrence ?? defaultRecurrence);
    const [error, setError] = useState<string | null>(null);

    function submit(e: React.FormEvent) {
      e.preventDefault();
      setError(null);
      start(async () => {
        const payload = {
          title: title.trim(),
          notes: notes.trim() || null,
          assignedToProfileId: assignee || null,
          recurrence: {
            frequency: recurrence.frequency,
            interval: recurrence.interval,
            byweekday: recurrence.frequency === "weekly" ? recurrence.byweekday : undefined,
            bymonthday: recurrence.frequency === "monthly" ? (recurrence.bymonthday ?? undefined) : undefined,
            startsOn: recurrence.startsOn,
            endsOn: recurrence.endsOn,
          },
          dueTime: recurrence.dueTime,
        };
        const res = mode === "create"
          ? await createTask(payload)
          : await updateTask({ taskId: taskId!, ...payload });
        if (!res.ok) { setError(res.error.message); return; }
        router.push("/tasks");
      });
    }

    return (
      <form className="mx-auto max-w-md space-y-4 p-4" onSubmit={submit}>
        <div>
          <Label htmlFor="t-title">Title</Label>
          <Input id="t-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
        </div>
        <div>
          <Label htmlFor="t-notes">Notes (optional)</Label>
          <Textarea id="t-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </div>
        <div>
          <Label htmlFor="t-assignee">Assignee</Label>
          <select
            id="t-assignee"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="block w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">Anyone</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
          </select>
        </div>
        <RecurrencePicker value={recurrence} onChange={setRecurrence} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending || !title.trim()}>
          {mode === "create" ? "Create task" : "Save changes"}
        </Button>
      </form>
    );
  }
  ```

- [ ] **Step 6: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean. If `<Button asChild><Link/></Button>` trips the base-ui types, replace with `<Button render={<Link href={...} />}>...</Button>` (slice 2a/2b pattern).

- [ ] **Step 7: Commit**

  ```bash
  git add src/components/tasks
  git commit -m "$(cat <<'EOF'
  Add task UI components (notification toggle, recurrence picker, row, action sheet, form)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 10: Pages `/tasks`, `/tasks/new`, `/tasks/[id]/edit`

**Files:**

- Create: `src/app/tasks/page.tsx`
- Create: `src/app/tasks/new/page.tsx`
- Create: `src/app/tasks/[id]/edit/page.tsx`
- Create: `src/components/tasks/_today-list.tsx` (client wrapper)

- [ ] **Step 1: Write the client wrapper `_today-list.tsx`**

  ```tsx
  "use client";
  import { useState } from "react";
  import { OccurrenceRow, type OccurrenceRowItem } from "./occurrence-row";
  import { OccurrenceActionSheet } from "./occurrence-action-sheet";

  export function TodayList({ items, readOnly }: { items: OccurrenceRowItem[]; readOnly: boolean }) {
    const [target, setTarget] = useState<OccurrenceRowItem | null>(null);
    return (
      <>
        {items.map((it) => (
          <OccurrenceRow
            key={it.occurrenceId}
            item={it}
            readOnly={readOnly}
            onTap={() => !readOnly && setTarget(it)}
          />
        ))}
        {target && (
          <OccurrenceActionSheet
            occurrenceId={target.occurrenceId}
            taskId={target.taskId}
            title={target.title}
            open={target !== null}
            onOpenChange={(open) => { if (!open) setTarget(null); }}
          />
        )}
      </>
    );
  }
  ```

- [ ] **Step 2: Write `/tasks/page.tsx`**

  ```tsx
  import Link from "next/link";
  import { requireHousehold } from "@/lib/auth/require";
  import { createClient } from "@/lib/supabase/server";
  import { Button } from "@/components/ui/button";
  import { MainNav } from "@/components/site/main-nav";
  import { NotificationToggle } from "@/components/tasks/notification-toggle";
  import { TodayList } from "@/components/tasks/_today-list";
  import { OccurrenceRow, type OccurrenceRowItem } from "@/components/tasks/occurrence-row";

  export default async function TasksIndex() {
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const isOwnerOrMaid = ctx.membership.role === "owner" || ctx.membership.role === "maid";

    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const startTomorrow = new Date(startToday); startTomorrow.setDate(startTomorrow.getDate() + 1);
    const startNextWeek = new Date(startToday); startNextWeek.setDate(startNextWeek.getDate() + 7);

    const { data: occRows } = await supabase
      .from("task_occurrences")
      .select("id, due_at, status, tasks!inner(id, title, household_id, assigned_to_profile_id, profiles!assigned_to_profile_id(display_name))")
      .gte("due_at", startToday.toISOString())
      .lt("due_at", startNextWeek.toISOString())
      .order("due_at", { ascending: true });

    // Filter to caller's household via the joined tasks.household_id.
    const filtered = (occRows ?? []).filter((r: any) => r.tasks?.household_id === ctx.household.id);

    const toItem = (r: any): OccurrenceRowItem => ({
      occurrenceId: r.id,
      taskId: r.tasks.id,
      title: r.tasks.title,
      dueAt: r.due_at,
      assigneeName: Array.isArray(r.tasks.profiles)
        ? (r.tasks.profiles[0]?.display_name ?? null)
        : (r.tasks.profiles?.display_name ?? null),
      status: r.status,
    });

    const today = filtered.filter((r: any) => new Date(r.due_at) < startTomorrow).map(toItem);
    const upcoming = filtered.filter((r: any) => new Date(r.due_at) >= startTomorrow).map(toItem);

    return (
      <main className="mx-auto max-w-md">
        <MainNav active="tasks" />
        <header className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold">Tasks</h1>
            {isOwnerOrMaid && <Link href="/tasks/new"><Button size="sm">+ New</Button></Link>}
          </div>
          {isOwnerOrMaid && <div className="mt-2"><NotificationToggle /></div>}
        </header>

        <section>
          <h2 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Today</h2>
          {today.length === 0 ? (
            <p className="px-4 py-6 text-center text-muted-foreground">Nothing for today.</p>
          ) : (
            <TodayList items={today} readOnly={!isOwnerOrMaid} />
          )}
        </section>

        <section>
          <h2 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Upcoming (next 7 days)</h2>
          {upcoming.length === 0 ? (
            <p className="px-4 py-6 text-center text-muted-foreground">No upcoming occurrences.</p>
          ) : (
            upcoming.map((it) => (
              <OccurrenceRow key={it.occurrenceId} item={it} readOnly={!isOwnerOrMaid} onTap={() => {}} />
            ))
          )}
        </section>
      </main>
    );
  }
  ```

- [ ] **Step 3: Write `/tasks/new/page.tsx`**

  ```tsx
  import { requireHousehold } from "@/lib/auth/require";
  import { createClient } from "@/lib/supabase/server";
  import { MainNav } from "@/components/site/main-nav";
  import { TaskForm } from "@/components/tasks/task-form";

  export default async function NewTaskPage() {
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { data: members } = await supabase
      .from("household_memberships")
      .select("profile_id, profiles!inner(id, display_name)")
      .eq("household_id", ctx.household.id)
      .eq("status", "active");
    const memberList = ((members ?? []) as any[]).map((m) => ({
      id: m.profiles.id,
      display_name: m.profiles.display_name,
    }));
    return (
      <main className="mx-auto max-w-md">
        <MainNav active="tasks" />
        <header className="border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">New task</h1>
        </header>
        <TaskForm mode="create" members={memberList} />
      </main>
    );
  }
  ```

- [ ] **Step 4: Write `/tasks/[id]/edit/page.tsx`**

  ```tsx
  import { notFound } from "next/navigation";
  import { requireHousehold } from "@/lib/auth/require";
  import { createClient } from "@/lib/supabase/server";
  import { MainNav } from "@/components/site/main-nav";
  import { TaskForm } from "@/components/tasks/task-form";

  export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { data: task } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!task) notFound();
    const { data: members } = await supabase
      .from("household_memberships")
      .select("profile_id, profiles!inner(id, display_name)")
      .eq("household_id", ctx.household.id)
      .eq("status", "active");
    const memberList = ((members ?? []) as any[]).map((m) => ({
      id: m.profiles.id,
      display_name: m.profiles.display_name,
    }));
    return (
      <main className="mx-auto max-w-md">
        <MainNav active="tasks" />
        <header className="border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">Edit task</h1>
        </header>
        <TaskForm
          mode="edit"
          taskId={id}
          members={memberList}
          initial={{
            title: task.title,
            notes: task.notes,
            assignedToProfileId: task.assigned_to_profile_id,
            recurrence: {
              frequency: task.recurrence_frequency,
              interval: task.recurrence_interval,
              byweekday: task.recurrence_byweekday ?? [],
              bymonthday: task.recurrence_bymonthday,
              startsOn: task.recurrence_starts_on,
              endsOn: task.recurrence_ends_on,
              dueTime: task.due_time,
            },
          }}
        />
      </main>
    );
  }
  ```

- [ ] **Step 5: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean. Use `as any` narrowing on the joined Supabase rows if necessary (slice 2a/3 pattern).

- [ ] **Step 6: Commit**

  ```bash
  git add src/app/tasks src/components/tasks/_today-list.tsx
  git commit -m "$(cat <<'EOF'
  Add /tasks (today + upcoming), /tasks/new, /tasks/[id]/edit pages

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 11: MainNav → 5 links + proxy gate `/tasks`

**Files:**

- Modify: `src/components/site/main-nav.tsx`
- Modify: `src/proxy.ts`

- [ ] **Step 1: Update `MainNav`**

  Open `src/components/site/main-nav.tsx`. Update the `Route` type and `links`:

  ```tsx
  type Route = "plan" | "recipes" | "shopping" | "bills" | "tasks";

  const links: { route: Route; href: string; label: string }[] = [
    { route: "plan",     href: "/plan",     label: "Plan" },
    { route: "recipes",  href: "/recipes",  label: "Recipes" },
    { route: "shopping", href: "/shopping", label: "Shopping" },
    { route: "bills",    href: "/bills",    label: "Bills" },
    { route: "tasks",    href: "/tasks",    label: "Tasks" },
  ];
  ```

- [ ] **Step 2: Gate `/tasks(.*)` in `proxy.ts`**

  Open `src/proxy.ts`. Add `"/tasks(.*)"` to `isAuthGated`:

  ```ts
  const isAuthGated = createRouteMatcher([
    "/dashboard(.*)",
    "/household(.*)",
    "/onboarding(.*)",
    "/plan(.*)",
    "/recipes(.*)",
    "/shopping(.*)",
    "/bills(.*)",
    "/tasks(.*)",
  ]);
  ```

  Confirm `/api/cron/(.*)` is **NOT** in `isAuthGated` (it should fall through to the auth-anonymous branch — the cron route checks its own bearer token). If foundations' `isPublic` doesn't include `/api/cron`, add it:

  ```ts
  const isPublic = createRouteMatcher([
    "/",
    "/sign-in(.*)",
    "/sign-up(.*)",
    "/join/(.*)",
    "/api/webhooks/(.*)",
    "/api/cron/(.*)",
  ]);
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean.

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/site/main-nav.tsx src/proxy.ts
  git commit -m "$(cat <<'EOF'
  Add Tasks to MainNav (5 links); gate /tasks(.*); whitelist /api/cron(.*)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 12: Playwright smoke for `/tasks`

**Files:**

- Create: `tests/e2e/tasks.spec.ts`

- [ ] **Step 1: Write the smoke**

  ```ts
  import { test, expect } from "@playwright/test";

  test.describe("slice 5 smoke (unauthenticated)", () => {
    test("/tasks redirects unauthenticated users to /", async ({ page }) => {
      await page.goto("/tasks");
      await expect(page).toHaveURL("http://localhost:3000/");
    });
  });
  ```

- [ ] **Step 2: Run the full E2E suite**

  ```bash
  pnpm test:e2e 2>&1 | tail -10
  ```

  Expected: 16 pass (14 prior + 2 new for the chromium/mobile projects) + 2 expected skips.

- [ ] **Step 3: Commit**

  ```bash
  git add tests/e2e/tasks.spec.ts
  git commit -m "$(cat <<'EOF'
  Add Playwright smoke for /tasks route gating

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 13: HANDOFF update + final verification

**Files:**

- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Final verification**

  ```bash
  pnpm db:reset && pnpm typecheck && pnpm test tests/db && pnpm test:e2e
  ```

  Expected: 23 migrations apply (7 + 9 + 2 + 3 + 2 = 23), typecheck clean, 18 DB tests, 16 E2E + 2 skips.

- [ ] **Step 2: Manual walkthrough**

  Requires pre-flight A–B done + VAPID/CRON env vars set.

  1. Sign in as owner. Click any nav link → confirm 5-link MainNav (Plan · Recipes · Shopping · Bills · Tasks) with the active link bolded.
  2. Visit `/tasks`. Empty state for today + upcoming.
  3. Click **+ New**. Title "Water plants", recurrence Daily every 1 day, due_time 09:00. Save. Land back on `/tasks`. Today list shows the new task (if it's after 9 AM, it appears as overdue; before 9 AM, pending blue).
  4. Click the row → action sheet shows Done / Skip / Edit task. Tap **Done**. Row strikes through with green badge.
  5. Click **Notifications: Off → Enable**. Browser prompts for permission. Grant. Chip becomes "On (this device)". `psql ... -c "select count(*) from push_subscriptions where revoked_at is null;"` confirms a row.
  6. Manually trigger the dispatcher:
     ```bash
     curl -X GET -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/dispatch-task-pushes
     ```
     Expected: `{"processed": N, "errors": 0}`. If you have a pending+due+unnotified occurrence, your browser/device should receive a push notification within ~5s.
  7. Tap the notification → app focuses to `/tasks`.
  8. Edit a task: change frequency from Daily to Weekly+Mon/Wed/Fri. Save. Verify the upcoming list updates (future occurrences regenerated).
  9. Archive a task from edit page (UI doesn't have an archive button in v1 — flip to skipped/done is the v1 path; archive via direct DB or v2 UI).
  10. Sign in as a family member. Visit `/tasks`. Confirm: no **+ New** button, no notifications chip, no Edit affordance, no done/skip action on rows.

- [ ] **Step 3: Update `docs/HANDOFF.md`**

  Append a new section under "Status" after slice 3's section:

  ```markdown
  ### Done — Slice 5 (Tasks + reminders + Web Push)

  Spec: [`docs/specs/2026-05-11-slice-5-tasks-reminders-push-design.md`](specs/2026-05-11-slice-5-tasks-reminders-push-design.md). Plan: [`docs/plans/2026-05-11-slice-5-tasks-reminders-push.md`](plans/2026-05-11-slice-5-tasks-reminders-push.md). 13 tasks executed via `superpowers:subagent-driven-development`.

  - **Pre-flight done by user:** VAPID keys generated, `CRON_SECRET` generated, env vars set. **Vercel Pro required** for the 5-min cron in prod.
  - **Migrations (2):** `20260531_001_tasks_and_occurrences.sql` (3 tables + 2 enums + RLS + CHECK), `20260601_001_task_generation_cron.sql` (`tasks_generate_occurrences` + `tasks_prune_old` + nightly pg_cron at 22:00 SGT).
  - **Libs:** `src/lib/push/webpush.ts` (web-push VAPID wrapper).
  - **Service worker:** `src/app/sw.ts` extended with `push` + `notificationclick` handlers on top of Serwist precache.
  - **Server actions:** `src/app/tasks/actions.ts` (createTask, updateTask with recurrence-change regen, archiveTask, markOccurrenceDone, markOccurrenceSkipped); `src/app/push/actions.ts` (subscribePush, unsubscribePush).
  - **Cron route:** `src/app/api/cron/dispatch-task-pushes/route.ts` — Vercel-Cron-invoked GET with `Authorization: Bearer $CRON_SECRET` auth; fans out to owner+maid push subscriptions via web-push; marks 410-Gone subscriptions revoked.
  - **UI:** `/tasks` (today + upcoming-7d), `/tasks/new`, `/tasks/[id]/edit`. Components: notification-toggle, recurrence-picker, occurrence-row, action sheet, task-form. MainNav now 5 links: Plan · Recipes · Shopping · Bills · Tasks.
  - **Proxy:** `/tasks(.*)` gated; `/api/cron/(.*)` added to public matcher.
  - **Family is read-only.** Notification toggle, new-task button, occurrence action sheet all hidden for `family_member` role.
  - **Notification scope:** owner + maid only (matches who can mark done).

  Verified locally on 2026-MM-DD: typecheck + 18 DB tests + 16 Playwright + 2 expected skips.
  ```

  Add deferred block:

  ```markdown
  ### Deferred from slice 5

  - **All vitest tests** (DB + actions + cron route).
  - **Snooze** (deferred per design decision).
  - **Calendar / week view.**
  - **Per-task lead-time reminder.**
  - **Notification action buttons** (Mark done inline in OS notification).
  - **History view** (show last 30 days of completions).
  - **Archive UI** (currently archive is reachable only via direct DB or future edit-page action).
  - **iOS PWA install hint** tooltip for the notifications chip (Spec §12.D).
  - **VAPID key rotation tool** (v2 admin).
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add docs/HANDOFF.md
  git commit -m "$(cat <<'EOF'
  Update HANDOFF for slice 5 completion

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **Step 5: Push (when ready)**

  ```bash
  git push origin main
  ```

---

## Final verification gate

- [ ] `pnpm db:reset && pnpm typecheck && pnpm test tests/db && pnpm test:e2e` all green.
- [ ] `pnpm build` completes cleanly.
- [ ] Manual walkthrough (Task 13 Step 2) with VAPID/CRON env vars set, including the curl-triggered push that lands a real notification on your device.
- [ ] Push complete.

When all four are checked, slice 5 is ready.
