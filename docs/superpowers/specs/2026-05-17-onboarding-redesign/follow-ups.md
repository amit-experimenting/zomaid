# Follow-ups — onboarding redesign

Standing record of work that was **deliberately deferred** during the 2026-05-17 onboarding-redesign brainstorm. Each item is a candidate future spec. When picking one up, brainstorm it fresh — the notes here are seeds, not decisions.

> **Why this file exists:** the parent spec ([../2026-05-17-onboarding-redesign.md](../2026-05-17-onboarding-redesign.md)) is intentionally bounded. This file holds everything we explicitly chose *not* to do, so nothing falls on the floor.

---

## Tune step in onboarding

Dropped in favor of seed defaults. The migration assigns every standard task a sensible default time + day; the user can override per-task later via the existing `/tasks/edit/[id]` page. If onboarding feedback shows users want batch-time adjustment up front, revisit:

- A 3rd onboarding page that lets the user shift their picked daily tasks ±1-2 hours as a group (morning person vs evening person).
- Or a per-section "Set my morning time" / "Set my evening time" control on the picker itself.

---

## AI-generated task suggestions ("d" from Q1 of the brainstorm)

Option (d) from the questionnaire-effect decision. Use the profile + a small LLM to propose tasks beyond the standard ~95 set. Example: "4-bedroom + senior citizen → also: weekly safety check, pill organizer refill."

Seeds for the brainstorm:
- Generation strategy: per-onboarding (one-shot suggestion) vs ongoing ("we noticed you haven't logged X; want to add it?").
- Review-before-accept flow — never auto-add LLM output to the user's task list.
- Cost model: per-household generation budget; suggestions cached.
- Eval gates: filter out generic/dangerous suggestions before showing.
- Internationalization implications when slice D lands.

Defer until the standard ~95 library has been in users' hands and pain points around "missing tasks" emerge.

---

## "Something else" freeform inputs

Original mockups (from the brainstorm) showed a "Something else" pencil-icon row on each question, allowing custom freeform answers. V1 ships with closed enums only — fewer edge cases, predictable filtering.

When picking up:
- Schema: add nullable `*_freeform text` columns to `household_profiles`, OR introduce `household_profile_freeform_answers(household_id, question_key, value text)` join table.
- Filtering: freeform answers don't map to relevance tags by definition — they're metadata-only.
- Surfacing: if a household reports custom data, where does it show up? Settings page? Banner on dashboard for the maid?
- Privacy: freeform may contain personal info; review treatment for shared visibility between owner + maid.

---

## Multi-time-per-day task rollup

V1 seeds each multi-time daily task as separate rows (e.g., 3 "Wipe kitchen counters and stove — morning/afternoon/evening" rows). Works with the current schema but creates duplicated-feeling list entries.

Future micro-spec could extend `tasks` schema:
- `due_times time[]` array column, OR
- A `task_occurrences_template(task_id, time)` rollup table.

Either way the picker and tune UI would need to handle "this task fires N times daily" gracefully. Worth doing before users complain about list bloat.

---

## Additional questionnaire fields (household type, # bedrooms, # bathrooms, # members)

Original user mockup proposed 8 questions; we dropped 4 (household type, # members, # bedrooms, # bathrooms) during Q6 because they didn't filter the new library meaningfully. Storage-only metadata.

When picking up:
- These can be added to `household_profiles` as nullable columns and surfaced as "Optional household details" in `/household/settings`.
- Future use cases: persona-tailored dashboard suggestions (slice B), quantity multipliers (e.g., # bedsheets per wash), AI suggestion context (the more profile data, the better the suggestions).
- No UI required during onboarding — settings-page additions only.

---

## Persona-tailored maid dashboard (slice B from design-system follow-ups)

This onboarding spec partially closes the "maid sees empty home" friction by:
- Empowering the maid to drive task setup herself (D3 + D4 chose either-role).
- Replacing the "Tasks coming soon" waiting banner with the active prompt cards.

But it doesn't address the underlying persona-tailored design need. When slice B is brainstormed, expect to also revisit:
- Whether the maid's dashboard should default to a different layout/density than the owner's.
- Whether profile answers should drive what the maid sees first ("today's morning routine" if she works dawn-to-dusk).
- Voice/photo-first inputs for task completion (referenced in the design-system follow-ups).

---

## Concurrent-edit conflict resolution

D4 chose "either-role can drive task setup" but explicitly deferred ongoing equal edit rights. V1 is last-write-wins on the `household_profiles` row, the picker draft, and individual tasks. Acceptable for a small household where the two users coordinate verbally.

When picking up:
- Audit trail (who changed which task, when, why).
- Realtime sync on the picker (if both are filling it simultaneously).
- Conflict-resolution UI for the questionnaire (rare but possible: both edit the profile at the same time).
- Settings: "Lock task editing to one role" if owner wants ultimate control.

Spec this when household sizes grow or when multi-user friction reports come in.

---

## i18n / translated profile + task content

Already tracked under slice D of the design-system follow-ups. When that lands, this spec's content (questionnaire question/option text + 95 task titles + meta lines) needs to flow through the i18n catalog. Specifically:

- Profile question wording (5 questions × multiple options each ≈ 30 strings).
- Task titles + "morning/afternoon/evening" suffixes (~95 task names).
- Tag-pill labels (`school`, `pet`, `feature`, `age` — 4 strings).
- Dashboard prompt card titles + body text.
- Edit-mode submit toast.

Total: ~140 strings to translate per locale. Slice D's tooling handles extraction.

---

## finalizePicksAction CAS + rollback test coverage

When `tests/actions/task-setup-wizard.test.ts` was deleted during Phase 7 implementation (its tested old action functions `saveTaskSetupPicks` and `submitTaskSetup` were removed), it took with it the only test coverage for the CAS-claim, rollback-on-insert-failure, and lost-race scenarios for the picker's finalize action.

The new `finalizePicksAction` (in `src/app/onboarding/tasks/actions.ts`) carries similar logic that's now uncovered:
- CAS claim on `households.task_setup_completed_at` (set to `now()` only if currently NULL).
- Rollback if the bulk-insert of household tasks fails partway.
- Lost-race no-op path (if another writer claimed the CAS first, this writer doesn't double-insert).
- `household_task_hides` upsert for standard tasks not picked.
- `tasks_generate_occurrences` trigger.

Indirect coverage exists via `tests/db/household-profiles.test.ts` and `tests/db/task-relevance-filter.test.ts` (DB layer), but the application-action edge cases listed above are unverified.

**When picking up:** create `tests/actions/finalize-picks.test.ts` that ports the CAS / rollback / lost-race / hide-upsert scenarios from the deleted wizard suite, adapted to the new function signature `finalizePicksAction(picks: string[])`.

Why deferred: not blocking for merge — the logic exists, just untested. Risk is regression-on-future-edit rather than current correctness.
