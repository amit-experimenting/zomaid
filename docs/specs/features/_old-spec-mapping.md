# Old spec → feature spec mapping

This table maps each dated `docs/specs/*-design.md` to the new `docs/specs/features/<feature>.md`
spec(s) it should banner-link to. Generated for Tasks 1-11 of the codebase audit plan.

| Old spec | Feature spec(s) | Notes |
| --- | --- | --- |
| docs/specs/2026-05-10-foundations-design.md | infrastructure.md, onboarding.md, household.md | foundations slice covers Clerk auth, Supabase clients, proxy/middleware, multi-tenant authorization, household model, roles, invites, onboarding shell |
| docs/specs/2026-05-11-owner-invite-maid-on-home-design.md | dashboard.md, household.md | adds an owner-side invite-maid card on `/dashboard` reusing existing invite flow in household settings |
| docs/specs/2026-05-11-slice-2a-recipes-meal-plan-design.md | recipes.md, meal-plan.md | original slice 2a: recipes catalog + daily meal plan + suggestion engine — split between the two feature specs |
| docs/specs/2026-05-11-slice-2b-shopping-list-design.md | shopping.md | original slice 2b: standing per-household shopping list with auto-pull from plans + bought history |
| docs/specs/2026-05-11-slice-3-bill-scanning-ocr-design.md | bills.md, scans.md | original GitHub-Issues OCR pipeline for bill scanning — superseded by Sonnet 4.6 direct-vision flow but documents bill rows / line items model |
| docs/specs/2026-05-11-slice-5-tasks-reminders-push-design.md | tasks.md, infrastructure.md | tasks + recurrences + occurrences + nightly cron + Web Push fan-out (push infra is shared) |
| docs/specs/2026-05-14-auto-allocation-design.md | meal-plan.md | on-view auto-fill + inventory-aware scoring for the meal-plan; upgrades nightly autofill cron |
| docs/specs/2026-05-14-inventory-design.md | inventory.md, meal-plan.md, bills.md | inventory tables, cook-deduct, bill ingest, meal-time locks, unit conversions; touches plan locking + bill→inventory ingest |
| docs/specs/2026-05-14-inventory-onboarding-units-and-custom-rows-design.md | inventory.md, onboarding.md | per-item default units + custom rows on `/inventory/new?onboarding=1` |
| docs/specs/2026-05-14-recipe-data-fill-design.md | recipes.md | starter-pack data fill, YouTube column, `default_servings` — all recipe-catalog work |
| docs/specs/2026-05-14-recipe-edit-video-url-design.md | recipes.md | video URL field on recipe edit form + starter-pack URL audit |
| docs/specs/2026-05-14-shopping-typeahead-design.md | shopping.md | typeahead on QuickAdd, server-side dedupe, auto-refresh on toggle |
| docs/specs/2026-05-16-bill-scan-into-inventory-design.md | bills.md, scans.md, inventory.md | Upload-Bill tab on `/inventory/new` — synchronous Sonnet 4.6 vision flow that writes bills + line items + inventory rows |
| docs/specs/2026-05-16-bill-scan-retry-queue-design.md | scans.md, bills.md, infrastructure.md | retry queue + Vercel cron + `/scans/pending` review + `/admin/bill-scans` admin surface |
| docs/specs/2026-05-16-bills-cleanup-and-shopping-tab-design.md | bills.md, shopping.md, infrastructure.md | retires GitHub OCR pipeline, removes `/bills` index + `/bills/new`, surfaces bills list as a tab on `/shopping` |
| docs/specs/2026-05-16-codebase-audit-and-spec-refresh-design.md | infrastructure.md | meta-spec describing the audit + per-feature refresh program itself; banner to infrastructure as a catch-all home for cross-cutting docs |
| docs/specs/2026-05-16-diet-preferences-design.md | household.md, recipes.md, meal-plan.md | per-member diet preference + recipe diet classification + strictest-non-maid aggregation; effective_recipes filter cascades into meal-plan slot-pick / auto-fill / suggestion engine |
| docs/specs/2026-05-16-household-meal-preference-design.md | household.md, dashboard.md, meal-plan.md | household-level meal preference overrides per-member; dashboard chip shows effective preference; planner filters by it |
| docs/specs/2026-05-16-household-settings-email-invites-design.md | household.md | members-list ordering + optional email-whitelist invites on `/household/settings` |
| docs/specs/2026-05-16-inventory-scan-receipt-design.md | scans.md, inventory.md | original Scan Receipt tab on `/inventory/new` (Claude Vision pre-fill, no bill row); merged into unified scans flow later |
| docs/specs/2026-05-16-loaders-and-transitions-design.md | infrastructure.md, dashboard.md, meal-plan.md, recipes.md, shopping.md, inventory.md, bills.md, tasks.md, household.md | per-route `loading.tsx` skeletons + `PendingButton` wrapper — cross-cutting — multiple per-feature surfaces (`/dashboard`, `/plan`, `/recipes`, `/shopping`, `/inventory`, `/bills`, `/tasks`, `/household/settings`) |
| docs/specs/2026-05-16-merge-home-and-rename-recipes-to-meal-design.md | dashboard.md, meal-plan.md, recipes.md | merges Tasks/Meal toggle on `/dashboard` into one feed; moves day meal-plan view to `/recipes`; library to `/recipes?view=library` |
| docs/specs/2026-05-16-shopping-ingredient-aliases-design.md | shopping.md | `ingredient_aliases` table + processed→shoppable mapping in `shopping_auto_add_from_plans` |
| docs/specs/2026-05-16-task-setup-and-household-mode-design.md | onboarding.md, tasks.md, household.md, dashboard.md | task-setup wizard, household mode (maid vs family-run), Home setup gates, picked-task ownership |
| docs/specs/2026-05-16-tasks-day-grouping-design.md | tasks.md | day-grouped layout on `/tasks` with Overdue/Today/+1..+4/Later sections |
| docs/specs/2026-05-16-unify-plan-tasks-into-home-design.md | dashboard.md, meal-plan.md, tasks.md | collapses `/plan` and `/tasks` into `/dashboard` day-view; old routes become redirects |
