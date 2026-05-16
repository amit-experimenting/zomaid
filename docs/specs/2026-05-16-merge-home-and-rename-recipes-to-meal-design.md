# Zomaid — Merge Home tabs + rename Recipes to "Meal" — Design

> **Superseded as the living architecture doc for the dashboard area by [`features/dashboard.md`](features/dashboard.md).** This dated spec is retained for historical context.

> **Superseded as the living architecture doc for the recipes area by [`features/recipes.md`](features/recipes.md).** This dated spec is retained for historical context.

- **Date**: 2026-05-16
- **Status**: Approved — implementing in same session
- **Scope**: Collapse the Tasks/Meal-plan tab toggle on `/dashboard` into a single chronological feed that merges today's tasks with today's meal-plan rows, then move the per-day meal-plan view (the old Meal tab) to `/recipes` (renamed to "Meal" in the main nav). The grid-of-recipe-cards library that previously lived at `/recipes` moves to `/recipes?view=library`. Recipe create/detail/edit pages, shopping, inventory, household settings, and all DB schema are untouched.

## 1. Context

Today the home Day view ([`src/components/dashboard/day-view.tsx`](../../src/components/dashboard/day-view.tsx)) renders a Tasks/Meal segmented control. Tasks tab shows tasks for the day plus a row per meal slot inline (the user can tap a meal row to jump to the meal tab on the same day). Meal tab shows the 4 slot rows with `<SlotActionSheet>` editors.

Two issues:
- The Meal tab on Home is functionally a duplicate of `/plan/[date]`, which already redirects here.
- "Recipes" (the library grid) is the secondary user task; "what's on the menu today" is the primary one. The nav label should communicate the primary task.

This change:
- Drops the tab toggle. Home is a single chronological feed of overdue + today's tasks + today's meals merged by clock-time.
- Renames the "Recipes" nav entry to "Meal" (URL stays `/recipes`).
- Makes `/recipes` (no params) the per-day meal-plan landing page (the 4 slot rows, with a `<DayStrip>` on top).
- Moves the recipe library grid to `/recipes?view=library` with a "Recipes" toggle button above the grid. Inside the library view, the button reads "Planned meals" and returns to `/recipes`.

## 2. Decisions log

| Q | Decision |
|---|---|
| Where do meals render on Home? | Inline in the tasks feed, sorted by their configured slot time (from `household_meal_times`), styled with the existing primary-tint background + "Meal" pill so they pop. |
| What happens when tapping a meal row on Home? | Navigate to `/recipes` (the Meal landing page). We don't try to scroll-target the slot — `/recipes` always opens with the slot rows visible. |
| Meals with no recipe assigned on Home | Skipped. Inline empty rows ("Not planned") would pollute the feed. They still appear on `/recipes`. |
| Time merge — what if a slot has no time configured? | Skip that meal from the inline feed. (DB has a `household_meal_times` row per slot per household after onboarding, but be defensive.) |
| `?view=library` empty state | Same copy + "+ Add" button as today's `/recipes` index. |
| Library page toggle button label | When on default (planned meals): "Recipes". When on library: "Planned meals". Mirrors the spec wording. |
| DayStrip on `/recipes` | Extend the existing `<DayStrip>` with an optional `baseHref` prop. Default stays `/dashboard`. The `view` prop is removed (only the dashboard used it, and the dashboard no longer has a view to preserve). |
| Date strip behaviour on Home | Same 5-day window (yest..+3), no view param. |
| `/plan` and `/plan/[date]` redirects | Now redirect to `/recipes?date=…` (the meal-plan view moved). |
| `/tasks` and `/tasks/[date]` redirects | Drop the `view=tasks` param — the dashboard no longer has views. |
| `effective_recipes` fetch on `/dashboard` | Removed. Slot editing has moved off Home. |
| `MealInlineRow` | Stays in `day-view.tsx`. Only one consumer; not worth extracting. |
| Reordering when a task and a meal share the same minute | Meals sort before tasks at equal times (slots are user-facing anchors; tasks attached to them by time are subordinate). Tie-break on title. |

## 3. URL → URL redirect table

| From | To |
|---|---|
| `/plan` | `/recipes` |
| `/plan/<date>` | `/recipes?date=<date>` |
| `/tasks` | `/dashboard` |
| `/tasks/<date>` | `/dashboard?date=<date>` |

The `/plan(.*)` and `/tasks(.*)` matchers in `src/proxy.ts` stay — they still need auth-gating before the redirect runs.

## 4. File-by-file plan

### Edit

- `src/components/site/main-nav.tsx` — rename label "Recipes" → "Meal". `Route` type and the `href` stay.
- `src/components/site/day-strip.tsx` — replace the `view: "tasks" | "meal"` prop with an optional `baseHref?: string` prop (default `"/dashboard"`). Build hrefs as `${baseHref}${qs ? "?" + qs : ""}` with only `date` in the qs.
- `src/components/dashboard/day-view.tsx` — drop the tab toggle, the `MealTab` component, and the `MealTab` props (`recipes`, `recipeLibraryEmpty`, `mealPlanReadOnly`). Render overdue + a merged-by-time feed of tasks + meals. Meals route to `/recipes` on tap. Keep the `+ New task` button gated solely by `canAddTasks`.
- `src/app/dashboard/page.tsx` — drop the `effective_recipes` RPC call, the `Recipe` import, the autofill RPC call (slot edits don't happen here anymore — autofill will run when the user visits `/recipes`). Drop `recipes`, `recipeLibraryEmpty`, `mealPlanReadOnly`, and `rosterSize` props on `<DayView>`. Keep meal_plans + meal_times fetches (we still need them to render inline meal rows and compute slot times).
- `src/app/recipes/page.tsx` — branch on `searchParams.view`. Default branch fetches what the old Meal tab needed (meal_plans, meal_times, roster size, effective_recipes for the picker, lock state) and renders `<DayStrip baseHref="/recipes" />` + 4 `<SlotActionSheet>`s. `view=library` branch renders the existing search/filter/grid UI. Both branches share the `<MainNav active="recipes" />` and the toggle button. Top-right button on default = "Recipes" → `/recipes?view=library`; on library = "Planned meals" → `/recipes`. The library view keeps its "+ Add" link.
- `src/app/plan/page.tsx` — redirect to `/recipes`.
- `src/app/plan/[date]/page.tsx` — redirect to `/recipes?date=<date>`.
- `src/app/tasks/page.tsx` — redirect to `/dashboard`.
- `src/app/tasks/[date]/page.tsx` — redirect to `/dashboard?date=<date>`.

### Component tree before/after

**Before** (`/dashboard`):

```
DashboardPage
  MainNav active=home
  …owner/inventory cards…
  DayView
    DayStrip view=tasks|meal
    [TabButton]
    + New task (tasks tab + canAddTasks)
    TasksTab | MealTab
```

**After** (`/dashboard`):

```
DashboardPage
  MainNav active=home
  …owner/inventory cards…
  DayView
    DayStrip baseHref="/dashboard"
    + New task (canAddTasks only)
    Overdue section
    Merged feed: meals (link to /recipes) + tasks, sorted by time
```

**Before** (`/recipes`):

```
RecipesIndex
  MainNav active=recipes
  Header: "Recipes" + "+ Add"
  Search/filter form
  Grid of RecipeCard
```

**After** (`/recipes`, default = planned meals view):

```
RecipesIndex (planned)
  MainNav active=recipes
  DayStrip baseHref="/recipes"
  Header: "Planned meals" + "Recipes" button → /recipes?view=library
  4× SlotActionSheet
```

**After** (`/recipes?view=library`):

```
RecipesIndex (library)
  MainNav active=recipes
  Header: "Recipes" + "Planned meals" button → /recipes
  + Add button
  Search/filter form
  Grid of RecipeCard
```

### No deletions

No files are deleted in this change. `MealInlineRow` collapses into the single feed but remains a local helper inside `day-view.tsx`. `MealTab` (the multi-slot edit UI) moves into `/recipes/page.tsx` rather than being extracted to a shared component — it has exactly one consumer.

## 5. Time-merge logic on Home

1. The dashboard server fetch already loads `household_meal_times`. We keep that, plus the `meal_plans` rows.
2. For each meal row with a `recipe_id`, build a pseudo-feed-item with its slot time projected onto the selected date:

   ```
   `${selectedYmd}T${meal_time}+08:00`
   ```

3. Construct a sort key per feed item — tasks use `due_at`, meals use the projected slot time. Tie-break: meals before tasks at equal time; then by title.
4. Render: tasks via `OccurrenceRow`; meals via `MealInlineRow` (kept inside `day-view.tsx`). Meal rows are anchor links to `/recipes` rather than buttons that route via `useRouter`.
5. Meals with no recipe assigned are skipped entirely.

## 6. Permission flags on `/recipes` (default)

Mirror the old Meal tab logic exactly:
- `mealPlanReadOnly = role === "family_member" && privilege === "view_only"`
- `mealplan_autofill_date` RPC runs only when `!mealPlanReadOnly && selectedYmd >= todayYmd`.
- `peopleEating` / `rosterSize` / `locked` / `deductionWarnings` all carry over to the slot rows.

## 7. Verification

- `pnpm run typecheck` clean.
- `pnpm run lint -- src/app/dashboard src/components/dashboard src/app/recipes src/components/recipes src/components/site src/app/plan src/app/tasks` no new errors.
- `pnpm run build` succeeds.
- `pnpm test` → 143 tests, all green.
- `curl -I /dashboard /recipes /recipes?view=library /plan /plan/2026-05-16 /tasks /tasks/2026-05-16` all 307.

## 8. Risks / non-goals

- **Old `?view=meal` bookmarks on `/dashboard`**: the param is silently ignored; the user just sees Home. Not worth a 307 hop. The legitimate "meal plan landing" entry points (`/plan`, `/plan/[date]`) redirect cleanly.
- **Push-notification deep links** for tasks/meals still work — `/tasks/<date>` and `/plan/<date>` both still resolve to the right surface.
- **No DB or RLS changes.** No migrations.
