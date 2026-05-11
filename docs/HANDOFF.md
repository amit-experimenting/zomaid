# Zomaid — Foundations + Slice 2a Handoff

**Last updated:** 2026-05-11 (slice 2a complete)
**Current head:** `333acc4` on `main` (~30 commits ahead of last-pushed `48990e1`)
**Test state:** verification gate ran on this machine — `pnpm db:reset && pnpm typecheck && pnpm test tests/db && pnpm test:e2e` all green: 18 foundations DB tests pass, 9 slice 2a migrations apply cleanly, typecheck clean, **10 Playwright tests pass + 2 expected auth-required skips** (chromium + WebKit/iPhone-13 projects). Slice 2a vitest unit/action tests were intentionally skipped per the user's "we'll come back to tests" instruction. Manual walkthrough (6-step checklist in the plan) is still owed — that's interactive in the browser, requires the user.

This doc is the single source of truth for "what's done, what's next, what to ignore in the plan because reality diverged."

## Resuming on a new machine

```bash
git clone https://github.com/amit-experimenting/zomaid.git
cd zomaid
pnpm install
pnpm exec playwright install chromium     # ~165 MB Chromium download

# Prereqs that must exist on the machine:
#  - Docker Desktop, running
#  - Supabase CLI ≥ 2.0 (brew install supabase/tap/supabase)

pnpm db:start                              # downloads ~1 GB on first run, then idempotent
pnpm db:reset                              # applies all 6 migrations
pnpm test                                  # expect: 28 pass, 9 test files
pnpm typecheck                             # expect: clean
```

If `pnpm test` shows fewer than 28 or any failures, **stop** — the local Supabase stack probably didn't apply migrations cleanly. `pnpm db:reset` again, then re-run.

## Status

### Done (18 of 19 plan tasks + 1 bugfix + 9 review fixes)

- **1** Vitest + Playwright + pg test harness
- **2** Local Supabase initialized (Clerk third-party auth left disabled — see *Pre-flight* below)
- **3** `profiles` table + RLS + tests
- **4** Supabase clients forward Clerk JWT via `accessToken` callback; `Database` types hand-curated
- **5** Clerk webhook (`/api/webhooks/clerk`) + `getCurrentProfile` lazy-upsert backstop
- **6** `households` table (creator-INSERT policy only — read/update added in Task 7)
- **7** `household_memberships` table, unique invariants, completes households RLS
- **8** `invites` table + `redeem_invite` SECURITY DEFINER RPC + tests
- **9** `getCurrentHousehold`, `requireHousehold`, `requireRole`, `requirePrivilege`
- **10** Onboarding server actions (`createHouseholdAsOwner`, `createHouseholdAsMaid`)
- **11** Invite + membership server actions (`createInvite`, `revokeInvite`, `redeemInvite`, `removeMembership`, `updateMembershipPrivilege`)
- **12** `proxy.ts` route matchers (public + auth-gated)
- **13** `/onboarding` chooser + maid/owner sub-forms; `/` redirects signed-in users
- **14** `/join/[token]` auto-redeem + `/join/code` entry page
- **15** `/dashboard` placeholder rebuild (member context + Coming Soon cards)
- **16** `/household/settings` page (members list, invites, privilege controls)
- **17** Admin env-var sync boot task (`syncAdminFlags` + `instrumentation.ts`)
- **18** Playwright smoke E2E (commit `7024cca`, **unverified**)
- **bugfix** Admin trigger now skips when `auth.jwt() ->> 'sub'` is null (migration `20260515_001_admin_trigger_fix.sql`) — see *Deviation 6* below.
- **review-fixes** Final code review (this session) surfaced 2 Critical + 9 Important findings. Code defects fixed across two commits (deployment-related items deferred — see "Deferred from review" below).
  - `9b777a3` — 7 TypeScript fixes: `redeemInvite` swapped to Clerk-JWT client for the RPC (was always rejecting `28000 not authenticated`); `revokeInvite` added ownership check + sets `consumed_at` not `expires_at` to release the partial-index code slot; dropped unused `ownerEmail` capture in maid onboarding; stopped leaking `?ownerInvite=<token>` in the dashboard URL (server-queries pending owner-invite via RLS instead); `getCurrentProfile` lazy-upsert now uses `.upsert + refetch` to be race-safe vs the webhook; `env-sync` replaces PostgREST string-concat with safer `.neq` sentinel pattern; Playwright redirect assertions tightened from `toMatch(/\/$/)` to `toHaveURL("http://localhost:3000/")`.
  - `3eaa6d7` — migration `20260516_001_redeem_invite_duplicate_check.sql`: adds explicit P0007 `caller already a member of this household` pre-check between P0006 and the membership insert, mirroring the partial index `hm_unique_active_pair` so the user sees a clean error instead of `23505 unique_violation`. Predicate `status <> 'removed'` allows a removed member to re-join via a fresh invite.

### Done — Slice 2a (Recipes & meal plan)

Spec: [`docs/specs/2026-05-11-slice-2a-recipes-meal-plan-design.md`](specs/2026-05-11-slice-2a-recipes-meal-plan-design.md). Plan: [`docs/plans/2026-05-11-slice-2a-recipes-meal-plan.md`](plans/2026-05-11-slice-2a-recipes-meal-plan.md). 24 tasks executed via `superpowers:subagent-driven-development`.

- **Migrations (9):** `20260517_001_recipes.sql` (with `is_active_owner_or_maid` helper at the bottom — order-of-application fix), `20260518_001_recipe_subtables.sql`, `20260519_001_household_recipe_hides.sql`, `20260520_001_meal_plans.sql`, `20260521_001_effective_recipes.sql`, `20260522_001_meal_plan_rpcs.sql`, `20260523_001_meal_plan_cron.sql` (nightly 22:00 SGT job `mealplan-suggest-tomorrow`), `20260524_001_recipe_storage.sql` (two buckets + RLS), `20260525_001_starter_pack_seed.sql` (30 SG recipes: 8 breakfast / 8 lunch / 6 snacks / 8 dinner; names only).
- **Server actions:** `src/app/recipes/actions.ts` (createRecipe, updateRecipe with fork-on-edit, archive/unarchive, hide/unhide starter); `src/app/plan/actions.ts` (setMealPlanSlot, regenerateMealPlanSlot).
- **UI (8 files):** `/plan`, `/plan/[date]`, `/recipes`, `/recipes/new`, `/recipes/[id]`, `/recipes/[id]/edit`; `today-list`, `slot-row`, `week-strip`, `slot-action-sheet`, `recipe-picker`, `recipe-card`, `recipe-detail`, `recipe-form` (client-side photo compression via `browser-image-compression`).
- **Dashboard:** "Recipes & meal plan" card now active, routes to `/plan`. Other three cards still "Soon".
- **shadcn primitives added:** `sheet`, `textarea`, `dropdown-menu`, `dialog` (base-ui preset; `asChild` is `render={...}` here).
- **Database types** extended with all 5 new tables, the `meal_slot` enum, and 4 RPCs.
- **Family is read-only in v1.** `meal_modify` privilege from foundations is parked; deferred to a later slice when billing wires it.

### Deferred from slice 2a (code-review findings, not blocking)

Surfaced by the Task 13 code-quality review. None block normal flows; all are belt-and-braces improvements that the user opted to defer along with the test-writing.

1. **Photo update error not checked** in `src/app/recipes/actions.ts` (create flow after upload; update flow after upload). Spec §7.4 already tolerates orphan blobs, but the user gets back a misleading success if the row update fails after a successful upload. Add `if (error) return …` + a comment citing §7.4.
2. **Ingredient/step delete errors not checked** before re-inserting in `updateRecipe`. Transient delete failure would silently corrupt data on a subsequent successful insert. Add error checks on the two `delete().eq("recipe_id", …)` calls.
3. **No DB transaction wrapping** of recipes + ingredients + steps inserts. Spec language ("all in one transaction") is aspirational — Supabase JS has no cross-table transaction API. Either accept the partial-state risk explicitly in the code comments, or refactor to a Postgres function that wraps the three inserts in a single statement.
4. **`fieldErrors` type assertion loses Zod's array structure** in `createRecipe` / `updateRecipe`. `parsed.error.flatten().fieldErrors` is `Record<string, string[] | undefined>`; the `as Record<string, string>` cast hides that. Either widen the action's response type or join the arrays before returning.
5. **No min-length on Zod's `ingredients` / `steps` arrays.** A recipe can be created with zero ingredients or zero steps. Decide product policy and tighten.

### Slice 2a — verification status

- ✅ `pnpm db:reset` — all 16 migrations apply (7 foundations + 9 slice 2a).
- ✅ `pnpm typecheck` — clean.
- ✅ `pnpm test tests/db` — 18 foundations DB tests pass (no slice 2a tests added per user's "skip tests" instruction).
- ✅ `pnpm test:e2e` — 10 pass (foundations 6 + slice 2a 4), 2 expected skips for the auth-required manual cases.
- ⏳ **Manual 6-step walkthrough** from the plan's Task 24 Step 2 (owner adds recipe → maid sees plan → family read-only → cron simulation `select mealplan_suggest_for_date(current_date + 1)`) — interactive, requires user.
- ⏳ **For prod cutover**: cloud Supabase needs `pg_cron` extension enabled (Dashboard → Database → Extensions). Pre-flight B in the plan documents this gate.

### Late slice 2a fix worth knowing about (commit `c0d3c3f`)

`/plan` and `/recipes` were initially missing from `proxy.ts`'s `isAuthGated` matcher. Unauthenticated visits fell through middleware and only hit the page-level `requireHousehold()` (which throws / redirects internally). The E2E smoke caught this; the matcher was updated to include `/plan(.*)` and `/recipes(.*)` alongside the foundations routes. Both gated routes now redirect to `/` for unauthenticated callers, matching the foundations pattern.

### Deferred from review (next session — foundations residue)

Surfaced by the final code review but intentionally not fixed this loop. None affect non-deployment code paths.

1. **Server-action test coverage (review's Important #9) — infrastructure landed; tests still to write.** Commit `ffd565f` added `tests/helpers/{clerk,next,supabase-test-client}.ts` plus env defaults in `tests/setup.ts` — Clerk auth/currentUser mocks (with a real HS256 JWT signed by the local Supabase secret so Clerk → Supabase → RLS flows end-to-end), Next stubs for redirect/revalidatePath/cookies, and service-role HTTP factories that produce committed seed data the action can read. Tests themselves were drafted but not committed — the planned spec is ~15 cases across three new files:
   - `tests/actions/invites-actions.test.ts` — `createInvite` (4 cases), `revokeInvite` (5 cases covering C2 + I4), `redeemInvite` (5 cases covering C1 end-to-end via Clerk-JWT path).
   - `tests/actions/memberships-actions.test.ts` — `removeMembership` (4-5 cases), `updateMembershipPrivilege` (3-4 cases).
   - `tests/actions/onboarding-actions.test.ts` — `createHouseholdAsOwner` (3 cases), `createHouseholdAsMaid` (3 cases covering I7 + I8).
   Required envs to run: `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `pnpm db:start` / `supabase status`. Per-test pattern is in the helpers' header comments. Existing `tests/actions/*.ts` files are DB-invariant tests; consider moving them under `tests/db/` once the new action-level files land.
2. **SQL test for the P0007 duplicate-membership pre-check** added in migration `20260516_001`. `tests/db/invites.test.ts` has a passing `not found / already consumed / expired / capacity-maid` set but doesn't yet exercise P0007 (caller already a non-removed member of the household). Small (~20 lines).
3. **SQL test for revoke-via-consumed_at semantics** — verify that after `revokeInvite` runs, the partial unique index on `invites.code where consumed_at is null` releases the slot (i.e. a new invite can reuse the same code). Small (~30 lines).
4. **`.env.local.example` is missing two env vars the code reads** — `CLERK_WEBHOOK_SIGNING_SECRET` (`src/app/api/webhooks/clerk/route.ts`) and `ZOMAID_ADMIN_CLERK_USER_IDS` (`src/lib/admin/env-sync.ts`). Fold into Pre-flight E.
5. **Clerk `Show` API verification** (`src/app/page.tsx:1-3`). Plan and code use `Show when="signed-in|signed-out"`; confirm this exists in `@clerk/nextjs` v7.3.3 on first `pnpm dev`. Fallback is `SignedIn` / `SignedOut` components.
6. **`/join/[token]` `redirect_url`-via-Clerk-sign-in** — manual smoke during Pre-flight to confirm Clerk honors the redirect param against the configured JWT template.

### Cosmetic (left as-is)

- `src/app/household/settings/page.tsx:74` double-cast on joined profile (deviation 3 — `Relationships: []` is intentional).
- Zod errors surface raw on bad-form-data tampering — friendly UX deferred.
- `redeem_invite` returns the inserted membership row; action discards it. Could be useful for a success page later.
- `updated_at` triggers exist on `household_memberships` but not on `households` / `invites` — consider standardizing if cache-invalidation becomes load-bearing.

### Open

1. **Verification gate.** On a node-capable host: `pnpm install && pnpm exec playwright install chromium && pnpm db:start && pnpm db:reset && pnpm typecheck && pnpm test && pnpm test:e2e`. Expected: 28 vitest pass (no new vitest tests this round) + 3 Playwright smoke pass + typecheck clean. The 4 commits ahead of `48990e1` (`7024cca`, `9b777a3`, `3eaa6d7`, plus this HANDOFF update) all need to pass before push. **The review fixes touched `redeemInvite`, `revokeInvite`, `getCurrentProfile`, and `env-sync` — re-run the DB tests in `tests/db/invites.test.ts`, `tests/actions/invites.test.ts`, and `tests/admin/env-sync.test.ts` specifically.**
2. **Pre-flight A–E** (manual, in dashboards) — gates the first real `pnpm dev` against live Clerk + cloud Supabase:
   - A: Create a Supabase project (Singapore region)
   - B: Create a Clerk JWT template named `supabase`
   - C: Register Clerk as a third-party auth provider in Supabase
   - D: Create Clerk webhook endpoint pointing at `/api/webhooks/clerk`
   - E: Fill `.env.local` from `.env.local.example`. **Also add the two missing entries from "Deferred from review" #2 above.**
   See [docs/plans/2026-05-10-foundations.md](plans/2026-05-10-foundations.md) "Pre-flight" section for the step-by-step.
3. **Manual end-to-end walk-through** — the 6-step checklist at the end of Task 18 in the plan (owner-led onboarding, maid-led onboarding, family invite + redeem, maid removal, family self-leave, privilege toggle). The `redeemInvite` fix means flows #3 and #4 will exercise the JWT-bearing RPC path that was previously broken; flow #2 will exercise the new dashboard-side pending-invite query path.
4. **Push** once verification passes: `git push origin main`.
5. **Final review of the slice + `superpowers:finishing-a-development-branch`** if anything else surfaces during verification or the manual walk-through.

## Deviations from the plan worth knowing

The plan in [docs/plans/2026-05-10-foundations.md](plans/2026-05-10-foundations.md) is the original specification. Several implementation details diverged from it during execution. The code/migrations are the source of truth; if the plan and the code disagree, trust the code. The notable divergences:

1. **Vitest config** — Vitest 4 removed `poolOptions: { forks: { singleFork: true } }`. We use `pool: "forks"` + `fileParallelism: false` instead. Each test file gets its own fork process; files run serially. The pg singleton in `tests/setup.ts` opens/closes once per file (not once per suite). Documented in code comment.
2. **Migration filenames** — Supabase CLI's version key is the leading digit sequence before the first `_`. The plan's `YYYYMMDD_NNN_<name>.sql` pattern collides. We use **one date prefix per migration**: `20260510_001_profiles.sql`, `20260511_001_households.sql`, `20260512_001_household_memberships.sql`, `20260513_001_invites.sql`, `20260514_001_redeem_invite_rpc.sql`, `20260515_001_admin_trigger_fix.sql`. Future migrations should continue this pattern (e.g., `20260516_001_<name>.sql`).
3. **Database types** — every `Tables` entry has `Relationships: []`; the schema has `Views: {}`. Required by current `@supabase/supabase-js` types. Future tables must follow this shape.
4. **`current_profile_id()` and `current_is_admin()` are `security definer`** (not `security invoker` as the plan said). Required to break RLS recursion. All `security definer` helpers have `set search_path = public` per Postgres best practice.
5. **Two extra helpers in migration 003** — `has_active_membership(p_household)` and `is_active_owner(p_household)` (both `security definer`). RLS policies on memberships, households (read/update), and invites use these helpers to avoid recursion through `household_memberships`.
6. **`hm_self_read` policy** — added so a user can read their own membership row even after `status='removed'`. Required for the self-leave flow to render correctly.
7. **`invites_active_code_idx`** — the plan said `where consumed_at is null and expires_at > now()`. Postgres rejects `now()` in partial-index predicates (not immutable). The index is `where consumed_at is null`; expiry is still enforced inside `redeem_invite` at runtime.
8. **`invites_household_eligible_read` policy** — uses the broader `has_active_membership` helper (any active member can read). Application-layer `createInvite` enforces the narrower owner-or-maid role rule.
9. **Households read/update RLS** — defined in migration `20260512_001_household_memberships.sql` (not in 002), because they reference `household_memberships`. Plan was updated mid-flight to reflect this.
10. **`profiles_block_protected_columns` trigger** — only enforces is_admin protection when there's an authenticated end-user (`auth.jwt() ->> 'sub' is not null`). Service-role calls (no JWT, used by `syncAdminFlags`) pass through. Test verifies both paths.
11. **Zod was missing** — installed `zod@4.4.3` during Task 10. `z.email()` and `z.uuid()` exist in v4, no fallback needed.

## Repo layout

- `docs/specs/2026-05-10-foundations-design.md` — the design we brainstormed
- `docs/plans/2026-05-10-foundations.md` — the implementation plan (19 tasks)
- `docs/HANDOFF.md` — this doc
- `supabase/migrations/` — 6 migrations applied in filename order
- `src/lib/auth/` — `current-profile.ts`, `current-household.ts`, `require.ts`
- `src/lib/supabase/` — `client.ts`, `server.ts`
- `src/lib/db/types.ts` — hand-curated `Database` type
- `src/lib/admin/env-sync.ts` — `ZOMAID_ADMIN_CLERK_USER_IDS` → `is_admin` sync
- `src/app/onboarding/` — chooser, maid form, owner form, actions
- `src/app/household/settings/` — members + invites UI + actions
- `src/app/join/` — `[token]/` auto-redeem, `code/` entry
- `src/app/api/webhooks/clerk/route.ts` — Clerk user sync
- `src/proxy.ts` — Next 16 middleware (renamed from middleware.ts)
- `src/instrumentation.ts` — boot-time admin sync
- `tests/db/` — RLS + DB-invariant tests (4 files, 18 tests)
- `tests/actions/` — server-action invariant tests (3 files, 5 tests)
- `tests/auth/` — privilege ordering (1 file, 3 tests)
- `tests/admin/` — env-sync (1 file, 2 tests)

## Decisions still load-bearing

These came out of brainstorming and shape every subsequent slice; capture in case the wife asks why:

- **1 maid : 1 household** at a time
- **Family members are individual user accounts**, each invited
- **Either-first onboarding** — maid or owner can create a household
- **Invite link + 6-digit code** is the only join mechanism
- **Singapore-only v1** (SGD, en-SG, Asia/Singapore)
- **Schema supports multi-household membership; UI is single-household for v1**
- **Single global admin** via `ZOMAID_ADMIN_CLERK_USER_IDS` env var
- **Clerk + Supabase native third-party auth + RLS** is the security boundary
- **Stay on `main`** (no feature branch); commit directly. User explicitly chose this.

## Skill recommendations for resuming

- **First thing on the next node-capable session:** run the verification gate (`Open` #1). Until it passes, treat the 3 unverified commits as suspect.
- After verification passes: `/superpowers:finishing-a-development-branch` to close out the slice.
- Then add the deferred server-action tests (`Deferred from review` #1) — they would have caught Critical #1 from this round.
- After foundations ships, **slice 2 (Recipes + meal planning)** is the next brainstorming target — would invoke `/superpowers:brainstorming`.
