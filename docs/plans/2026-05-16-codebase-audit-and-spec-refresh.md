# Codebase Audit + Per-Feature Spec Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 25 dated slice specs with 11 architecture-only feature specs that reflect what's in the code today. Add a test coverage gap analysis to each. Then perform conservative dead-code cleanup.

**Architecture:** Three sequential phases. Phase 1 produces `docs/specs/features/<feature>.md` for each of 11 features (architecture-only). Phase 2 appends a `## Test coverage` gap-analysis table to each feature spec. Phase 3 removes obvious dead code (unimported files, unreferenced exports) in individually-revertable commits. No behavior changes, no new migrations, no new production tests.

**Tech Stack:** Documentation work + `npx knip` (or `ts-prune`) for dead-code candidates + `grep` for verification + `pnpm typecheck && pnpm test && pnpm test:e2e` as the regression gate.

**Spec:** [docs/specs/2026-05-16-codebase-audit-and-spec-refresh-design.md](../specs/2026-05-16-codebase-audit-and-spec-refresh-design.md)

---

## File Map

**Created (Phase 1):**
- `docs/specs/features/dashboard.md`
- `docs/specs/features/recipes.md`
- `docs/specs/features/meal-plan.md`
- `docs/specs/features/shopping.md`
- `docs/specs/features/inventory.md`
- `docs/specs/features/bills.md`
- `docs/specs/features/scans.md`
- `docs/specs/features/tasks.md`
- `docs/specs/features/household.md`
- `docs/specs/features/onboarding.md`
- `docs/specs/features/infrastructure.md`

**Modified (Phase 1):** every dated spec in `docs/specs/` that maps to a new feature spec gets a one-line banner inserted at the top. Mapping in Task 13.

**Modified (Phase 2):** the same 11 `docs/specs/features/<feature>.md` files — `## Test coverage` section populated.

**Modified/Deleted (Phase 3):** identified by tooling + manual verification during the phase. Captured in `docs/specs/features/_cleanup-candidates.md` as a working list before any deletion.

---

## Phase 1 — Per-feature architecture specs

### Phase 1 procedure

This procedure applies to every Phase 1 task (Tasks 1–11). Each task substitutes its own feature name and scope into the steps below.

**Steps for each Phase 1 task:**

- [ ] **Step 1: Create the spec file with the skeleton**

  Create `docs/specs/features/<feature>.md` with this exact skeleton:

  ```markdown
  # <Feature> — architecture

  **Status:** active
  **Last reviewed:** 2026-05-16

  ## Routes
  | Route | File | Type |
  | --- | --- | --- |

  ## Server actions
  | Action | File | Input shape | Output shape | Called by |
  | --- | --- | --- | --- | --- |

  ## Components
  | Component | File | Used by |
  | --- | --- | --- |

  ## DB surface
  | Object | Kind | Introduced in | Notes |
  | --- | --- | --- | --- |

  ## External integrations
  - _(populate during inventory; remove this placeholder)_

  ## Open questions
  - _(populate during inventory; remove this placeholder)_

  ## Test coverage
  _To be filled in Phase 2._
  ```

  Set `Status: unclear` instead of `active` if any route in scope looks superseded (e.g. consolidated, renamed, or replaced by a newer flow). Surface the question to the user before continuing.

- [ ] **Step 2: Inventory routes**

  For the feature's route scope (listed in the task), populate the **Routes** table. One row per route file. `Type` is one of `page` / `layout` / `loading` / `server-actions` / `api`. Use the file path relative to repo root.

- [ ] **Step 3: Inventory server actions**

  For each `actions.ts` in scope, read the file. For each exported async function:
  - **Action** = function name
  - **File** = `src/app/<route>/actions.ts:<line>` (cite line where the function starts)
  - **Input shape** = the Zod schema or argument list (compact: `{ recipeId: string, ingredients: Array<{...}> }`)
  - **Output shape** = the return type (e.g. `{ ok: true; recipeId: string } | { ok: false; error: string }`)
  - **Called by** = grep `<actionName>(` across `src/` and list the calling files

- [ ] **Step 4: Inventory components**

  For each component used by the feature's routes (start from `src/components/<feature>/` and walk imports from the route pages), populate the **Components** table:
  - **Component** = exported component name
  - **File** = `src/components/<area>/<name>.tsx`
  - **Used by** = grep imports and list the routes/components that consume it

- [ ] **Step 5: Inventory DB surface**

  Grep `supabase/migrations/` for tables, RPCs, cron jobs, storage buckets, and enums referenced by this feature. For each:
  - **Object** = name (e.g. `recipes`, `mealplan_suggest_for_date`, `mealplan-suggest-tomorrow`, `recipe-photos`)
  - **Kind** = `table` / `RPC` / `cron job` / `storage bucket` / `enum`
  - **Introduced in** = the migration filename (e.g. `20260517_001_recipes.sql`)
  - **Notes** = anything notable (e.g. "RLS read = active member, mutate = owner/maid"; "appears unused by current src — confirm before drop")

  To find references, grep both `src/` (TypeScript) and `supabase/migrations/` (for inter-migration references).

- [ ] **Step 6: External integrations**

  Replace the placeholder with bullet points for each external system this feature touches:
  - Clerk: which JWT claims / webhooks / pages
  - Supabase: which clients (client/server/service), which storage buckets
  - Anthropic: which model, which prompt area (e.g. bill scan OCR)
  - web-push: subscription/notification touchpoints
  - Any other (cron driver, etc.)

  If none, remove the section heading entirely.

- [ ] **Step 7: Open questions**

  Replace the placeholder. Source these from:
  - inline `// TODO` / `// FIXME` / `// XXX` comments in files within scope (grep them)
  - `docs/HANDOFF.md` mentions of this feature area
  - Anything that *looks* unused but isn't airtight (mark "appears unused — confirm before drop")
  - Half-built routes (e.g. `/onboarding/tasks` if superseded)

  If none, remove the section heading entirely.

- [ ] **Step 8: Self-review the spec**

  Re-read the spec. Check:
  - Every route in the feature's scope has a row in Routes
  - Every server action has its `Called by` populated (or "no callers — appears unused")
  - DB surface rows cite a migration file that exists
  - No placeholders left in the file

  Fix issues inline.

- [ ] **Step 9: Add banners to related old specs**

  For each related dated spec listed in the task, insert this banner as the second line (right after the `# Title`):

  ```markdown
  > **Superseded as the living architecture doc for the <feature> area by [`features/<feature>.md`](features/<feature>.md).** This dated spec is retained for historical context.
  ```

  The scoped phrasing ("for the `<feature>` area") works for both single-target and multi-target dated specs. A multi-target dated spec receives multiple banners (one per target feature, added by each feature's task), each scoped to its own feature.

  Use Edit, not Write — preserve the rest of the file unchanged.

- [ ] **Step 10: Commit**

  ```bash
  git add docs/specs/features/<feature>.md docs/specs/<each banner-modified file>
  git commit -m "$(cat <<'EOF'
  docs(specs): add features/<feature>.md architecture spec

  Architecture-only spec for the <feature> area. Banners added to N dated
  specs pointing to the new living doc.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 1: Dashboard feature spec

**Files:**
- Create: `docs/specs/features/dashboard.md`
- Modify (banner): see Task 13 mapping for any dashboard-related old specs (likely `2026-05-16-merge-home-and-rename-recipes-to-meal-design.md`, `2026-05-16-unify-plan-tasks-into-home-design.md`, `2026-05-16-task-setup-and-household-mode-design.md`)

**Scope** (per design doc — dashboard covers home page composition only, not the features it links into):
- Routes: `src/app/dashboard/page.tsx`, `src/app/dashboard/actions.ts`, `src/app/dashboard/loading.tsx`
- Components: `src/components/dashboard/*`
- DB surface: anything `dashboard/page.tsx` or `dashboard/actions.ts` queries directly

Cards on the dashboard that link into other features just get a "links to `features/<feature>.md`" reference — do not re-describe the destination feature.

Follow the Phase 1 procedure above.

---

### Task 2: Recipes feature spec

**Files:**
- Create: `docs/specs/features/recipes.md`
- Modify (banner): see Task 13 mapping (likely `2026-05-11-slice-2a-recipes-meal-plan-design.md`, `2026-05-14-recipe-data-fill-design.md`, `2026-05-14-recipe-edit-video-url-design.md`)

**Scope:**
- Routes: `src/app/recipes/page.tsx`, `src/app/recipes/new/`, `src/app/recipes/[id]/`, `src/app/recipes/actions.ts`, `src/app/recipes/loading.tsx`
- Components: `src/components/recipes/*`
- DB surface: `recipes`, `recipe_ingredients`, `recipe_steps`, `household_recipe_hides`, `effective_recipes`, `recipe-photos`/`recipe-photos-private` storage buckets, related RPCs

Follow the Phase 1 procedure.

---

### Task 3: Meal plan feature spec

**Files:**
- Create: `docs/specs/features/meal-plan.md`
- Modify (banner): see Task 13 mapping (likely `2026-05-11-slice-2a-recipes-meal-plan-design.md` shared with recipes)

**Scope:**
- Routes: `src/app/plan/page.tsx`, `src/app/plan/[date]/`, `src/app/plan/actions.ts`
- Components: `src/components/plan/*`
- DB surface: `meal_plans`, `meal_slot` enum, `mealplan_suggest_for_date` and related RPCs, `mealplan-suggest-tomorrow` cron, autofill RPCs, null-recipe cleanup helpers

Follow the Phase 1 procedure.

---

### Task 4: Shopping feature spec

**Files:**
- Create: `docs/specs/features/shopping.md`
- Modify (banner): see Task 13 mapping (likely `2026-05-11-slice-2b-shopping-list-design.md`, `2026-05-16-shopping-typeahead-design.md`, `2026-05-16-shopping-ingredient-aliases-design.md`, `2026-05-16-bills-cleanup-and-shopping-tab-design.md`)

**Scope:**
- Routes: `src/app/shopping/page.tsx`, `src/app/shopping/actions.ts`, `src/app/shopping/loading.tsx`, `src/app/shopping/_bills-tab.tsx`
- Components: `src/components/shopping/*`
- DB surface: `shopping_list_items`, `shopping_auto_add_*` RPCs, `ingredient_aliases`, `shopping_checked_state` (if present)

Follow the Phase 1 procedure.

---

### Task 5: Inventory feature spec

**Files:**
- Create: `docs/specs/features/inventory.md`
- Modify (banner): see Task 13 mapping (likely `2026-05-14-inventory-design.md`, `2026-05-14-inventory-onboarding-units-and-custom-rows-design.md`, `2026-05-16-inventory-scan-receipt-design.md`, `2026-05-16-bill-scan-into-inventory-design.md`, `2026-05-14-auto-allocation-design.md`)

**Scope:**
- Routes: `src/app/inventory/page.tsx`, `src/app/inventory/[id]/`, `src/app/inventory/new/`, `src/app/inventory/conversions/`, `src/app/inventory/actions.ts`, `src/app/inventory/loading.tsx`, helpers `src/app/inventory/_onboarding-parse.ts`, `src/app/inventory/_starter-items.ts`
- Components: `src/components/inventory/*`
- DB surface: `inventory_items`, `inventory_transactions`, `unit_conversions`, inventory helpers + RPCs, `inventory-sweep-*` cron, `inventory_cook_deduct_*` RPCs, `inventory_bill_*` RPCs, `inventory_manual_adjust_*`

Follow the Phase 1 procedure.

---

### Task 6: Bills feature spec

**Files:**
- Create: `docs/specs/features/bills.md`
- Modify (banner): see Task 13 mapping (likely `2026-05-11-slice-3-bill-scanning-ocr-design.md` shared with scans, `2026-05-16-bills-cleanup-and-shopping-tab-design.md`)

**Scope:**
- Routes: `src/app/bills/[id]/`, `src/app/bills/actions.ts`, `src/app/bills/_dedupe.ts`
- API: `src/app/api/bills/*`
- Components: `src/components/bills/*`
- DB surface: `bills`, bill line items table, `bill_inventory_link`, `ingest_bill_ocr_*`, `bill_scan_retries`, dropped columns audit (`drop_bills_github_columns`)

Follow the Phase 1 procedure.

---

### Task 7: Scans feature spec

**Files:**
- Create: `docs/specs/features/scans.md`
- Modify (banner): see Task 13 mapping (likely `2026-05-11-slice-3-bill-scanning-ocr-design.md`, `2026-05-16-bill-scan-retry-queue-design.md`, `2026-05-16-inventory-scan-receipt-design.md`)

**Scope:**
- Routes: `src/app/scans/actions.ts`, `src/app/scans/pending/`
- Admin: `src/app/admin/bill-scans/`
- API: any scan-related routes under `src/app/api/`
- Components: any scan UI in `src/components/bills/` or elsewhere (grep for it)
- DB surface: bill scan retry table, OCR ingest RPCs, related storage buckets

Note overlap with Bills (Task 6) — the line is: Bills = bills/line items domain. Scans = the OCR ingest pipeline (upload, retry, admin review).

Follow the Phase 1 procedure.

---

### Task 8: Tasks feature spec

**Files:**
- Create: `docs/specs/features/tasks.md`
- Modify (banner): see Task 13 mapping (likely `2026-05-11-slice-5-tasks-reminders-push-design.md`, `2026-05-16-tasks-day-grouping-design.md`, `2026-05-16-task-setup-and-household-mode-design.md`)

**Scope:**
- Routes: `src/app/tasks/page.tsx`, `src/app/tasks/[date]/`, `src/app/tasks/new/`, `src/app/tasks/edit/`, `src/app/tasks/actions.ts`
- Admin: `src/app/admin/tasks/`
- API: `src/app/api/cron/*` (task generation cron, if present)
- Push: `src/app/push/*`
- Components: `src/components/tasks/*`
- DB surface: `tasks`, task occurrences table, standard tasks table + seed, task generation cron, setup gates table/columns, `tasks_member_insert`

Follow the Phase 1 procedure.

---

### Task 9: Household feature spec

**Files:**
- Create: `docs/specs/features/household.md`
- Modify (banner): see Task 13 mapping (likely `2026-05-16-household-settings-email-invites-design.md`, `2026-05-16-diet-preferences-design.md`, `2026-05-16-household-meal-preference-design.md`, `2026-05-11-owner-invite-maid-on-home-design.md`)

**Scope:**
- Routes: `src/app/household/settings/`, `src/app/household/meal-times/`
- Components: `src/components/household/*`
- DB surface: `households` (incl. `diet_preference`, `maid_mode`, `task_setup_completed_at`), `household_memberships`, `invites`, `invite_emails`, `household_meal_times`, `household_effective_diet` (RPC), `diet_preferences` (table or enum), `redeem_invite_*` RPCs

Follow the Phase 1 procedure.

---

### Task 10: Onboarding feature spec

**Files:**
- Create: `docs/specs/features/onboarding.md`
- Modify (banner): see Task 13 mapping (likely `2026-05-10-foundations-design.md` for the initial onboarding bits, `2026-05-16-task-setup-and-household-mode-design.md` for the wizard)

**Scope:**
- Routes: `src/app/onboarding/page.tsx`, `src/app/onboarding/actions.ts`, `src/app/onboarding/maid/`, `src/app/onboarding/owner/`, `src/app/onboarding/tasks/`
- Components used during onboarding (cross-area; trace from the route pages)
- DB surface: onboarding-related state on `households` and `household_memberships`, task setup picks/submit RPCs

If `/onboarding/tasks` appears fully superseded by the dashboard's TaskSetupPromptCard wizard, set `Status: unclear` and surface to the user before continuing this task.

Follow the Phase 1 procedure.

---

### Task 11: Infrastructure feature spec

**Files:**
- Create: `docs/specs/features/infrastructure.md`
- Modify (banner): see Task 13 mapping (likely `2026-05-10-foundations-design.md` is the main one)

**Scope:**
- Auth: `src/lib/auth/*`, sign-in `src/app/sign-in/`, sign-up `src/app/sign-up/`, join `src/app/join/`
- Supabase clients: `src/lib/supabase/*`, `src/lib/db/types.ts`
- Proxy: `src/proxy.ts`
- Webhooks: `src/app/api/webhooks/clerk/*`
- Cron driver: `src/app/api/cron/*` (general — feature-specific cron routes are scoped to their feature spec, but the driver/router itself lives here)
- Push: `src/lib/push/*`
- Admin tools: any admin route that isn't feature-scoped to Task 7 (bill-scans) or Task 8 (tasks) — re-read `src/app/admin/` to confirm split
- Instrumentation: `src/instrumentation.ts`, `src/lib/admin/env-sync.ts`
- Service worker / PWA: `src/app/sw.ts`, `src/app/manifest.ts`, `src/app/apple-icon.tsx`, `src/app/icon.tsx`

Follow the Phase 1 procedure. The Routes table here is large — that's expected.

---

### Task 12: Wait for user review of all 11 specs

Per the design doc's "review cadence" decision, all 11 Phase 1 specs are batched for one user review.

- [ ] **Step 1: Summarise what was produced**

  Post a short message to the user listing the 11 spec files, any `status: unclear` flags raised, and any open questions surfaced from the audit.

- [ ] **Step 2: Wait for user feedback**

  Do not proceed to Phase 2 until the user signs off (or requests changes; if changes, re-enter the relevant Task 1–11 to revise).

---

### Task 13: Old spec banner mapping audit

This task creates a mapping table that Tasks 1–11 reference (the "likely" lists above are best-guesses; this task confirms them).

- [ ] **Step 1: Read every dated spec in `docs/specs/` and extract its scope**

  Use `ls docs/specs/` to enumerate dated `*-design.md` files. For each, read the first 30 lines (title, summary). Bucket each into one of the 11 feature areas based on subject matter.

- [ ] **Step 2: Write the mapping to `docs/specs/features/_old-spec-mapping.md`**

  Format:

  ```markdown
  # Old spec → feature spec mapping

  | Old spec | Feature spec | Notes |
  | --- | --- | --- |
  | docs/specs/2026-05-10-foundations-design.md | infrastructure.md + onboarding.md | covers both — banner both |
  | ... | ... | ... |
  ```

  Multi-target rows are fine. Each old spec must appear at least once.

- [ ] **Step 3: Commit**

  ```bash
  git add docs/specs/features/_old-spec-mapping.md
  git commit -m "docs(specs): map dated specs to new feature spec destinations

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

**Note on execution order:** Task 13 should run FIRST in Phase 1 (before Tasks 1–11) so the per-feature tasks have an authoritative banner list. The execution order is: 13 → 1 → 2 → ... → 11 → 12.

---

## Phase 2 — Test coverage gap analysis

### Phase 2 procedure

This procedure applies to every Phase 2 task (Tasks 14–24). Each task substitutes its own feature name.

**Steps for each Phase 2 task:**

- [ ] **Step 1: Enumerate code units from the feature spec**

  Open `docs/specs/features/<feature>.md`. List every:
  - server action (from the Server actions table)
  - RPC (from DB surface, kind=RPC)
  - cron job (from DB surface, kind=cron job)
  - page route (from Routes, type=page) — for e2e flow coverage
  - pure function (parsers/dedupers/scorers in `src/app/<feature>/_*.ts` or `src/lib/*`)

- [ ] **Step 2: Grep existing tests for coverage of each unit**

  For each code unit, search `tests/`:
  ```bash
  rg -l '<unitName>' tests/
  ```
  Categorise hits:
  - `tests/unit/*` → Unit test column
  - `tests/actions/*` → Integration test column (these exercise server actions against a real DB)
  - `tests/db/*` → Integration test column
  - `tests/e2e/*` → E2E column

  A unit may appear in multiple columns; that's fine.

- [ ] **Step 3: Assign priority and recommended test type**

  Priority:
  - `high` = data-loss path or revenue-affecting mutation with zero coverage
  - `medium` = user-visible mutation with zero coverage
  - `low` = idempotent read or rarely-touched path with zero coverage
  - `none` = adequately covered (at least one of unit/integration/e2e exists)

  Recommended test type per code-unit kind:
  - server action → `tests/actions/` (vitest)
  - RPC or DB helper → `tests/db/` (vitest with pg client)
  - pure function → `tests/unit/` (vitest)
  - user flow / page → `tests/e2e/` (playwright)
  - cron job → `tests/db/` invoking the underlying RPC

- [ ] **Step 4: Replace the `## Test coverage` placeholder in the feature spec**

  Open `docs/specs/features/<feature>.md`. Replace:

  ```markdown
  ## Test coverage
  _To be filled in Phase 2._
  ```

  with:

  ```markdown
  ## Test coverage

  | Code unit | File | Unit | Integration | E2E | Priority gap | Recommended test type |
  | --- | --- | --- | --- | --- | --- | --- |
  | <unit> | <file> | <path or —> | <path or —> | <path or —> | <high/med/low/none> | <test type> |
  ```

  Sort the table by Priority gap descending (high first), then by code unit name.

- [ ] **Step 5: Self-review the table**

  - Every code unit from Step 1 has a row.
  - No row has all three test columns as `—` AND priority as `none` (that would be a contradiction).
  - Priorities are justified — a row marked `high` should actually be a data-loss / mutation path.

- [ ] **Step 6: Commit**

  ```bash
  git add docs/specs/features/<feature>.md
  git commit -m "$(cat <<'EOF'
  docs(specs): add test coverage gap analysis for <feature>

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Tasks 14–24: One per feature

Each task is: "Apply the Phase 2 procedure to `docs/specs/features/<feature>.md`."

- [ ] **Task 14: dashboard test coverage**
- [ ] **Task 15: recipes test coverage**
- [ ] **Task 16: meal-plan test coverage**
- [ ] **Task 17: shopping test coverage**
- [ ] **Task 18: inventory test coverage**
- [ ] **Task 19: bills test coverage**
- [ ] **Task 20: scans test coverage**
- [ ] **Task 21: tasks test coverage**
- [ ] **Task 22: household test coverage**
- [ ] **Task 23: onboarding test coverage**
- [ ] **Task 24: infrastructure test coverage**

---

### Task 25: Wait for user review of all 11 test coverage sections

- [ ] **Step 1: Summarise high-priority gaps**

  Post a message to the user enumerating the `high` priority gaps across all 11 features. This is the punch list they may want to act on.

- [ ] **Step 2: Wait for user feedback before Phase 3**

  Do not proceed to dead-code cleanup until the user signs off.

---

## Phase 3 — Conservative dead-code cleanup

### Task 26: Generate dead-code candidate list

**Files:**
- Create: `docs/specs/features/_cleanup-candidates.md` (working list, removed after Phase 3 completes)

- [ ] **Step 1: Run knip**

  ```bash
  npx --yes knip --reporter json > /tmp/knip-report.json
  ```

  If knip needs config and prompts, accept defaults. If knip is not installable in this environment, fall back to:

  ```bash
  npx --yes ts-prune > /tmp/ts-prune.txt
  ```

- [ ] **Step 2: Triage candidates into the working list**

  Create `docs/specs/features/_cleanup-candidates.md`:

  ```markdown
  # Dead code cleanup candidates

  Working list for Phase 3. Each candidate is verified manually (Step 3 of Task 27+) before removal.

  ## Unimported files (knip/ts-prune)
  - [ ] src/path/to/file.ts — reason: zero importers per knip
  - [ ] ...

  ## Unused exports
  - [ ] src/path/to/file.ts — exports `foo`, `bar` — zero importers per knip
  - [ ] ...

  ## Unused shadcn primitives
  - [ ] src/components/ui/<primitive>.tsx — zero references per `rg`
  - [ ] ...

  ## Unused lib helpers
  - [ ] src/lib/<path>.ts — exports `foo` — zero callers per `rg`
  - [ ] ...
  ```

- [ ] **Step 3: Commit the working list**

  ```bash
  git add docs/specs/features/_cleanup-candidates.md
  git commit -m "chore(cleanup): seed dead-code candidate list for Phase 3 audit

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 27: Per-batch cleanup procedure

This is a procedure executed repeatedly until `_cleanup-candidates.md` is exhausted. Each pass produces ONE commit removing ONE category of dead code (or one self-contained file group).

**Steps per pass:**

- [ ] **Step 1: Pick the next batch from the candidate list**

  Open `docs/specs/features/_cleanup-candidates.md`. Pick a logical group:
  - one unused file + the unused exports inside it, OR
  - one shadcn primitive, OR
  - one related set of helpers in the same lib file

  Keep batches small — one diff a human can review in 60 seconds.

- [ ] **Step 2: Verify zero references manually**

  For each file/symbol in the batch:
  ```bash
  rg -t ts -t tsx '<symbol or filename without extension>' src/ tests/ supabase/ docs/
  ```
  Inspect every hit. False positives (matches in comments, in strings, in `_cleanup-candidates.md` itself) are OK. Real importers mean DO NOT REMOVE — strike from the list with a note.

- [ ] **Step 3: Remove the dead code**

  Use the Edit tool to delete files or remove symbols. Do not just comment out — delete.

- [ ] **Step 4: Run the regression gate**

  ```bash
  pnpm typecheck
  ```
  Expected: clean.

  ```bash
  pnpm test
  ```
  Expected: same pass count as before the batch (no new failures).

  ```bash
  pnpm test:e2e
  ```
  Expected: same pass count as before the batch.

  If any check fails: `git restore .` (only modified files in this batch), strike the batch from the candidate list with a note ("removal broke <check> — needs investigation"), do NOT commit.

- [ ] **Step 5: Update the candidate list**

  Edit `docs/specs/features/_cleanup-candidates.md`: mark the removed items with `[x]` (checked) and append a brief outcome note. Do NOT delete the lines yet — they'll be cleaned up in Task 28.

- [ ] **Step 6: Commit**

  ```bash
  git add <files removed/modified> docs/specs/features/_cleanup-candidates.md
  git commit -m "$(cat <<'EOF'
  chore(cleanup): remove unused <thing>

  No callers in src/, tests/, or supabase/. Verified with rg.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

**Repeat Task 27 until every candidate in the list is either removed (`[x]`) or marked struck-with-note.**

---

### Task 28: Close out Phase 3

- [ ] **Step 1: Final regression gate**

  ```bash
  pnpm typecheck && pnpm test && pnpm test:e2e
  ```
  All three must be clean.

- [ ] **Step 2: Delete the working list**

  ```bash
  git rm docs/specs/features/_cleanup-candidates.md
  ```

- [ ] **Step 3: Final commit**

  ```bash
  git commit -m "chore(cleanup): close out Phase 3 dead-code audit

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  ```

- [ ] **Step 4: Notify user**

  Post a summary: "Phase 3 complete. N files removed, M unused exports removed, K candidates struck (with reasons). All checks green."

---

## Summary of task execution order

1. **Task 13** — Old spec banner mapping (must run first so Tasks 1–11 know what to banner)
2. **Tasks 1–11** — One feature spec each (Phase 1)
3. **Task 12** — User review checkpoint (Phase 1 batch review)
4. **Tasks 14–24** — One test coverage section each (Phase 2)
5. **Task 25** — User review checkpoint (Phase 2 batch review)
6. **Task 26** — Generate cleanup candidate list (Phase 3 start)
7. **Task 27** — Per-batch cleanup procedure (repeated until list exhausted)
8. **Task 28** — Phase 3 close-out

**Total user review checkpoints: 3** (Tasks 12, 25, ongoing during 27).
