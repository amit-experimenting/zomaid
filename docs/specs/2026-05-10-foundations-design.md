# Zomaid — Foundations Design

> **Superseded as the living architecture doc for the household area by [`features/household.md`](features/household.md).** This dated spec is retained for historical context.
> **Superseded as the living architecture doc for the onboarding area by [`features/onboarding.md`](features/onboarding.md).** This dated spec is retained for historical context.
> **Superseded as the living architecture doc for the infrastructure area by [`features/infrastructure.md`](features/infrastructure.md).** This dated spec is retained for historical context.

- **Date**: 2026-05-10
- **Status**: Approved (brainstorming) — pending implementation plan
- **Slice**: 1 of 7 (foundations) — see _Decomposition_ below
- **Owner**: amit@instigence.com

## 1. Context

Zomaid is a household-management PWA for Singapore households that employ a Foreign Domestic Worker (FDW). It serves three user kinds — Maid, Owner (+ family members), Admin — with four functional modules to follow in later slices: recipes & meal planning, inventory & bill scanning, fridge tracking, and tasks & reminders, plus subscription billing and admin tooling.

This document covers **only the foundations slice**: identity, households, roles, invites, onboarding, and the multi-tenant authorization model. Every later slice depends on what is decided here.

## 2. Decomposition (full project, not in this slice)

| # | Slice | Status |
|---|---|---|
| 1 | Foundations (this doc) | Designing |
| 2 | Recipes + daily meal plan | Pending |
| 3 | Inventory + bill scanning (OCR) | Pending |
| 4 | Fridge with expiry recommendations | Pending |
| 5 | Tasks + reminders + Web Push | Pending |
| 6 | Billing + subscription tiers | Pending |
| 7 | Admin tools | Pending |

Each slice ships its own design → plan → implementation cycle.

## 3. Decisions log (from brainstorming)

| Q | Decision |
|---|---|
| Maid ↔ household cardinality | **1 maid : 1 household** at any time |
| Family members | **Individual user accounts** with their own Gmail sign-in |
| Onboarding sequence | **Either-first**: maid or owner can create the household; the other joins later |
| Join mechanism | **Invite link + 6-digit code** (single mechanism, universal) |
| Region for v1 | **Singapore only** (SGD, en-SG, Asia/Singapore) |
| Multi-household membership | **Schema yes, UI single in v1** |
| Family-member privilege flag | **Owner sets at invite, can change anytime**; billing follows in slice 6 |
| Admin model | **Single global admin** designated by env var (`ZOMAID_ADMIN_CLERK_USER_IDS`) |
| Maid offboarding | **Soft-remove**; household + data persist; new maid can be invited later |
| Auth provider | **Clerk** (Gmail OAuth in v1) — already scaffolded |
| DB security boundary | **Supabase RLS** via Clerk's native third-party auth integration |

## 4. Domain model

```
profiles                       (1 row per Clerk user, synced via webhook)
  id (uuid, pk)
  clerk_user_id (text, unique)         ← matches auth.jwt()->>'sub'
  email (text)
  display_name (text)
  locale (text default 'en-SG')
  timezone (text default 'Asia/Singapore')
  is_admin (boolean default false)     ← see §6, env-driven in v1
  created_at, updated_at (timestamptz default now())

households
  id (uuid, pk)
  name (text)                          ← e.g. "Tan Family"
  address_line (text null)
  postal_code (text null)
  created_by_profile_id (uuid fk → profiles.id)
  created_at, updated_at

household_memberships          (user × household × role)
  id (uuid, pk)
  household_id (uuid fk → households.id)
  profile_id   (uuid fk → profiles.id)
  role         (enum: 'owner' | 'family_member' | 'maid')
  privilege    (enum: 'full' | 'meal_modify' | 'view_only')
  status       (enum: 'active' | 'pending' | 'removed' default 'active')
  joined_at    timestamptz default now()
  removed_at   timestamptz null
  created_at, updated_at
  unique (household_id, profile_id) where status <> 'removed'
  unique (household_id) where role = 'maid'   and status = 'active'
  unique (household_id) where role = 'owner'  and status = 'active'

invites
  id (uuid, pk)
  household_id (uuid fk → households.id)
  invited_by_profile_id (uuid fk → profiles.id)
  intended_role      (enum: 'owner' | 'family_member' | 'maid')
  intended_privilege (enum: 'full' | 'meal_modify' | 'view_only' null)
  code   (text, 6 numeric digits, unique among un-consumed)
  token  (text, 64-char url-safe, unique)
  expires_at  (timestamptz, default now() + interval '7 days')
  consumed_at (timestamptz null)
  consumed_by_profile_id (uuid null)
  created_at
```

### 4.1 Privilege values

| role | privilege | meaning | tier (slice 6) |
|---|---|---|---|
| owner | full | full control | $19 anchor |
| family_member | meal_modify | can override today's meal plan | $9 |
| family_member | view_only | sees but cannot modify meal plan | $5 |
| maid | full (default; ignored) | role-driven permissions; column defaults to `full` and is not consulted for maid rows | free |

(Family-of-5 cap to $50 is a billing-tier rule, designed in slice 6, not here.)

### 4.2 Multi-membership rule

A `profile` may have multiple `household_memberships` rows. Per-household uniqueness is enforced by the partial unique indexes above. v1 UI selects the user's _current_ household as the active membership with the largest `joined_at`; ties broken by largest `household_memberships.id` (uuid v4 ordering is fine as a deterministic tiebreaker). A switcher arrives later when slice 2+ benefit from it.

## 5. User flows

### 5.1 Sign-up & first session

1. User taps **Sign in** on `/` → Clerk modal → Google OAuth → returns to app.
2. Clerk webhook `user.created` → server upserts a `profiles` row keyed by `clerk_user_id`. (Lazy upsert in `getCurrentProfile()` is the backstop if the webhook is delayed.)
3. `proxy.ts` checks: does this user have any `active` membership?
   - **No** → redirect to `/onboarding`.
   - **Yes** → redirect to `/dashboard`.

### 5.2 `/onboarding` chooser

Three CTAs:

- **I'm an FDW — start free**
  → form: owner name, owner email.
  → server: creates `households` (named `"<owner name>'s household"` initially; owner can rename later via §5.6), creates maid `household_membership` (status=active), creates a pending invite for the owner.
  → maid lands on `/dashboard`.

  > FDW personal details (work-pass number, employment start date, passport, etc.) are **not** captured in foundations — see §11. Foundations only requires what is needed to create the household and invite the owner.

- **I'm an owner — start a household**
  → form: household name, address (optional).
  → server: creates `households` + owner `household_membership`.
  → owner lands on `/dashboard` and is prompted to invite maid + family members.

- **I have an invite**
  → form: 6-digit code or pasted link.
  → routes to redeem flow (5.4).

### 5.3 Invite generation

Allowed callers:

- An active **owner** may invite: another `family_member` (with chosen privilege), or a `maid` (only when no active maid exists in the household).
- An active **maid** may invite: the `owner` (only when no active owner exists in the household).
- No one else can mint invites in v1.

Server action mints `invites` row, returns `{ code, link }` (link = `https://zomaid.app/join/<token>`). 7-day expiry. One-time consumption.

### 5.4 Accept invite (`/join/<token>` or code entry)

1. If not signed in → Clerk modal sign-in first.
2. Server action calls `redeem_invite(token)` Postgres function.
3. The function (SECURITY DEFINER, single transaction) validates: token unexpired, unconsumed, household exists; checks the unique-active-maid / unique-active-owner invariant; inserts `household_memberships` with `role` + `privilege` from the invite; marks invite consumed; returns the new membership.
4. UI redirects to `/dashboard`.

### 5.5 Maid offboarding (owner-initiated)

- Owner opens `/household/settings` → **Remove maid** → confirmation modal.
- Server action sets maid's membership `status='removed'`, `removed_at=now()`. Owner's view updates; maid's next request sees no rows for this household (RLS) and the UI shows a "no longer linked" empty state.
- Household is now in "no maid" state; owner can mint a new maid invite.

### 5.6 Family-member removal & self-leave

- Owner can remove any `family_member` membership.
- Any user can self-leave (sets own membership `status='removed'`); if it's their last household they land back on `/onboarding`.
- Owners cannot self-leave while they are the only owner — must transfer ownership first (deferred to a later slice; v1 disables the button with a tooltip).

### 5.7 Privilege change

- Owner toggles `meal_modify` ↔ `view_only` on a `family_member` row in `/household/settings`. Effective immediately at the app level. Billing reconciliation defers to slice 6.

## 6. Architecture & authorization

### 6.1 Identity flow

```
Browser ──Clerk session──▶ Next.js (proxy.ts auth gate)
                              │
                              ├─▶ Server Action / Route Handler
                              │      │
                              │      └─ Supabase client created with
                              │         { accessToken: () => clerkSessionToken }
                              ▼
                          Supabase / Postgres
                            └─ RLS policies decide row visibility
                                 (auth.jwt()->>'sub' = clerk_user_id)
```

### 6.2 One-time integration setup

1. Configure a Clerk JWT template named `supabase` (Supabase's expected `aud: "authenticated"` and `role: "authenticated"` claims).
2. In Supabase Studio → Auth → Third-party Auth → register Clerk's issuer URL.
3. App-side `@supabase/ssr` client passes the Clerk session token via the `accessToken` callback in both `client.ts` and `server.ts`.

### 6.3 RLS policies (foundations tables)

```
profiles
  read  self:   auth.jwt()->>'sub' = profiles.clerk_user_id
  write self:   same predicate, only display_name | locale | timezone columns
  read  admin:  caller's profile.is_admin = true

households
  read  member:   exists active household_memberships row for caller in this household
  write owner:    same + role = 'owner'
  insert creator: created_by_profile_id = caller's profile.id

household_memberships
  read  household-member: caller has active membership in same household
  write owner-manage:     caller is active owner of the household
  update self-leave:      caller may set own row to status='removed'

invites
  read   household-eligible: caller is active owner OR active maid of household
  insert household-eligible: same
  update revoke:             invited_by_profile_id = caller's profile.id
```

### 6.4 The `redeem_invite` RPC

Consuming an invite must read the invite by token and write a new `household_memberships` row in one transaction, but the consumer is _not yet_ a member — RLS would block them. Solution:

```
redeem_invite(token text) returns household_memberships
  -- SECURITY DEFINER, fixed search_path
  -- Lock invite row FOR UPDATE
  -- Validate: not consumed, not expired
  -- Validate invariant: target household has no other active row of intended_role
  -- Insert membership; mark invite consumed
  -- Return membership
```

This function is the **only** RLS-bypassing path in the foundations slice. Audit it carefully.

### 6.5 Admin in v1

- Boot task reads `ZOMAID_ADMIN_CLERK_USER_IDS` (comma-separated) and upserts `is_admin = true` on those `profiles`. Idempotent. Runs on each startup as a safety net.
- Admin UI is **out of scope** for this slice — foundations only exposes the flag and an admin-read RLS policy on `profiles`. The admin slice (slice 7) will build features against this flag.

### 6.6 Server-side helpers (`src/lib/auth/`)

- `getCurrentProfile()` — returns the caller's `profiles` row (lazy-upsert if missing).
- `getCurrentHousehold()` — returns `{ household, membership }` for the caller's current household, or null if none.
- `requireRole(role)` and `requirePrivilege(...)` — throw `redirect()` if not satisfied. Layered on top of RLS, never a substitute.

## 7. API surface

All actions in `src/app/(*)/actions.ts`, validated with Zod. Errors returned as discriminated unions; UI shows toast + form-level messages.

| Action | Caller invariant | Effect |
|---|---|---|
| `createHouseholdAsMaid({ ownerName, ownerEmail })` | signed in, no active membership | new household + maid membership + pending owner invite |
| `createHouseholdAsOwner({ name, address? })` | signed in, no active membership | new household + owner membership |
| `createInvite({ householdId, role, privilege? })` | active owner; or active maid when role=owner | mint invite |
| `revokeInvite({ inviteId })` | inviter or any active owner | sets `expires_at = now()` |
| `redeemInvite({ tokenOrCode })` | signed in | wraps `redeem_invite` RPC |
| `removeMembership({ membershipId })` | active owner OR member self-leave | sets status='removed' |
| `updateMembershipPrivilege({ membershipId, privilege })` | active owner; only `family_member` rows | updates flag |

Postgres functions:

- `redeem_invite(token text) returns household_memberships` (SECURITY DEFINER)

## 8. UI surfaces (this slice)

Mobile-first, responsive (PWA installable). All routes built with shadcn primitives.

- `/onboarding` — three-card chooser
- `/onboarding/maid` — owner-details form
- `/onboarding/owner` — household form
- `/join/[token]` — auto-redeem if signed in & valid; else sign-in then redeem
- `/dashboard` — placeholder (household name + member list + invite CTA); real dashboard ships in later slices
- `/household/settings` — name/address, member list with role + privilege controls, invite + remove + leave actions

The four feature areas (recipes, inventory, fridge, tasks) appear as **disabled placeholder cards** on the dashboard. They link to "Coming soon" pages until their slices ship.

## 9. Edge cases & error handling

- **Clerk webhook lost / out of order** — first server-side helper call lazily upserts the `profiles` row.
- **Invite race** (two people try to consume the same maid invite) — DB unique constraint + the SECURITY DEFINER RPC's transaction makes the second one fail; UI shows "this invite has already been used."
- **Maid invites owner when one already exists** — blocked at server action and re-checked at RPC.
- **User leaves last household** — allowed; redirected to `/onboarding` next request.
- **Soft-removed maid's stale page** — next server fetch returns no rows (RLS); UI renders "no longer linked" empty state.
- **Zero-membership user hits `/dashboard`** — middleware redirects to `/onboarding`.
- **Address & PII** — only minimal PII (name, email, postal code). No NRIC, no FDW work-pass numbers in this slice.
- **Locale/TZ** — fixed to `en-SG` / `Asia/Singapore` in v1; profile fields exist for later configurability.

## 10. Testing strategy

- **Unit** — Zod schemas, server-action input validation, helper functions (`getCurrentHousehold`, `requireRole`).
- **DB integration** — Postgres tests against a Supabase branch (or local Supabase): RLS policies block/allow per role; unique constraints; `redeem_invite` invariants; race conditions on duplicate invite consumption.
- **E2E** (Playwright) — maid-led onboarding, owner-led onboarding, invite redemption, maid removal, family-member removal, self-leave.
- **Skipped on purpose** — Clerk's own auth flow (we trust Clerk); load tests (premature).

## 11. Out of scope (deferred to later slices)

Recipes • bill OCR • fridge tracking • tasks/reminders • Web Push • billing/Stripe • admin UI • multi-household switcher UI • non-Singapore locales • email/SMS templating beyond the invite link • profile picture upload • account deletion ("forget me") • audit log • two-factor auth • **FDW personal details** (work-pass number, employment start date, passport, etc. — collected in a later slice once we have the admin/HR features that need them).

## 12. Risks & open questions

- **Clerk + Supabase third-party auth setup** is the only technically novel piece. Mitigation: validate end-to-end before writing feature code (first task in the implementation plan).
- **Email delivery for invites**. v1 returns the invite link in the UI for the inviter to share manually (WhatsApp, etc.). Auto-emailed invites depend on the AWS SES wiring slated for later. Acceptable for v1.
- **Account-deletion / GDPR-style erasure** is not addressed in this slice. Singapore PDPA equivalents will be considered when admin tooling is designed (slice 7).
