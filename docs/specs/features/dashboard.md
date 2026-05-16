# Dashboard — architecture

**Status:** active
**Last reviewed:** 2026-05-16

## Routes
| Route | File | Type |
| --- | --- | --- |
| `/dashboard` | `src/app/dashboard/page.tsx` | page |
| `/dashboard` (loading skeleton) | `src/app/dashboard/loading.tsx` | loading |
| `/dashboard` (server actions) | `src/app/dashboard/actions.ts` | server-actions |

## Server actions
| Action | File | Input shape | Output shape | Called by |
| --- | --- | --- | --- | --- |
| `inviteMaidFromHome` | `src/app/dashboard/actions.ts:9` | _(none)_ | `{ code: string; token: string }` (reused or freshly created invite) | `src/components/site/owner-invite-maid-card.tsx`, `src/components/site/household-mode-card.tsx` |
| `revokeMaidInviteFromHome` | `src/app/dashboard/actions.ts:48` | `{ inviteId: string (uuid) }` (Zod) | `void` (throws on error) | `src/components/site/owner-invite-maid-card.tsx` |
| `setHouseholdFamilyRun` | `src/app/dashboard/actions.ts:54` | _(none)_ | `void` (throws on error) | `src/components/site/household-mode-card.tsx` |

## Components
| Component | File | Used by |
| --- | --- | --- |
| `DashboardPage` (default) | `src/app/dashboard/page.tsx` | Next.js route `/dashboard` |
| `DashboardLoading` (default) | `src/app/dashboard/loading.tsx` | Next.js suspense for `/dashboard` |
| `DayView` | `src/components/dashboard/day-view.tsx` | `src/app/dashboard/page.tsx` |
| `MealInlineRow` (internal) | `src/components/dashboard/day-view.tsx` | `DayView` (same file) |
| `HouseholdModeCard` | `src/components/site/household-mode-card.tsx` | `src/app/dashboard/page.tsx` |
| `OwnerInviteMaidCard` | `src/components/site/owner-invite-maid-card.tsx` | `src/app/dashboard/page.tsx` |
| `TaskSetupPromptCard` | `src/components/site/task-setup-prompt-card.tsx` | `src/app/dashboard/page.tsx` |
| `InventoryPromptCard` | `src/components/site/inventory-prompt-card.tsx` | `src/app/dashboard/page.tsx` (links to inventory feature) |
| `MainNav` | `src/components/site/main-nav.tsx` | `src/app/dashboard/page.tsx`, `src/app/dashboard/loading.tsx` (shared site chrome) |
| `DayStrip` | `src/components/site/day-strip.tsx` | `DayView` (shared with tasks feature) |
| `OccurrenceRow` | `src/components/tasks/occurrence-row.tsx` | `DayView` (owned by tasks feature — see `features/tasks.md`) |
| `OccurrenceActionSheet` | `src/components/tasks/occurrence-action-sheet.tsx` | `DayView` (owned by tasks feature — see `features/tasks.md`) |

Cards on the dashboard that link into other feature surfaces (meal rows → `/recipes`, task rows → `/tasks/*`, inventory prompt → `/inventory/new?onboarding=1`, task-setup prompt → `/onboarding/tasks`, meal-preference chip → `/household/settings`) are described in their respective feature specs (see `features/meal-plan.md`, `features/recipes.md`, `features/tasks.md`, `features/inventory.md`, `features/onboarding.md`, `features/household.md`).

## DB surface
| Object | Kind | Introduced in | Notes |
| --- | --- | --- | --- |
| `households` | table | `20260511_001_households.sql` | dashboard reads `id`, `maid_mode`, `task_setup_completed_at`, `inventory_card_dismissed_at`, `diet_preference` via `requireHousehold` context |
| `households.maid_mode` | column | `20260705_001_household_setup_gates.sql` | gates `HouseholdModeCard` (`unset`) vs `OwnerInviteMaidCard` (`invited`/`family_run`); flipped by `inviteMaidFromHome` and `setHouseholdFamilyRun` |
| `households.task_setup_completed_at` | column | `20260705_001_household_setup_gates.sql` | gates `TaskSetupPromptCard` and the entire `DayView` (meals + tasks) — null means setup not done |
| `households.inventory_card_dismissed_at` | column | `20260611_001_inventory_column_additions.sql` | gates `InventoryPromptCard` along with inventory item count <5 |
| `households.diet_preference` | column | `20260706_001_household_diet_preference.sql` | drives `dietChip` source label (`household` vs `members`) |
| `maid_mode` | enum | `20260705_001_household_setup_gates.sql` | values: `unset`, `invited`, `family_run` |
| `diet` | enum | `20260624_001_diet_preferences.sql` | values: `vegan`, `vegetarian`, `eggitarian`, `non_vegetarian`; rendered via local `DIET_LABELS` map in `page.tsx` |
| `household_memberships` | table | `20260512_001_household_memberships.sql` | dashboard counts active non-maid members with non-null `diet_preference` (chip source detection); looks up active maid membership + display name for the owner card; counts active members for meal roster size |
| `invites` | table | `20260513_001_invites.sql` | maid reads pending owner-invite token; owner reads pending maid invite (code/token); actions create / revoke maid invites |
| `inventory_items` | table | `20260607_001_inventory_items.sql` | head-count query gates `InventoryPromptCard` (threshold <5) |
| `meal_plans` | table | `20260520_001_meal_plans.sql` | per-day fetch (slot, recipe, people_eating) for the day-view meal rows; owned by meal-plan feature |
| `household_meal_times` | table | `20260609_001_household_meal_times.sql` | per-slot meal time used to anchor meal rows in the merged feed |
| `recipes` | table | `20260517_001_recipes.sql` | embedded read for name + per-serving nutrition on each meal row; owned by recipes feature |
| `tasks` | table | `20260531_001_tasks_and_occurrences.sql` | embedded read for title + assignee profile on each task occurrence; owned by tasks feature |
| `task_occurrences` | table | `20260531_001_tasks_and_occurrences.sql` | per-day occurrence fetch for `DayView`; owned by tasks feature |
| `profiles` | table | `20260510_001_profiles.sql` | embedded read for assignee `display_name` (via `tasks.assigned_to_profile_id`) and maid `display_name`/`email` (via service-role join from `household_memberships`) |
| `household_effective_diet(uuid)` | RPC | `20260706_001_household_diet_preference.sql` | returns effective `diet` for the household — overridden by `households.diet_preference` when set, otherwise strictest across active non-maid members |
| `tasks_generate_occurrences(date)` | RPC | `20260601_001_task_generation_cron.sql` (rewritten by `20260602_001_standard_tasks.sql`, gated by `20260705_001_household_setup_gates.sql`) | invoked on each dashboard render with `horizon = selectedYmd + 1` to lazily materialise occurrences; skips households without `task_setup_completed_at` |

## External integrations
- **Clerk:** `requireHousehold` (in `src/lib/auth/require.ts`) resolves the signed-in Clerk user → profile → active household; the dashboard route redirects to onboarding if no household exists.
- **Supabase:**
  - RLS-scoped server client (`createClient` from `src/lib/supabase/server.ts`) for all per-household reads (invites lookup, inventory count, meal plans, meal times, membership counts, task occurrences, `household_effective_diet` RPC, `tasks_generate_occurrences` RPC).
  - Service-role client (`createServiceClient` from `src/lib/supabase/server.ts`) for the owner-side maid lookup that joins `household_memberships` → `profiles` across the RLS boundary, and for the privileged `households.maid_mode` updates inside the two server actions.

## Open questions
- Several supporting features the dashboard links into (meal-plan, recipes, tasks, inventory, household, onboarding, scans) are still cross-referenced from this spec — the corresponding `features/*.md` docs are being authored as part of the same audit; references will firm up once those land.

## Test coverage
_To be filled in Phase 2._
