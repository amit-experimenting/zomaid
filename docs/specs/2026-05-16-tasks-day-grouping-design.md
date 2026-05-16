# Tasks page: day grouping with overdue + later

Date: 2026-05-16

## Problem

[`/tasks`](../../src/app/tasks/page.tsx) currently renders task occurrences
in two flat buckets — "Today" and "Upcoming (next 7 days)". This loses the
day-by-day rhythm that the meal plan already has, hides overdue items as a
tag on individual rows, and dumps everything beyond today into one big list.

Goal: mirror the date-grouped layout of [`/plan`](../../src/app/plan/[date]/page.tsx) —
Today prominent, next four days as their own date rows, with everything
beyond folded into a collapsible "Later". Overdue items get pinned to the
top of Today with a distinct visual cue so they cannot be missed.

## Scope

In scope:

- Reshape [`src/app/tasks/page.tsx`](../../src/app/tasks/page.tsx) to:
  - Query 14 days ahead (was 7) so Later has content when there is any.
  - Group occurrences by local calendar date in the household timezone
    (SG, matching the rest of the app).
  - Render sections in this order: Overdue, Today, Tomorrow, Day+2, Day+3,
    Day+4, Later.
- New client component `src/components/tasks/_day-sections.tsx` that wraps
  the existing `OccurrenceActionSheet` state so all sections share a single
  sheet instance and one `onTap` handler.
- Reuse the existing [`OccurrenceRow`](../../src/components/tasks/occurrence-row.tsx)
  unchanged. The overdue / pending / done / skipped pill colors stay as-is.
- Apply [`PendingButton`](../../src/components/ui/pending-button.tsx) to the
  three action buttons in [`OccurrenceActionSheet`](../../src/components/tasks/occurrence-action-sheet.tsx)
  (Mark done / Skip / Hide). They submit via `useTransition`.

Out of scope (do not touch):

- Task creation / edit forms (`/tasks/new`, `/tasks/[id]/edit`).
- Recurrence generation logic (`tasks_generate_occurrences` RPC).
- Notification / push delivery.
- DB schema changes — same `task_occurrences` rows, just rendered.
- Per-occurrence row visual redesign (status pill, opacity-when-done).
- Filtering by assignee or category.
- Bulk-edit UI.
- The existing `loading.tsx` skeleton — left in place; mismatch on first
  paint is acceptable.

## Design decisions

- **Overdue placement.** Overdue occurrences (`status = 'pending'` AND
  `due_at < now()`) are pinned at the very top under an "Overdue" sub-header
  styled with a destructive accent (red border-left + bg tint). They are
  *not* a separate date row and do *not* duplicate inside Today even if
  their `due_at` is earlier today — overdue wins exclusively.
- **Date grouping.** Use `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" })`
  to format each `due_at` to a `YYYY-MM-DD` local-date key. `en-CA` always
  emits ISO format. This matches the SG-centric assumption already baked
  into [`/plan/[date]`](../../src/app/plan/[date]/page.tsx) (uses `+08:00`
  literals) and [`WeekStrip`](../../src/components/plan/week-strip.tsx).
  Per-user `profiles.timezone` is not consulted yet — out of scope (no
  other page consults it either; introducing it here only would create
  inconsistency).
- **Five named date sections.** Today, Tomorrow, Day+2, Day+3, Day+4.
  Headings render even when empty, showing a faint "Nothing scheduled"
  placeholder. This preserves the day rhythm visually.
- **Later section.** A `<details>` element wrapping everything from Day+5
  through Day+13. Closed by default. The summary shows a count. Skipped
  entirely when empty (no empty `<details>` rendered).
- **Sort within a day.** `due_at` ascending, then `tasks.title`
  ascending — done in JS after the SQL fetch (SQL already sorts by
  `due_at`; title is a JS-side tiebreaker).
- **Completed / skipped occurrences.** Still rendered inside their day
  bucket, dimmed via the existing `opacity-60` styling on `OccurrenceRow`.
  Not pulled into Overdue.

## Query

```ts
const horizonDays = 14;
const startLocalDay = todayInSg(); // 00:00 SG of today
const endLocalDay   = addDays(startLocalDay, horizonDays); // exclusive

await supabase.rpc("tasks_generate_occurrences", {
  p_horizon_date: ymd(addDays(startLocalDay, horizonDays)),
});

const { data: occRows } = await supabase
  .from("task_occurrences")
  .select(
    "id, due_at, status, household_id, " +
    "tasks!inner(id, title, household_id, assigned_to_profile_id, " +
    "profiles!assigned_to_profile_id(display_name))"
  )
  .eq("household_id", ctx.household.id)
  .lt("due_at", endLocalDay.toISOString())     // open right edge: D+14 00:00 SG
  .order("due_at", { ascending: true });
```

No lower `due_at` bound: occurrences with `due_at < now()` that are still
pending bubble up as Overdue. (Completed / skipped past occurrences are
filtered client-side to only render those whose local date is today or
later, so the page does not become an audit log.)

## Bucketing (server component)

```ts
const todayYmd = sgYmd(new Date());
const upcomingYmds = [0, 1, 2, 3, 4].map(i => sgYmd(addDays(now, i)));

const overdue: Item[] = [];
const byDay: Record<string, Item[]> = {};
const later: Item[] = [];

for (const r of occRows) {
  const item = toItem(r);
  const isPending = item.status === "pending";
  const isPast = new Date(item.dueAt).getTime() < Date.now();

  if (isPending && isPast) { overdue.push(item); continue; }

  const ymd = sgYmd(new Date(item.dueAt));
  if (ymd < todayYmd) continue;                 // completed in the past — drop
  if (upcomingYmds.includes(ymd)) {
    (byDay[ymd] ??= []).push(item);
  } else {
    later.push(item);
  }
}
```

Then sort each bucket by `(dueAt, title)`.

## Rendering

A new client component `_day-sections.tsx` owns the `OccurrenceActionSheet`
target state and renders all sections. Server `page.tsx` precomputes the
buckets and labels.

```
<MainNav active="tasks" />
<header>Tasks · + New · NotificationToggle</header>

<DaySections
  readOnly={...}
  overdue={overdue}
  days={[
    { ymd, label: "Today", items: byDay[ymd] ?? [] },
    { ymd, label: "Tomorrow", items: ... },
    { ymd, label: "Wed 20 May", items: ... },
    { ymd, label: "Thu 21 May", items: ... },
    { ymd, label: "Fri 22 May", items: ... },
  ]}
  later={later}
/>
```

`DaySections` shape:

```tsx
type Section = { ymd: string; label: string; items: OccurrenceRowItem[] };

export function DaySections({
  overdue, days, later, readOnly,
}: {
  overdue: OccurrenceRowItem[];
  days: Section[];
  later: OccurrenceRowItem[];
  readOnly: boolean;
}) {
  const [target, setTarget] = useState<OccurrenceRowItem | null>(null);
  // ... renders overdue block + day sections + <details> for later
  // ... all rows tap into the same setTarget
  // ... single <OccurrenceActionSheet target={target} .../> at the bottom
}
```

Overdue header style: small uppercase label, `text-destructive`, container
with `border-l-4 border-destructive bg-destructive/5` to make it stand
out without screaming.

Day header style (re-using the muted-uppercase pattern already in use):

```tsx
<h2 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
  {label}
  <span className="ml-2 text-xs font-normal normal-case text-muted-foreground/70">
    {ymdShortLabel}
  </span>
</h2>
```

Empty-day placeholder: `<p className="px-4 py-3 text-sm text-muted-foreground/60">Nothing scheduled.</p>`.

Later `<details>`:

```tsx
<details className="border-t border-border">
  <summary className="cursor-pointer px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
    Later ({later.length})
  </summary>
  {/* same OccurrenceRow stream, grouped or flat — flat is fine here */}
</details>
```

## PendingButton swap

In [`occurrence-action-sheet.tsx`](../../src/components/tasks/occurrence-action-sheet.tsx),
swap the three action `<Button …>`s (Mark done, Skip, Hide) for
`<PendingButton pending={pending}>` so the spinner shows while the
`useTransition` is in flight. The "Cancel" and "Not applicable…" buttons
that toggle local state remain plain `<Button>`. The Edit-task link button
also stays plain.

## Validation

- `npm run typecheck` clean.
- `npm run lint -- src/app/tasks src/components/tasks` no new errors.
- `npm run build` succeeds.
- `npm run dev` then `curl -sI http://localhost:3000/tasks` returns 307
  (auth redirect; confirms compile).

## Risks / open questions

- **DST / timezone correctness.** SG has no DST, so the hard-coded `+08:00`
  is safe for the user. If we ever ship to other regions, both `/plan` and
  this page need to consult `profiles.timezone` together — tracked as a
  follow-up, not a blocker here.
- **Empty page on a fresh household.** `tasks_generate_occurrences` runs
  on every request (same as today). If a household has no tasks at all,
  every day section shows "Nothing scheduled". Acceptable — it tells the
  user the system is working and prompts them to add tasks.
- **Standard tasks count toward overdue.** A hidden-by-this-household
  standard task should never show, because `hideStandardTask` deletes the
  pending occurrences. No extra filter needed.
- **`Date.now()` purity in RSC.** Bucketing reads `Date.now()` once at the
  top of the page to compute `now` / `todayYmd`. This is the same pattern
  `/plan/[date]/page.tsx` uses (`nowMs = Date.now()`); ESLint already
  warns on this in `occurrence-row.tsx` and we leave it alone per AGENTS
  note about pre-existing lint warnings.
