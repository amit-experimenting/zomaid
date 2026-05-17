# Maid onboarding flow — design

**Date:** 2026-05-17
**Status:** Proposed
**Owner:** dharni

## Problem

When a maid clicks her invite link (`/join/{token}`), the current flow redeems the invite and drops her on `/dashboard`. There is no step to collect her details, and she lands on a screen built around the owner's tasks ("Set up your household", "Set up your kitchen inventory"). Maids should pass through a short onboarding step that captures their name and a few optional personal fields before reaching the dashboard.

## Scope

In scope (beta):
- A new maid onboarding page shown once, after invite redemption, before dashboard.
- Capture: display name (required, pre-filled from Clerk/Google), passport number, passport expiry, preferred language. Passport/expiry/language are optional.
- A "My Profile" section under household settings so the maid (or anyone) can edit these fields later.
- Persistence on the existing `public.profiles` table.

Out of scope:
- Changes to owner flow. Owners continue to land on `/dashboard` as today.
- Changes to dashboard card gating. Owner + maid both continue to see "Set up your household" / "Set up your kitchen inventory" cards (per explicit decision; this is not the bug we're fixing).
- Profile photo upload, role-specific dashboards, multi-household profiles.

## User flow

```
Maid clicks /join/{token}
  → (existing) Clerk login if needed
  → (existing) redeemInvite() adds her to the household
  → NEW: /onboarding/personal (only if profiles.onboarding_completed_at IS NULL)
       Fields:
         - Display name [pre-filled from Clerk, editable, required]
         - Passport number [optional]
         - Passport expiry [optional, date]
         - Preferred language [optional, dropdown]
       [Save & continue]
  → /dashboard
```

If `onboarding_completed_at` is already set, the onboarding page redirects to `/dashboard`. The dashboard, in turn, redirects **maids only** with `onboarding_completed_at IS NULL` to `/onboarding/personal`. This gate covers maids who land on `/dashboard` directly (bookmark, post-login fallback) without going through `/join/{token}`, and ensures existing maids (who predate this feature) also pass through the form on next visit. Owners are never redirected.

## Schema

New migration (filename assigned at implementation time, following the existing `YYYYMMDD_NNN_*.sql` convention) extending `public.profiles`:

```sql
alter table public.profiles
  add column passport_number       text,
  add column passport_expiry       date,
  add column preferred_language    text,
  add column onboarding_completed_at timestamptz;
```

Notes:
- All four new columns are nullable. `onboarding_completed_at = NULL` means "show onboarding when the gate fires"; setting it (even with all optional fields empty) means "user has been through the flow and continued."
- **No backfill.** Existing maids will see the form on their next visit, by design. Existing owners are protected by the gate being role-scoped (see Component breakdown).
- `preferred_language` is free text in the database, but the UI dropdown constrains values to the supported list (see below). Free text keeps the door open for future additions without another migration.
- No new RLS policies needed: `profiles_self_read` and `profiles_self_update` already cover these columns. The `profiles_block_protected_columns` trigger does not need to guard the new fields — users may freely change them.

## Language options

The dropdown shows: English, Hindi, Tamil, Telugu, Kannada, Marathi, Bengali, Malayalam, Manipuri, Mizo, Punjabi.

Stored as a stable short code (`en`, `hi`, `ta`, `te`, `kn`, `mr`, `bn`, `ml`, `mni`, `lus`, `pa`) so labels can be localized later without a data migration. The mapping lives in `src/lib/profile/languages.ts`.

## Component breakdown

**Naming note:** `/onboarding/profile` and `src/app/onboarding/profile/profile-form.tsx` are already taken by the **household questionnaire** (different feature, different table: `household_profiles`). To avoid collision, the new personal-profile feature uses `personal` / `personal-profile-form` / `me`.

- `src/app/onboarding/personal/page.tsx` — server component. Loads the caller's profile, pre-fills name from Clerk when display name is empty, redirects to `/dashboard` if onboarding already done.
- `src/app/onboarding/personal/actions.ts` — `savePersonalProfile()` server action. Validates with Zod, updates `profiles`, sets `onboarding_completed_at = now()` **only if currently NULL** (so the first save through any surface stamps it; later edits leave it alone), then redirects. The redirect target comes from a form field — `/dashboard` from onboarding, `/household/settings` from the settings page.
- `src/components/profile/personal-profile-form.tsx` — shared client form `PersonalProfileForm` (name + 3 optional fields + submit button + hidden `redirect_to`). Same component used in the settings page.
- `src/app/household/settings/me/page.tsx` — settings sub-route reusing `PersonalProfileForm` with `redirect_to=/household/settings`.
- `src/lib/profile/languages.ts` — language list, code↔label helpers. Lives alongside the existing `src/lib/profile/types.ts` (which is for household questionnaire); no collision.
- Edit `src/app/join/[token]/page.tsx:32` — change final redirect from `/dashboard` to `/onboarding/personal`. The onboarding page handles the "already done" case, so this is safe for re-joiners.
- Edit `src/app/dashboard/page.tsx` — add early check: `if (ctx.membership.role === "maid" && profile.onboarding_completed_at == null) redirect("/onboarding/personal")`. **Maid-only gate** — owners and family members are never redirected, even if their `onboarding_completed_at` is NULL. They can still optionally fill in the form via Settings → My Profile.
- Edit `src/app/household/settings/page.tsx` — add a "My Profile" card linking to `/household/settings/me` (mirrors the Household profile section pattern from commit 7bb3f5c). Available to all roles.

## Data validation

Zod schema (`savePersonalProfile` input):

```ts
const profileSchema = z.object({
  display_name:        z.string().trim().min(1, "Name is required").max(120),
  passport_number:     z.string().trim().max(64).optional().nullable(),
  passport_expiry:     z.iso.date().optional().nullable(),  // YYYY-MM-DD
  preferred_language:  z.enum(LANGUAGE_CODES).optional().nullable(),
});
```

Empty optional fields are normalized to `null` before write.

## Edge cases

- **Maid already onboarded re-clicks a new invite (multi-household, future):** out of scope. The current redeem flow already short-circuits if she's in a household (`actions.ts:148`); v1 doesn't support multi-household.
- **Owner with `onboarding_completed_at IS NULL`:** never redirected — the dashboard gate is maid-only. Owners may optionally fill in their own passport/language details via Settings → Profile; otherwise their `onboarding_completed_at` stays NULL forever, which is harmless.
- **Clerk has no name on the Google account:** the field shows empty and the maid must type one. Submit is disabled until non-empty.
- **Mid-form navigation away:** no draft persistence. She'll see the form again next time. Acceptable for beta.
- **`savePersonalProfile` fails (DB error):** form re-renders with error banner; `onboarding_completed_at` is not stamped, so she's still gated.

## Testing

- Unit: Zod schema accepts/rejects the documented cases.
- Integration: `savePersonalProfile()` writes the row, stamps `onboarding_completed_at`, redirects.
- E2E (Playwright): redeem invite → expect `/onboarding/personal` → submit minimal form → expect `/dashboard`; re-visit `/onboarding/personal` → expect redirect to `/dashboard`.
- Manual: edit at `/household/settings/me` does not re-set `onboarding_completed_at`, but does persist new values.

## Open questions

None at design time. The two outstanding decisions (cards stay for both roles; settings page in scope now) are confirmed.
