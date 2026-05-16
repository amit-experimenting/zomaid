# Household — architecture

**Status:** active
**Last reviewed:** 2026-05-16

This spec covers the household **configuration UI** — the settings page, meal-times page, members & invites surface (including email-whitelist invites), per-member diet preferences, the household-level diet override, and the household-mode (`maid_mode`) write surface. The foundational household data model — `households`, `household_memberships`, `invites`, `redeem_invite`, and the related RLS helpers (`has_active_membership`, `is_active_owner`, `is_active_owner_or_maid`) — lives in `infrastructure.md`. Cross-feature touch-points are noted as boundaries.

## Routes
| Route | File | Type |
| --- | --- | --- |
| `/household/settings` | `src/app/household/settings/page.tsx` | page |
| `/household/settings` (loading skeleton) | `src/app/household/settings/loading.tsx` | loading |
| `/household/settings` (server actions) | `src/app/household/settings/actions.ts` | server-actions |
| `/household/meal-times` | `src/app/household/meal-times/page.tsx` | page |
| `/household/meal-times` (server actions) | `src/app/household/meal-times/actions.ts` | server-actions |
| `/join/[token]` | `src/app/join/[token]/page.tsx` | page — thin redirect shim that calls `redeemInvite` from this feature, then redirects to `/dashboard` |
| `/join/code` | `src/app/join/code/page.tsx` | page — 6-digit code entry that calls `redeemInvite`, then revalidates `/dashboard` |

`/join/[token]` and `/join/code` are listed here because both consume `redeemInvite` (a server action exported from `src/app/household/settings/actions.ts`). They are otherwise standalone landing pages — the redemption itself is the household-feature contract; the join URLs are just the public entry points.

## Server actions
| Action | File | Input shape | Output shape | Called by |
| --- | --- | --- | --- | --- |
| `createInvite` | `src/app/household/settings/actions.ts:20` | `{ role: 'owner'\|'family_member'\|'maid', privilege?: 'full'\|'meal_modify'\|'view_only', email?: '' \| <trimmed lowercased email> }` (Zod). Empty-string email is normalised to `null`; intended_privilege defaults to `view_only` for family_member, `'full'` otherwise. | `{ code: string (6 digits), token: string (base64url, 32 random bytes) }` | `src/app/household/settings/page.tsx` (`inviteFamily` / `inviteMaid` / `inviteOwner` form wrappers); `src/app/dashboard/actions.ts:inviteMaidFromHome` (owned by `features/dashboard.md`). |
| `revokeInvite` | `src/app/household/settings/actions.ts:111` | `{ inviteId: uuid }` (Zod) | `void` (throws on error) | `src/app/dashboard/actions.ts:revokeMaidInviteFromHome` (owned by `features/dashboard.md`). _No direct caller from the settings page — invites are listed but not revoked from there in v1; see Open questions._ |
| `redeemInvite` | `src/app/household/settings/actions.ts:145` | `{ tokenOrCode: string (1–200) }` (Zod). 6-digit codes are resolved to a token via `invites` lookup; otherwise treated as a token. | `void` — `redirect('/dashboard')` on success, throws otherwise. | `src/app/join/[token]/page.tsx`, `src/app/join/code/page.tsx`. |
| `removeMembership` | `src/app/household/settings/actions.ts:181` | `{ membershipId: uuid }` (Zod) | `void` (throws on error) | `src/app/household/settings/page.tsx` (`remove` form wrapper — used for both owner-driven removals and self-leave). |
| `updateMembershipDiet` | `src/app/household/settings/actions.ts:228` | `{ membershipId: uuid, diet?: '' \| 'none' \| 'vegan' \| 'vegetarian' \| 'eggitarian' \| 'non_vegetarian' }` (Zod). Empty string and `'none'` are normalised to `null`. | `void` (throws on error) | `src/app/household/settings/page.tsx` (`changeDiet` form wrapper). |
| `updateMembershipPrivilege` | `src/app/household/settings/actions.ts:265` | `{ membershipId: uuid, privilege: 'full' \| 'meal_modify' \| 'view_only' }` (Zod) | `void` (throws on error) | `src/app/household/settings/page.tsx` (`changePriv` form wrapper). |
| `updateHouseholdDiet` | `src/app/household/settings/actions.ts:300` | `{ diet?: '' \| 'vegan' \| 'vegetarian' \| 'eggitarian' \| 'non_vegetarian' }` (Zod). Empty string is normalised to `null` (clears the override). | `void` (throws on error) | `src/app/household/settings/page.tsx` (`changeHouseholdDiet` form wrapper via `HouseholdDietForm`). |
| `updateMealTime` | `src/app/household/meal-times/actions.ts:20` | `{ slot: 'breakfast'\|'lunch'\|'snacks'\|'dinner', meal_time: 'HH:MM' or 'HH:MM:SS' }` (Zod) | `MealTimeActionResult<{ slot, meal_time }>` — discriminated `ok` union with error codes `MT_INVALID`, `MT_DB`. _Only action in this feature that returns a discriminated result; all settings actions throw._ | `src/app/household/meal-times/page.tsx` (`save` form wrapper). |

Authorization invariants enforced in-action (in addition to the per-table RLS that infrastructure.md owns):
- `createInvite`: only the maid can invite an owner; only an owner can invite a family_member or a maid. Maid invites also fail-fast if the household already has an active maid and flip `households.maid_mode = 'invited'` (the only path other than the dashboard's `inviteMaidFromHome` to write `maid_mode`). Owner invites fail-fast if the household already has an active owner. Whitelist email is duplicate-checked per `(household, lower(email))` for unconsumed-unexpired invites before the insert, turning the partial unique index into a clean named error instead of a 23505.
- `revokeInvite`: owner of the household OR the original inviter. Marks `consumed_at = now()` (not expired) so the partial unique index on `(code) where consumed_at is null` releases the slot.
- `redeemInvite`: short-circuits with `redirect('/dashboard')` if the caller is already in a household (v1 cannot hold two memberships). Uses the RLS-scoped client so the underlying `redeem_invite` RPC sees the caller's Clerk JWT.
- `removeMembership`: owner OR self-leave only. Owner cannot self-leave in v1 (would orphan the household) — throws `an owner cannot self-leave; transfer ownership first (not in v1)`.
- `updateMembershipDiet`: owner, maid, or self.
- `updateMembershipPrivilege`: owner only; rejected unless the target row is `role='family_member'`.
- `updateHouseholdDiet`: owner or maid only.
- `updateMealTime`: any active member (RLS-side — `has_active_membership`). The action only checks `requireHousehold()`.

Revalidation:
- `createInvite` revalidates `/household/settings` and `/dashboard`.
- `revokeInvite` revalidates `/household/settings` and `/dashboard`.
- `redeemInvite` does **not** call `revalidatePath` (it's invoked from `/join/[token]` during page render, where `revalidatePath` is disallowed); the caller (`/join/code/page.tsx`) wraps the call in its own `revalidatePath('/dashboard')`.
- `removeMembership` revalidates `/household/settings` and `/dashboard`.
- `updateMembershipDiet` revalidates `/household/settings`, `/dashboard`, `/recipes`.
- `updateMembershipPrivilege` revalidates `/household/settings`.
- `updateHouseholdDiet` revalidates `/household/settings`, `/dashboard`, `/recipes`.
- `updateMealTime` revalidates `/household/meal-times`, `/dashboard`, and `/recipes`.

Email-whitelist auto-redemption side channel: `getCurrentHousehold` (in `src/lib/auth/current-household.ts`) calls `tryRedeemPendingEmailInvite(profile.email)` (in `src/lib/auth/redeem-email-invite.ts`) when the caller has **no** active membership. That helper finds the most-recent unconsumed-unexpired invite whose `intended_email` matches the caller's profile email (case-insensitive), then calls the `redeem_invite(token)` RPC under the caller's JWT. The helper swallows errors — a failed auto-redeem is silent and the user falls through to the normal "you have no household" flow. This is owned by the household feature because the email-whitelist column (`invites.intended_email`) and its UI affordance (the optional email input on each invite form) are part of the settings page; the helper is just the side-channel that closes the loop on the user's first authenticated request.

## Components
| Component | File | Used by |
| --- | --- | --- |
| `HouseholdSettingsPage` (default) | `src/app/household/settings/page.tsx` | Next.js route `/household/settings` |
| `HouseholdSettingsLoading` (default) | `src/app/household/settings/loading.tsx` | Next.js suspense for `/household/settings` |
| `MealTimesPage` (default) | `src/app/household/meal-times/page.tsx` | Next.js route `/household/meal-times` |
| `HouseholdDietForm` | `src/components/household/household-diet-form.tsx` | `src/app/household/settings/page.tsx` (Meal preference card). Client component — keeps the unsaved-vs-saved state, computes member-implied strictness (mirrors `household_effective_diet`), and shows a `window.confirm` warning listing the (up to 3) members who would lose recipe visibility when the chosen override is strictly stricter than at least one member's own preference; submits via the page-supplied `changeHouseholdDiet` server-action wrapper. The Save button is disabled when the chosen value equals the current value. |
| `MainNav` | `src/components/site/main-nav.tsx` | `HouseholdSettingsPage`, `HouseholdSettingsLoading`, `MealTimesPage`. The nav's Home tab links to `/dashboard`, and the settings entry-point is `<Link href="/household/settings">` rendered from `MainNav`. Shared site chrome. |
| `NotificationToggle` | `src/components/tasks/notification-toggle.tsx` | `HouseholdSettingsPage` (Notifications card, owner+maid only). Owned by `features/tasks.md` — mounted here as the only consumer; see Boundary note. |
| `Card`, `CardContent`, `CardHeader`, `CardTitle`, `Input`, `Label`, `PendingButton`, `Button` | `src/components/ui/*` | `HouseholdSettingsPage`, `MealTimesPage`. Generic UI primitives. |

`HouseholdSettingsPage` is a single large server component that renders four cards: **Notifications** (owner+maid only, mounts `NotificationToggle`), **Meal preference** (mounts `HouseholdDietForm` for owner+maid, plain text for family_members and view-only callers), **Members** (per-member diet select for owner/maid/self, per-family-member privilege select for owners, Remove/Leave button gated by role), and **Invites** (per-role invite forms: family-member invite + maid invite for owners; owner invite for the maid; plus the active-invites list with the join URL + code shown verbatim). Each form submits to a small `'use server'` wrapper that re-shapes `FormData` into the typed action input.

`MealTimesPage` is a thin server component that lists four `<form>`s (one per slot) with a `type="time"` input and a Save button, each posting to a `'use server'` `save` wrapper that calls `updateMealTime`. There is no client component for meal times — `Button` is `PendingButton`'s underlying primitive but used here without pending-state because each form posts independently.

Cross-feature mounts and links:
- `HouseholdModeCard` (`src/components/site/household-mode-card.tsx`, owned by `features/dashboard.md`) calls `setHouseholdFamilyRun` and `inviteMaidFromHome` — both write `households.maid_mode` and the latter is a thin wrapper around this feature's `createInvite`. The household-mode write surface is split: the dashboard owns the card and the two dashboard-side actions; this feature owns the `maid_mode` flip inside `createInvite` (the only other writer) and the underlying `households.maid_mode` schema is documented in `features/onboarding.md` (which wrote the migration) and re-described from each consumer's angle.
- The "Meal preference" chip on `/dashboard` (`features/dashboard.md`) links to `/household/settings#diet` (no anchor target in the current page — see Open questions).
- `MainNav` links Home → `/dashboard`; the settings entry is reachable from the Home tab's overflow / profile menu (current implementation links directly to `/household/settings`).

## DB surface
| Object | Kind | Introduced in | Notes |
| --- | --- | --- | --- |
| `households` | table | `20260511_001_households.sql` | **Owned by `infrastructure.md`.** This feature reads `id`, `name`, `diet_preference`, `maid_mode` via `requireHousehold` context; writes `diet_preference` (via `updateHouseholdDiet`) and `maid_mode` (via the maid-invite branch of `createInvite`, which flips `unset` → `invited`). The seed trigger `households_seed_meal_times` (added by `20260609_001`) populates `household_meal_times` on insert. |
| `households.diet_preference` | column | `20260706_001_household_diet_preference.sql` | **Owned here.** Nullable `public.diet`. When non-null, overrides every member's personal preference for recipe filtering (via `household_effective_diet`); when null, the helper falls back to strictest non-maid active member. Set by `updateHouseholdDiet`; read by `HouseholdSettingsPage`, `HouseholdDietForm`, and the dashboard `dietChip`. |
| `households.maid_mode` | column | `20260705_001_household_setup_gates.sql` | **Write surface co-owned with `features/dashboard.md`.** Enum `public.maid_mode` (`unset`, `invited`, `family_run`), `NOT NULL DEFAULT 'unset'`. Flipped to `'invited'` by (a) the `household_memberships_sync_maid_mode` trigger on maid-join (owned by `features/onboarding.md`), (b) this feature's `createInvite` when issuing a maid invite, (c) the dashboard's `inviteMaidFromHome`. Flipped to `'family_run'` only by the dashboard's `setHouseholdFamilyRun`. Read by `/onboarding/tasks` to gate which wizard step shows, by `/dashboard` to gate the household-mode card vs the invite-maid card, and by this page's invite forms (only the owner can issue a maid invite; the maid-already-active check happens against `household_memberships`, not `maid_mode`). |
| `household_memberships` | table | `20260512_001_household_memberships.sql` (extended by `20260624_001_diet_preferences.sql`) | **Owned by `infrastructure.md`.** This feature reads `id, role, privilege, status, diet_preference, profile:profiles(id, display_name, email)` for active members; writes `diet_preference` (via `updateMembershipDiet`), `privilege` (via `updateMembershipPrivilege`), and `status = 'removed' / removed_at = now()` (via `removeMembership`). The active-maid uniqueness and active-owner uniqueness are enforced by partial unique indexes (`hm_unique_active_maid`, `hm_unique_active_owner`); this feature's `createInvite` pre-checks both to surface a clean error instead of a 23505. |
| `household_memberships.diet_preference` | column | `20260624_001_diet_preferences.sql` | **Owned here.** Nullable `public.diet`. Per-member personal preference, set by `updateMembershipDiet`. Maid members may set it (UI allows the row's diet select), but `household_effective_diet` ignores maid rows in the strictest-fallback path. |
| `diet` | enum | `20260624_001_diet_preferences.sql` | **Owned by `infrastructure.md`** (the enum + the strictness ordering used by `household_effective_diet`). Values: `vegan`, `vegetarian`, `eggitarian`, `non_vegetarian`. Listed here because every settings-UI control over diet (per-member select, household override select) emits this enum's string values. The UI's `'none'` and `''` sentinels are normalised to SQL `NULL` by the actions. |
| `invites` | table | `20260513_001_invites.sql` (extended by `20260623_001_invite_emails.sql`) | **Owned by `infrastructure.md`.** This feature reads `id, intended_role, intended_privilege, intended_email, code, token, expires_at, consumed_at` (active, unexpired) to populate the settings invites card. Writes via `createInvite` (insert) and `revokeInvite` (set `consumed_at`). The `invites_active_email_per_household_idx` partial unique index (one unconsumed invite per `(household, lower(email))`) is added by `20260623_001` and is the index `createInvite` pre-checks before insert. |
| `invites.intended_email` | column | `20260623_001_invite_emails.sql` | **Owned here.** Optional email-whitelist; when set, drives `tryRedeemPendingEmailInvite` (see Server actions). Length-checked 3–254; lowercased and trimmed by the Zod schema before insert. |
| `redeem_invite(p_token text)` | RPC | `20260514_001_redeem_invite_rpc.sql` (extended by `20260516_001_redeem_invite_duplicate_check.sql`) | **Owned by `infrastructure.md`** (the RPC, its capacity checks, and its duplicate-membership pre-check are all foundational invite semantics). Called by this feature's `redeemInvite` action (via the RLS-scoped client so `auth.jwt()` resolves) and by `tryRedeemPendingEmailInvite`. Error-code contract: `P0001` profile missing, `P0002` invite not found, `P0003` already consumed, `P0004` expired, `P0005` already-has-maid, `P0006` already-has-owner, `P0007` caller already a member of this household. |
| `household_effective_diet(p_household uuid) → public.diet` | RPC | `20260706_001_household_diet_preference.sql` | **Owned here.** `security definer`, stable. Returns `coalesce(households.diet_preference, strictest non-maid active member's diet_preference, 'non_vegetarian')`. The fallback ranking treats `vegan > vegetarian > eggitarian > non_vegetarian`. Called by `effective_recipes` (owned by `features/recipes.md`); read indirectly via the dashboard's `dietChip` and the recipe/plan filters. `HouseholdDietForm` re-implements the strictness ranking client-side (`RANK` table) to compute the "members affected" warning before submit. |
| `household_meal_times` | table | `20260609_001_household_meal_times.sql` | **Owned here.** Composite PK `(household_id, slot)` over `public.meal_slot` (`breakfast`, `lunch`, `snacks`, `dinner`). RLS read = `has_active_membership`; insert/update/delete = `has_active_membership` (any active member, intentionally broad — per the migration comment "Any active member can update meal times per spec"). Seeded on household creation by `seed_default_meal_times` trigger (`08:00`, `13:00`, `17:00`, `20:00`) and backfilled idempotently for pre-existing households by the migration's tail. Read by `/household/meal-times` (this feature) and by `/dashboard` (`features/dashboard.md`) to anchor meal rows in the merged feed; also read by meal-plan slot-time computations in `features/meal-plan.md`. Written only by `updateMealTime`. |
| `meal_slot` | enum | `20260517_001_recipes.sql` | **Owned by `features/recipes.md`.** Listed here because `household_meal_times.slot` and the meal-times UI both depend on the enum's value set (`breakfast`, `lunch`, `snacks`, `dinner`). The meal-times page hard-codes the slot order. |
| `profiles` | table | `20260510_001_profiles.sql` | **Owned by `infrastructure.md`.** Embedded read only (`id, display_name, email`) for member rows on the settings page. The settings page uses the service-role client to do this join, because the same query reads cross-membership rows (the maid's profile is visible to the owner even though the owner's RLS would not grant it). |
| `has_active_membership(p_household uuid) → boolean` | helper | `20260512_001_household_memberships.sql` | **Owned by `infrastructure.md`.** Read by `household_meal_times` RLS. Not called directly from this feature. |

External RPCs **not** owned here but worth naming for the boundary:
- `tasks_generate_occurrences` (called by `/dashboard` and onboarding submit) — owned by `features/tasks.md`. Mentioned because changing `maid_mode` to `family_run` does **not** itself materialise tasks; the user must still complete `/onboarding/tasks`.
- `effective_recipes` (owned by `features/recipes.md`) — the only in-tree caller of `household_effective_diet`.

## External integrations
- **Clerk:** every server action in both `actions.ts` files resolves the caller via `getCurrentHousehold()` (which itself uses `requireProfile()` → `auth()`); the two routes use `requireHousehold()` from `src/lib/auth/require.ts`. The `/join/[token]` page uses `auth()` directly to redirect unauthenticated users into the sign-in flow with `?redirect_url=/join/<token>`. The email-whitelist auto-redemption (`tryRedeemPendingEmailInvite`) is the only path where Clerk's `primaryEmailAddress` (mirrored into `profiles.email`) drives a side-effect — it runs on every `getCurrentHousehold()` call for an unaffiliated user. The `redeem_invite` RPC itself reads `auth.jwt()->>'sub'` directly, so all three call-sites (`redeemInvite`, `tryRedeemPendingEmailInvite`, and any future caller) must use the JWT-bearing RLS-scoped client, never the service-role client.
- **Supabase:**
  - RLS-scoped server client (`createClient` from `src/lib/supabase/server.ts`) for: `/household/meal-times` page read + `updateMealTime` upsert (the `household_meal_times` RLS does the household scoping); `redeemInvite`'s RPC call (so `auth.jwt()` resolves); `tryRedeemPendingEmailInvite`'s RPC call (same reason).
  - Service-role client (`createServiceClient` from `src/lib/supabase/server.ts`) for: `/household/settings` page read of `household_memberships` joined to `profiles` and `invites` (the owner needs to see the maid's profile email; family-members need to see the owner's name; the RLS on `profiles` is per-clerk-user so a service-role read is required); all settings-side write actions (`createInvite`, `revokeInvite`, `removeMembership`, `updateMembershipDiet`, `updateMembershipPrivilege`, `updateHouseholdDiet`) and the `maid_mode` flip inside `createInvite`. Each action re-validates household scoping in-handler (`target.household_id !== ctx.household.id` → `'forbidden'`) because the service-role client bypasses RLS.
- **`siteUrl()`** (`src/lib/site-url.ts`) — used by `HouseholdSettingsPage` to build the user-visible invite link (`${origin}/join/${token}`) shown in the Invites card.

## Open questions
- **No revoke UI on the settings invites card.** `revokeInvite` is exported and exercised by `/dashboard` (maid-invite revoke), but the settings page only lists active invites — there is no per-row Revoke button. Either add one or document the omission as deliberate. (`src/app/household/settings/page.tsx:271–286`.)
- **`/household/meal-times` has no `loading.tsx`.** The settings page has one; the meal-times page does not. Tiny mismatch — could just port the settings skeleton's shape.
- **Diet chip deep-link target.** The dashboard's meal-preference chip links to `/household/settings#diet`, but the settings page does not assign an `id="diet"` anchor to the Meal preference card. The deep-link silently falls back to the page top. Should add `id="diet"` (or pick an explicit fragment convention shared with the chip).
- **No anchor convention for settings cards in general.** Same issue would bite any future cross-feature link into a specific card.
- **`HouseholdDietForm` re-implements `household_effective_diet`'s strictness ranking client-side.** If the SQL helper's ordering ever changes (e.g. a new enum value), the in-browser warning will drift silently. Could either (a) export the ranking from a single source-of-truth module shared by SQL + TS, or (b) accept the drift and document the convention.
- **No test coverage tracker yet** for the household feature surface. Phase 2 will populate this section.

## Test coverage

| Code unit | File | Unit | Integration | E2E | Priority gap | Recommended test type |
| --- | --- | --- | --- | --- | --- | --- |
| `removeMembership` | `src/app/household/settings/actions.ts:181` | — | — | — | high | `tests/actions/` |
| `seed_default_meal_times` trigger | `supabase/migrations/20260609_001_household_meal_times.sql` | — | — | — | high | `tests/db/` |
| `tryRedeemPendingEmailInvite` | `src/lib/auth/redeem-email-invite.ts` | — | — | — | high | `tests/actions/` |
| `updateMealTime` | `src/app/household/meal-times/actions.ts:20` | — | — | — | high | `tests/actions/` |
| `updateMembershipDiet` | `src/app/household/settings/actions.ts:228` | — | — | — | high | `tests/actions/` |
| `updateMembershipPrivilege` | `src/app/household/settings/actions.ts:265` | — | — | — | high | `tests/actions/` |
| `HouseholdDietForm` | `src/components/household/household-diet-form.tsx` | — | — | — | medium | `tests/e2e/` |
| `HouseholdSettingsPage` (`/household/settings`) | `src/app/household/settings/page.tsx` | — | — | — | medium | `tests/e2e/` |
| `JoinCodePage` (`/join/code`) | `src/app/join/code/page.tsx` | — | — | — | medium | `tests/e2e/` |
| `JoinTokenPage` (`/join/[token]`) | `src/app/join/[token]/page.tsx` | — | — | — | medium | `tests/e2e/` |
| `MealTimesPage` (`/household/meal-times`) | `src/app/household/meal-times/page.tsx` | — | — | partial via `tests/e2e/inventory.spec.ts` (unauth redirect only) | medium | `tests/e2e/` |
| `createInvite` | `src/app/household/settings/actions.ts:20` | — | `tests/actions/invites-actions.test.ts` | — | none | — |
| `household_effective_diet(p_household)` RPC | `supabase/migrations/20260706_001_household_diet_preference.sql` | — | `tests/db/household-diet-preference.test.ts` | — | none | — |
| `redeemInvite` | `src/app/household/settings/actions.ts:145` | — | `tests/actions/invites-actions.test.ts` | — | none | — |
| `revokeInvite` | `src/app/household/settings/actions.ts:111` | — | `tests/actions/invites-actions.test.ts` | — | none | — |
| `updateHouseholdDiet` | `src/app/household/settings/actions.ts:300` | `tests/actions/household-diet.test.ts` | — | — | none | — |
