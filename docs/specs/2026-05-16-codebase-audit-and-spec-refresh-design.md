# Codebase audit + per-feature spec refresh — design

**Date:** 2026-05-16
**Status:** Approved (awaiting implementation plan)
**Scope:** Documentation + conservative dead-code removal only. No behavior changes, no DB migrations, no new tests written.

## Goal

The codebase was built in slices and rapid iterations (foundations → recipes/meal plan → shopping → bill scanning → tasks → inventory → diet preferences → task setup gates → household meal preference → home unification). Several artefacts have accumulated:

- **Spec drift:** 25 dated slice specs in `docs/specs/` describe what was built at that point in time, not what's in the code now. Multiple specs cover the same feature area (e.g. three diet-related specs).
- **Possible dead code:** unimported files, unused exports, stale shadcn primitives, dead helpers from features that were merged or renamed (plan→home, recipes→meal, scan-receipt+upload-bill merged into a single Scan tab).
- **Test coverage unclear:** tests were explicitly deferred for several slices ("we'll come back to tests"). No single artefact lists which server actions / RPCs / flows are covered vs. missing.

This work produces three things, in order:

1. One **architecture-only spec per feature**, replacing the dated slice specs as the source of truth.
2. A **test coverage punch list** per feature, identifying gaps without writing the tests.
3. A **conservative dead-code cleanup**, taking only the obvious safe removals and flagging the rest for later decisions.

## Non-goals

- Writing any new production-code tests (Phase 2 produces a punch list only).
- Dropping DB columns, tables, or RPCs (flagged in specs as "appears unused"; new "drop" migrations are out of scope).
- Removing `package.json` dependencies (out of scope).
- Removing half-built routes without confirmation (flagged "status: unclear" and surfaced to user).
- Touching `CLAUDE.md`, `AGENTS.md`, or `docs/HANDOFF.md`. Those are slice-era history; new feature specs supplement them.
- Modifying any product behavior.

## Phases (sequential)

### Phase 1 — Per-feature architecture specs

**Output:** one `docs/specs/features/<feature>.md` per feature (11 files total).

**Feature list:**

| # | File | Covers (routes / area) |
|---|---|---|
| 1 | `dashboard.md` | `/dashboard` only — home page composition, household-mode card, task-setup prompt, dashboard chips. Cards that link into other features reference the relevant feature spec rather than re-describing it. |
| 2 | `recipes.md` | `/recipes`, `/recipes/new`, `/recipes/[id]`, `/recipes/[id]/edit`, fork-on-edit, starter pack, photos, video URL, nutrition. |
| 3 | `meal-plan.md` | `/plan`, `/plan/[date]`, slot assignment, autofill cron, regenerate, family read-only, null-recipe cleanup. |
| 4 | `shopping.md` | `/shopping`, items + bought history, auto-add from plans, typeahead aliases, bought-immutable rule. |
| 5 | `inventory.md` | `/inventory`, `/inventory/[id]`, `/inventory/new`, `/inventory/conversions`, sweep cron, cook-deduct, onboarding parse, manual adjust, custom rows. |
| 6 | `bills.md` | `/bills/[id]`, bill rows + line items, line item → inventory link, dedupe, retry queue. |
| 7 | `scans.md` | `/scans/pending`, merged scan-receipt + upload-bill flow, OCR ingest pipeline. |
| 8 | `tasks.md` | `/tasks`, `/tasks/[date]`, `/tasks/new`, `/tasks/edit`, occurrences, standard tasks, generation cron, day grouping, setup gates, member insert. |
| 9 | `household.md` | `/household/settings`, `/household/meal-times`, members/invites, email invites, diet preferences (member-level + household-level override). |
| 10 | `onboarding.md` | `/onboarding`, `/onboarding/maid`, `/onboarding/owner`, `/onboarding/tasks` task-setup wizard (stage 1 picker + stage 2 tuner). |
| 11 | `infrastructure.md` | Clerk auth, Supabase client/server/service, `proxy.ts`, sign-in/sign-up, join routes, webhooks (`/api/webhooks/clerk`), cron, web-push, admin tools (`/admin/bill-scans`, `/admin/tasks`). |

**Spec format** (architecture-only; no behavior/UX copy, no test detail in this phase):

```markdown
# <Feature> — architecture

**Status:** active | partial | unclear (per-feature judgment; ask user when unclear)
**Last reviewed:** YYYY-MM-DD

## Routes
| Route | File | Type (page / server action file / api) |

## Server actions
| Action | File | Input shape | Output shape | Called by (routes/components) |

## Components
| Component | File | Used by (routes) |

## DB surface
| Object | Kind (table / RPC / cron job / storage bucket / enum) | Introduced in (migration file) | Notes |

## External integrations
- (e.g. Clerk JWT forwarding, Supabase storage bucket name, Anthropic model used, web-push subscription endpoint, etc.)

## Open questions
- (Anything that needs a user decision. Pulled from inline comments, HANDOFF.md, or surfaced during the audit.)

## Test coverage
_To be filled in Phase 2._
```

**Banner on old specs:** after each feature spec is written, every related dated spec in `docs/specs/` gets a one-line banner inserted at the top:

```markdown
> **Superseded as living documentation by [`features/<feature>.md`](features/<feature>.md).** This dated spec is retained for historical context.
```

Multiple old specs may point to the same new feature spec (e.g. all three diet specs point to `features/household.md`).

**Half-built routes:** if I find code that may have been superseded (e.g. `/onboarding/tasks` after the task-setup wizard), I set `Status: unclear` in the new spec and surface a question to the user before continuing. No deletion in Phase 1.

### Phase 2 — Test coverage gap analysis

**Output:** appended `## Test coverage` section in each `docs/specs/features/<feature>.md`.

**Format:**

| Code unit | File | Unit test | Integration test | E2E | Priority gap | Recommended test type |

Where:
- **Code unit** = one server action, RPC, pure function, or user-facing flow.
- **Unit test / Integration test / E2E** = path to existing test file, or `—`.
- **Priority gap** =
  - `high` — data-loss path or revenue-affecting mutation with no coverage at any level
  - `medium` — user-visible mutation with no coverage
  - `low` — idempotent read or rarely-touched path
  - `none` — covered adequately
- **Recommended test type** — follows existing layout:
  - Server actions → `tests/actions/` (vitest)
  - RPCs and DB helpers → `tests/db/` (vitest with pg client)
  - Pure functions (parsers, dedupers, scorers) → `tests/unit/` (vitest)
  - User flows → `tests/e2e/` (playwright)

**No tests are written in this phase.** The output is a punch list the user can prioritise later.

### Phase 3 — Conservative dead-code cleanup

**Scope (only the obvious):**
- `.ts`/`.tsx` files in `src/` with zero importers anywhere (verified by `grep`, not only by tooling).
- Exported symbols with zero importers (verified manually after tooling surfaces candidates).
- shadcn primitives in `src/components/ui/` not referenced anywhere.
- Helpers in `src/lib/` with zero callers.

**Explicitly out of scope** (flagged in feature specs' Open Questions, not touched):
- DB column / table / RPC drops (require new migrations — separate decision).
- Half-built or superseded routes (require user judgment per `status: unclear`).
- `package.json` dependency removals.
- Reorganising file layout.

**Tooling and process:**
1. Run `npx knip` (or `ts-prune`) to get a candidate list.
2. For each candidate, manually `grep` the repo (src, tests, public, supabase, docs/HANDOFF.md) to confirm zero references.
3. Group removals by area; one `chore(cleanup): <what>` commit per removable unit so each is individually revertable.
4. Run `pnpm typecheck && pnpm test && pnpm test:e2e` after each batch; if any check fails, revert that batch.

### Review cadence

- **Phase 1:** all 11 feature specs written in one pass, then handed off for user review as a batch.
- **Phase 2:** same — all 11 `## Test coverage` sections added, then batched for review.
- **Phase 3:** removals batched into reviewable commits; each commit small enough to verify by reading the diff.

Within each phase, work proceeds feature-by-feature but only ships the full batch for review.

## Dependencies and assumptions

- The 11-feature decomposition reflects the current top-level app routes. If new features are added or routes restructured mid-flight, the spec list will need refreshing.
- "Conservative" cleanup may leave dead code in place where the case isn't airtight. That's intentional — a follow-up "aggressive cleanup" pass can run later with broader licence.
- Existing test layout (`tests/actions`, `tests/db`, `tests/unit`, `tests/e2e`) is treated as the standard; recommendations in Phase 2 follow it.
- `docs/HANDOFF.md` and the dated specs are not edited beyond the one-line banner — they remain available as historical context.

## Acceptance criteria

- 11 files exist under `docs/specs/features/` with the architecture-only format populated for all sections (Phase 1).
- Each related dated spec in `docs/specs/` has a banner pointing to its new feature spec (Phase 1).
- Each feature spec has a populated `## Test coverage` section with the gap-analysis table (Phase 2).
- A list of dead-code removals is committed as individual `chore(cleanup): …` commits (Phase 3).
- `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` all pass after Phase 3.
- No production-code behavior changes; no new migrations; no new tests.
