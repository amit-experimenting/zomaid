# Test backfill — punch list

Aggregated from the 2026-05-16 codebase audit. Phase 2 produced per-feature test
coverage tables in `docs/specs/features/<feature>.md`; this file is the priority-1
extract for "what to test next."

> **Phase 5 update (2026-05-16):** Tasks + Onboarding features now have full test coverage on the items listed below. See the "Covered in Phase 5" section at the bottom for the moved rows.

## How to read

- **High** — data-loss path, mutation with no coverage at any tier, or load-bearing
  silent-failure surface (e.g. trigger that runs implicitly).
- Items are grouped by feature. Within a feature, list mutations first, then RPCs,
  then triggers/silent-failure paths.

## Tier recommendations

- Server actions → `tests/actions/` (vitest)
- RPCs and DB helpers / triggers → `tests/db/` (vitest with pg client)
- Pure functions → `tests/unit/` (vitest)
- User flows / pages → `tests/e2e/` (playwright)

---

## Tasks

_Fully covered in Phase 5 — see "Covered in Phase 5" at the bottom._

## Inventory

Mutations:

- `createInventoryItem` — `src/app/inventory/actions.ts:23` → `tests/actions/`
- `createInventoryItemsBulk` — `src/app/inventory/actions.ts:124` → `tests/actions/`

## Bills

Mutations:

- `ingestBillLineItem` — `src/app/bills/actions.ts:72` → `tests/actions/`
- `uploadBillFromScan` — `src/app/bills/actions.ts:161` → `tests/actions/`

## Scans

Mutations:

- `resetBillScan` (admin) — `src/app/admin/bill-scans/actions.ts:19` → `tests/actions/`

Sonnet client:

- `runSonnetBillScan` — `src/app/api/bills/scan/_sonnet.ts` → `tests/unit/`

Upload endpoint:

- `POST /api/bills/scan` — `src/app/api/bills/scan/route.ts` → `tests/actions/`
  (or dedicated route test)

Retry cron:

- `GET /api/cron/retry-bill-scans` — `src/app/api/cron/retry-bill-scans/route.ts` →
  `tests/actions/` (or dedicated route test)

## Shopping

Mutations:

- `addShoppingItem` — `src/app/shopping/actions.ts:28` → `tests/actions/`
- `autoAddFromPlans` — `src/app/shopping/actions.ts:205` → `tests/actions/`
- `clearShoppingItemChecked` — `src/app/shopping/actions.ts:176` → `tests/actions/`
- `deleteShoppingItem` — `src/app/shopping/actions.ts:191` → `tests/actions/`
- `setShoppingItemChecked` — `src/app/shopping/actions.ts:161` → `tests/actions/`
- `updateShoppingItem` — `src/app/shopping/actions.ts:121` → `tests/actions/`

RPCs:

- `shopping_auto_add_from_plans()` —
  `supabase/migrations/20260527_001_shopping_auto_add_fn.sql` (rewritten by
  `20260622_001_ingredient_aliases.sql`, `20260630_001_shopping_checked_state.sql`) →
  `tests/db/`
- `shopping_commit_to_inventory(p_shopping_id, p_actor)` —
  `supabase/migrations/20260630_001_shopping_checked_state.sql` → `tests/db/`
- `shopping_sweep_checked()` —
  `supabase/migrations/20260630_001_shopping_checked_state.sql` → `tests/db/`

Cron routes:

- `sweep-checked-shopping` cron route —
  `src/app/api/cron/sweep-checked-shopping/route.ts` → `tests/db/`
  (invoke `shopping_sweep_checked`)

## Recipes

Mutations:

- `addRecipeToTodayPlan` — `src/app/recipes/actions.ts:284` → `tests/actions/`
- `createRecipe` — `src/app/recipes/actions.ts:89` → `tests/actions/`
- `updateRecipe` — `src/app/recipes/actions.ts:168` → `tests/actions/`

## Meal plan

Mutations:

- `regenerateMealPlanSlot` — `src/app/plan/actions.ts:47` → `tests/actions/`
- `setMealPlanSlot` — `src/app/plan/actions.ts:21` → `tests/actions/`
- `setPeopleEating` — `src/app/plan/actions.ts:76` → `tests/actions/`

## Dashboard

Mutations:

- `inviteMaidFromHome` — `src/app/dashboard/actions.ts:9` → `tests/actions/`
- `revokeMaidInviteFromHome` — `src/app/dashboard/actions.ts:48` → `tests/actions/`
- `setHouseholdFamilyRun` — `src/app/dashboard/actions.ts:54` → `tests/actions/`

## Household

Mutations:

- `removeMembership` — `src/app/household/settings/actions.ts:181` → `tests/actions/`
- `updateMealTime` — `src/app/household/meal-times/actions.ts:20` → `tests/actions/`
- `updateMembershipDiet` — `src/app/household/settings/actions.ts:228` → `tests/actions/`
- `updateMembershipPrivilege` — `src/app/household/settings/actions.ts:265` → `tests/actions/`

Silent-failure surfaces:

- `tryRedeemPendingEmailInvite` — `src/lib/auth/redeem-email-invite.ts` → `tests/actions/`
  (see also "Explicitly called out" below)

Triggers:

- `seed_default_meal_times` trigger —
  `supabase/migrations/20260609_001_household_meal_times.sql` → `tests/db/`
  (see also "Explicitly called out" below)

## Onboarding

_Fully covered in Phase 5 — see "Covered in Phase 5" at the bottom._

## Infrastructure

Auth helpers (RLS-scoped clients, current-user lookups, role gates):

- `createClient` (RLS-scoped server client) — `src/lib/supabase/server.ts` →
  `tests/auth/`
- `createServiceClient` — `src/lib/supabase/server.ts`, `src/lib/supabase/service.ts` →
  `tests/auth/`
- `getCurrentHousehold()` (incl. lost-membership fallthrough) —
  `src/lib/auth/current-household.ts` → `tests/auth/`
- `getCurrentProfile()` (lazy upsert race with webhook) —
  `src/lib/auth/current-profile.ts` → `tests/auth/`
- `requireAdmin()` — `src/lib/auth/require.ts` → `tests/auth/`
- `requireHousehold()` — `src/lib/auth/require.ts` → `tests/auth/`
- `requirePrivilege()` (incl. order map; current coverage is privilege-order map copy
  only in `tests/auth/helpers.test.ts`) — `src/lib/auth/require.ts` → `tests/auth/`
- `requireRole()` — `src/lib/auth/require.ts` → `tests/auth/`

Webhook handler:

- `POST /api/webhooks/clerk` (Svix verify, `user.created`/`updated`/`deleted`) —
  `src/app/api/webhooks/clerk/route.ts` → `tests/actions/` (route test)

Cron drivers (bearer-token gating, return JSON shape):

- `GET /api/cron/dispatch-task-pushes` —
  `src/app/api/cron/dispatch-task-pushes/route.ts` → `tests/actions/` (route test)
- `GET /api/cron/retry-bill-scans` —
  `src/app/api/cron/retry-bill-scans/route.ts` → `tests/actions/` (route test)
- `GET /api/cron/sweep-checked-shopping` —
  `src/app/api/cron/sweep-checked-shopping/route.ts` → `tests/actions/` (route test)

Push transport:

- `sendWebPush()` (incl. 410/404 → `gone` flag) — `src/lib/push/webpush.ts` →
  `tests/unit/`

## Explicitly called out by audit (priority high regardless of inventory above)

- `seed_default_meal_times` trigger (household.md): fires on every household insert
  to populate `household_meal_times`. Silent failure would leave the household with
  no meal times until manually fixed. Recommended: `tests/db/seed-default-meal-times.test.ts`
  asserting insert-then-select.
- `tryRedeemPendingEmailInvite` (household.md): silently runs inside
  `getCurrentHousehold()` to auto-redeem email-whitelist invites. Failure means a
  user with a valid email invite would silently NOT be added to the household.
  Recommended: `tests/actions/email-invite-auto-redeem.test.ts` covering happy
  path + the silently-swallowed-error path.

## Items removed by Phase 4 cleanup (no longer need tests)

- `archiveRecipe`, `unarchiveRecipe`, `hideStarterRecipe`, `unhideStarterRecipe` (recipes)
- `archiveTask` (tasks)
- `updateInventoryItem`, `deleteInventoryItem` (inventory) — see `docs/product-todos.md` for re-add note
- `deleteBill` (bills)
- `ingest_bill_ocr` RPC (dropped in migration `20260707_001_drop_dead_db_surface.sql`)

## Covered in Phase 5

8 new test files (84 tests) landed on 2026-05-16. Suite is now 241/241 passing.

### Tasks

Mutations:

- `archiveStandardTask` (admin) — `src/app/admin/tasks/actions.ts:81` → `tests/actions/admin-standard-tasks.test.ts`
- `createStandardTask` (admin) — `src/app/admin/tasks/actions.ts:51` → `tests/actions/admin-standard-tasks.test.ts`
- `createTask` — `src/app/tasks/actions.ts:48` → `tests/actions/tasks.test.ts`
- `updateTask` — `src/app/tasks/actions.ts:90` → `tests/actions/tasks.test.ts`

RPCs / triggers:

- `tasks_generate_occurrences` RPC + `tasks-generate-and-prune` pg_cron —
  `supabase/migrations/20260601_001_task_generation_cron.sql`,
  `20260602_001_standard_tasks.sql`,
  `20260705_001_household_setup_gates.sql` → `tests/db/task-occurrences.test.ts`
- `tasks_prune_old` RPC — `supabase/migrations/20260601_001_task_generation_cron.sql` → `tests/db/task-occurrences.test.ts`

Cron routes:

- `GET /api/cron/dispatch-task-pushes` — `src/app/api/cron/dispatch-task-pushes/route.ts` →
  `tests/actions/cron-dispatch-task-pushes.test.ts`

### Onboarding

Mutations:

- `createHouseholdAsMaid` — `src/app/onboarding/actions.ts:59` → `tests/actions/onboarding-create.test.ts`
- `createHouseholdAsOwner` — `src/app/onboarding/actions.ts:20` → `tests/actions/onboarding-create.test.ts`
- `resetTaskSetupForEmptyState` — `src/app/onboarding/tasks/actions.ts:206` →
  `tests/actions/task-setup-wizard.test.ts`
- `saveTaskSetupPicks` — `src/app/onboarding/tasks/actions.ts:15` → `tests/actions/task-setup-wizard.test.ts`
- `submitTaskSetup` — `src/app/onboarding/tasks/actions.ts:77` → `tests/actions/task-setup-wizard.test.ts`

RPCs / triggers:

- `households_sync_maid_mode_on_join()` + `household_memberships_sync_maid_mode`
  trigger — `supabase/migrations/20260705_001_household_setup_gates.sql` → `tests/db/maid-mode-sync-trigger.test.ts`
- `task_setup_drafts` RLS + upsert lifecycle —
  `supabase/migrations/20260705_001_household_setup_gates.sql` → `tests/db/task-setup-drafts.test.ts`
