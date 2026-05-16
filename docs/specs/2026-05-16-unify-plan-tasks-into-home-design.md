# Unify /plan and /tasks into Home

> **Superseded as living documentation by [`features/dashboard.md`](features/dashboard.md).** This dated spec is retained for historical context.

Date: 2026-05-16

## Problem

Today the user has **six** top-level nav entries — Home, Plan, Recipes,
Shopping, Inventory, Tasks. Plan and Tasks both answer the same question
("what does my day look like?") just sliced differently. The just-shipped
[`TodayView`](../../src/components/dashboard/today-view.tsx) on
`/dashboard` already mashes today's meal slots + occurrences together, but
only for today, and it bounces the user out to `/plan/[date]` for editing.

Goal: make `/dashboard` the one place to triage a day — today, yesterday,
or a few days out — for both tasks and meals. Plan and Tasks disappear
from the nav. Existing deep links keep working via redirects.

## Scope

In scope:

- Reshape [`src/app/dashboard/page.tsx`](../../src/app/dashboard/page.tsx)
  to fetch tasks + meal plan + roster + meal-time locks + effective recipes
  for a `?date=YYYY-MM-DD` parameter (default: today in SG).
- New client component `src/components/dashboard/day-view.tsx` that owns
  the URL-state toggle (`?view=tasks` vs `?view=meal`), renders the date
  strip, the tab row, and delegates to the lifted leaf components.
- New shared `src/components/site/day-strip.tsx` — a 5-pill date strip
  (Yest, Today, Tom, +2, +3) that links to `/dashboard?date=…&view=…`.
- Convert `/plan`, `/plan/[date]`, `/tasks`, `/tasks/[date]` into thin
  `redirect()` handlers that funnel into `/dashboard`.
- Delete the now-unused `src/components/dashboard/today-view.tsx`,
  `src/components/plan/week-strip.tsx`, `src/components/tasks/tasks-week-strip.tsx`,
  `src/components/plan/today-list.tsx`, `src/components/tasks/_day-sections.tsx`,
  `src/app/plan/loading.tsx`, and `src/app/tasks/loading.tsx`.
- Drop `"plan"` and `"tasks"` entries from [`MainNav`](../../src/components/site/main-nav.tsx).
  Update the lone `MainNav active="plan"` in `/household/meal-times` to
  `active="home"` (its parent context is the meal plan).
- Keep `/tasks/new` and `/tasks/edit/[id]` intact (forms still needed),
  but switch their `MainNav active` from `"tasks"` to `"home"`.

Out of scope:

- Shopping, Bills, Inventory, Recipes lists and detail pages.
- Diet, ingredient-aliases, scan pipelines, or DB schema.
- Task creation / edit forms (`task-form.tsx`, `recurrence-picker.tsx`).
- The `OccurrenceActionSheet` and `SlotActionSheet` components — lifted
  as-is.
- Server actions in `/plan/actions.ts` and `/tasks/actions.ts` — still the
  only writers and still revalidate `/plan` + `/tasks` paths (harmless
  since those paths now redirect; the redirect chain re-fetches the new
  `/dashboard`).
- Adding `revalidatePath("/dashboard")` to existing action files — the
  lifted client components own optimistic state via `useTransition`, and
  the `revalidatePath("/plan…")` calls already trigger a refresh on the
  next request to any page sharing the cache tag. Touching action files
  is out of scope for this slice.
- The 14-day horizon "Later" bucket from `/tasks/page.tsx` — the new Day
  view is single-day, so there is no Later section. Multi-day triage is
  acceptably lost; users navigate via the strip + URL.

## URL state

All Day-view state lives on `/dashboard`:

| param   | values                              | default                |
|---------|-------------------------------------|------------------------|
| `view`  | `tasks` (omit) \| `meal`             | `tasks`                |
| `date`  | `YYYY-MM-DD` (SG-local)              | today                  |

Examples:

- `/dashboard` → today's tasks
- `/dashboard?view=meal` → today's meal plan
- `/dashboard?date=2026-05-17` → tomorrow's tasks
- `/dashboard?view=meal&date=2026-05-17` → tomorrow's meal plan

Invalid `date` (bad shape, NaN, or rolls over via `Date` munging) falls
back to today silently — easier than 404ing the home page over a malformed
query param.

## Redirect table

| old URL              | new URL                                          | type |
|----------------------|--------------------------------------------------|------|
| `/plan`              | `/dashboard?view=meal`                            | 307  |
| `/plan/[date]`       | `/dashboard?view=meal&date=<date>`                | 307  |
| `/tasks`             | `/dashboard?view=tasks`                           | 307  |
| `/tasks/[date]`      | `/dashboard?view=tasks&date=<date>`               | 307  |
| `/tasks/new`         | (unchanged — form page)                           | —    |
| `/tasks/edit/[id]`   | (unchanged — form page)                           | —    |

Implementation: each `page.tsx` is a server component that calls
`redirect(...)` from `next/navigation`. This keeps the redirect mapping
greppable from `git log` and types stay intact (no need to teach
`next.config.ts` about dynamic `[date]` params).

## Component tree

```
src/app/dashboard/page.tsx          (server component)
 └─ MainNav active="home"
 └─ OwnerInviteMaidCard / InventoryPromptCard / …  (unchanged)
 └─ DayView                          (NEW — client)
     ├─ Header row
     │   ├─ Date heading            (e.g. "Today" / "Tomorrow" / "Mon 18 May")
     │   ├─ "+ New task" link        (owner/maid/family_member)
     │   └─ NotificationToggle      (owner/maid)
     ├─ DayStrip                     (NEW shared client)
     ├─ Tab row                      (Tasks | Meal plan)
     └─ Active-tab body
         ├─ TasksTabBody             (lives inside day-view.tsx)
         │   ├─ Overdue section     (today only; tinted)
         │   ├─ Meal rows           (inline; tap → ?view=meal)
         │   └─ OccurrenceRow list  (existing component)
         │   └─ OccurrenceActionSheet  (existing — single instance)
         └─ MealTabBody              (lives inside day-view.tsx)
             └─ 4× SlotActionSheet wrapping SlotRow  (existing pattern from
                today-list.tsx — lifted into day-view.tsx, no separate file)
```

The `DayView` props are everything the server fetched, fully serialised
(no closures, no Supabase clients). Single top-level client component
keeps the action-sheet target state, the URL-state reads, and the
tab/date pill plumbing in one place.

## Server fetch shape

`src/app/dashboard/page.tsx` (server) does:

1. `requireHousehold()` — auth.
2. Compute `selectedYmd` from `?date=…` query param (default today SG).
3. `tasks_generate_occurrences` RPC out to `selectedYmd` (idempotent).
4. **If `selectedYmd` is today or future and the user can write meal plans:**
   `mealplan_autofill_date` RPC (idempotent, same as existing `/plan/[date]`).
5. `task_occurrences` query — when `selectedYmd === todayYmd`, pull from
   `1970-01-01` to end-of-day so overdue items surface; otherwise pull
   that single day only. Mirrors the `/tasks/[date]/page.tsx` logic.
6. `meal_plans` query for `selectedYmd` — same select + joins as
   `/plan/[date]/page.tsx` (`recipe_id, set_by_profile_id, people_eating,
   deduction_warnings, recipes(name, photo_path, household_id)`).
7. `household_meal_times` to compute `isLocked(slot)` per the existing
   1-hour-before-start rule.
8. `household_memberships` roster count → `rosterSize` for `PeoplePill`.
9. `effective_recipes` RPC → `recipes` array for `RecipePicker`.
10. Resolve each meal's `photoUrl` (public bucket for system recipes,
    signed URL for household ones) — sequential await loop, same as
    `/plan/[date]/page.tsx`.

All of the above runs every request, like the existing pages. No new
caching layer.

## Permission rules

Lifted verbatim:

| capability                  | who                                             |
|-----------------------------|--------------------------------------------------|
| See Day view                | any active household member                      |
| Tap a task → action sheet   | `owner` or `maid` (family_member sees disabled)  |
| "+ New task" button         | `owner`, `maid`, or `family_member`              |
| Notifications toggle        | `owner` or `maid`                                |
| Edit meal slot              | not (`family_member` ∧ `privilege='view_only'`)  |
| Edit People-eating pill     | same as edit meal slot                           |

All server-side gating is unchanged — RPCs already enforce these. UI just
mirrors the existing behaviour.

## DayStrip

```tsx
// src/components/site/day-strip.tsx
"use client";
export function DayStrip({
  activeYmd, view,
}: { activeYmd: string; view: "tasks" | "meal" }) {
  // 5 pills: Yest, Today, Tom, +2, +3, in SG.
  // Each pill links to /dashboard?date=<ymd>(&view=<view if not tasks>).
  // Highlight rule: bg-primary text-primary-foreground when ymd === activeYmd,
  // bg-muted when ymd === todayYmd (and not active).
}
```

Same SG `Intl.DateTimeFormat("en-CA")` helper as TasksWeekStrip. The
existing `WeekStrip` (next-4-days) and `TasksWeekStrip` (yest..+3) styles
converge on the latter — yest..+3 is more useful for triage.

## Tab row

```tsx
<nav className="flex gap-1 border-b border-border px-4">
  <TabButton active={view === "tasks"} onClick={() => setView("tasks")}>
    Tasks
  </TabButton>
  <TabButton active={view === "meal"} onClick={() => setView("meal")}>
    Meal plan
  </TabButton>
</nav>
```

`TabButton` is the same primary-border-bottom pattern as `/shopping`.
Local copy in `day-view.tsx` (15 LoC, not worth a shared file).

## MealRow lift

The colored meal-row inline marker from `today-view.tsx` becomes an
internal helper inside `day-view.tsx`. When tapped, it sets the URL to
`?view=meal&date=<same>` so the user lands on the Meal tab for that
day rather than ejecting to a different route.

## File deletion list

After the lift:

- `src/components/dashboard/today-view.tsx`
- `src/components/plan/today-list.tsx`
- `src/components/plan/week-strip.tsx`
- `src/components/tasks/tasks-week-strip.tsx`
- `src/components/tasks/_day-sections.tsx`
- `src/app/plan/loading.tsx`
- `src/app/tasks/loading.tsx`

Files kept:

- `src/components/plan/slot-row.tsx`, `slot-action-sheet.tsx`,
  `recipe-picker.tsx`, `people-pill.tsx`, `slot-warning-badge.tsx`
- `src/components/tasks/occurrence-row.tsx`, `occurrence-action-sheet.tsx`,
  `notification-toggle.tsx`, `task-form.tsx`, `recurrence-picker.tsx`
- `src/app/plan/actions.ts`, `src/app/tasks/actions.ts`
- `src/app/tasks/new/page.tsx`, `src/app/tasks/edit/[id]/page.tsx`
- `src/app/dashboard/loading.tsx` (still relevant; just renders the
  pre-Day-view skeleton — good enough as a first paint)

## Validation

- `pnpm run typecheck` clean
- `pnpm run lint -- src/app/dashboard src/app/plan src/app/tasks src/components/dashboard src/components/site` no new errors
- `pnpm run build` succeeds
- `pnpm test` → 143 still passing
- Manual: `curl -sI http://localhost:3000/plan`, `/plan/2026-05-17`,
  `/tasks`, `/tasks/2026-05-17` → 307 to the matching `/dashboard?…`
  (will further 307 to `/sign-in` because no auth; that chain is fine)
- Manual: `curl -sI http://localhost:3000/dashboard?view=meal&date=2026-05-17`
  → 307 to sign-in (compiles, no exception)

## Risks

- **Single-day fetch slowness.** `/plan/[date]` does the slot photo-URL
  lookup in a sequential loop. Dashboard now does it on every nav request
  even when the user is on the Tasks tab. Cheap (4 slots × maybe-signed
  URL) but worth watching. If it becomes a bottleneck, gate the photo
  lookup on `view === "meal"`. Not doing that now — premature.
- **`revalidatePath("/plan/...")` after meal edits.** Those paths now
  redirect to `/dashboard`. The redirect handler still re-fetches, so
  the user-visible behaviour is right; the cache invalidation tag just
  belongs to a now-empty route. Acceptable.
- **Lost "Later" bucket.** `/tasks` index used to surface a collapsed
  Later section with everything in the 14-day horizon. The new Day view
  is single-day. Users discover future tasks via the date strip + URL.
  This is a deliberate scope trade — keeping Later in single-day mode is
  visual noise; the strip + arbitrary `?date=…` covers triage.
- **Existing tests.** No UI is asserted in `tests/`. The action-tests in
  `tests/actions/` import server actions directly, so moving the UI
  layer around does not touch them. 143 tests should still pass.
