# Owner-side "Invite your maid" card on Home

> **Superseded as living documentation by [`features/dashboard.md`](features/dashboard.md).** This dated spec is retained for historical context.

**Date:** 2026-05-11
**Status:** Approved (brainstorm), pending implementation plan
**Scope:** Single change — surface the existing maid-invite flow on the owner's Home (`/dashboard`) page.

## 1. Problem

When an owner signs in, the Home page (`/dashboard`) shows the household name, the owner's identity line, and a `Settings` button. There is no entry point on Home for the most important next step in setup: getting the maid into the household.

The capability already exists — `createInvite({ role: "maid" })` in [src/app/household/settings/actions.ts](../../src/app/household/settings/actions.ts) generates a 6-digit code + a `/join/<token>` URL, and the maid joins via `/join/<token>` (auto-redeem) or `/join/code` (manual code entry). But the affordance is buried inside `/household/settings`. An owner looking at Home has no obvious next action.

The mirror flow already exists in the other direction: when a **maid** is signed in and has invited an owner, [src/app/dashboard/page.tsx](../../src/app/dashboard/page.tsx) renders a "Share this link with your owner" card on Home. We are bringing the same idiom to the owner's view.

## 2. Goals / non-goals

**Goals**
- Owner sees a clear, persistent card on Home that drives maid onboarding.
- The card resolves through three states: empty → pending invite → maid joined.
- Zero new database, RPC, or RLS work — purely a UI surface over existing actions.
- Match the existing visual idiom from the maid-side dashboard card.

**Non-goals (YAGNI)**
- Owner-led guided onboarding (collecting maid's name + sending SMS/WhatsApp).
- Owner provisioning a Clerk account on the maid's behalf.
- Family-member invites on Home (the settings page already covers them; the user explicitly scoped this to maids).
- Listing or rotating multiple simultaneous pending maid invites (one-at-a-time matches the "only one active maid" model).
- Per-card error UI for the invite-generation server action — defer to the app's existing error path until we see real failures in use.

## 3. User-visible behaviour

A new card renders at the bottom of `/dashboard` **only** when `ctx.membership.role === "owner"`. The card has three states, derived from the server's view of the household at render time:

### State A — No maid yet
- **Trigger:** No active `household_memberships` row for `role = "maid"`. No pending `invites` row for `intended_role = "maid"`.
- **Card title:** `Invite your maid`
- **Card body:** Short blurb ("Send a code or a link your maid can tap to join the household.") + a single primary button: `Generate invite`.
- **Action:** Submitting the form calls a server action that wraps `createInvite({ role: "maid" })`, then re-renders into State B.

### State B — Pending invite
- **Trigger:** No active maid membership. ≥1 pending maid invite (most recent one wins if multiple).
- **Card title:** `Share this with your maid`
- **Card body:**
  - The 6-digit code in a large, readable font.
  - The fully-qualified `/join/<token>` URL in a copy-friendly `<code>` block.
  - **Copy** button (clipboard).
  - **Share** button (only renders if `navigator.share` is available; uses native Web Share API).
  - A small **Revoke** link/button that calls the existing `revokeInvite({ inviteId })` action.
- **Action:** Revoke returns the card to State A.

### State C — Maid joined
- **Trigger:** Active maid membership exists.
- **Card title:** `Maid: <display_name>` (uses the joined member's `profiles.display_name`, falling back to `email` per the existing settings page convention).
- **Card body:** A `Joined` badge (visual only) + a small `Manage` link that routes to `/household/settings`.
- No actions on the card itself; full management lives at `/household/settings`.

The maid-side "Share this link with your owner" card on the same page (`pendingOwnerInviteToken` block) is untouched.

## 4. Architecture

### 4.1 Page changes

[src/app/dashboard/page.tsx](../../src/app/dashboard/page.tsx) — when `ctx.membership.role === "owner"`, run two queries via the existing `createClient()` (Clerk-JWT-bearing client, so RLS applies) in parallel with the existing maid-side fetch:

1. **Maid membership lookup** — `household_memberships` filtered to `household_id = ctx.household.id`, `role = "maid"`, `status = "active"`, joining `profiles(id, display_name, email)`. At most one row per the existing DB invariant.
2. **Pending maid invite lookup** — `invites` filtered to `household_id = ctx.household.id`, `intended_role = "maid"`, `consumed_at IS NULL`, `expires_at > now()`, ordered by `created_at desc`, `limit 1`. Returns `id, code, token`.

Resolve to one of A/B/C and pass the relevant payload to a small client component.

### 4.2 New component

`src/components/site/owner-invite-maid-card.tsx` — **client component**. Receives a discriminated-union prop:

```ts
type Props =
  | { state: "empty" }
  | { state: "pending"; origin: string; code: string; token: string; inviteId: string }
  | { state: "joined"; maidName: string };
```

Owns:
- The Copy button (uses `navigator.clipboard.writeText`).
- The Share button (only mounts when `typeof navigator.share === "function"`, gated behind a `useEffect`-set boolean to avoid hydration mismatch).
- The two server-action `<form>` submissions (Generate, Revoke) — wired to actions exported from `src/app/dashboard/actions.ts`.

The card renders inside the same `Card` / `CardHeader` / `CardTitle` / `CardContent` primitives the rest of the dashboard uses, so it visually matches the existing maid-side card.

### 4.3 Server actions

A new file: `src/app/dashboard/actions.ts`. Two thin wrappers:

- `inviteMaidFromHome()` — server action.
  - Calls `getCurrentHousehold()`; throws if absent or if `membership.role !== "owner"`.
  - **Idempotency guard:** before calling `createInvite`, query `invites` for a pending maid invite (`intended_role = "maid"`, `consumed_at IS NULL`, `expires_at > now()`). If one exists, return it. Otherwise call `createInvite({ role: "maid" })`. This protects against double-tap creating two pending invites.
  - On success, `revalidatePath("/dashboard")`.
- `revokeMaidInviteFromHome({ inviteId })` — server action.
  - Calls `revokeInvite({ inviteId })` (which already enforces ownership + caller checks).
  - On success, `revalidatePath("/dashboard")`.

### 4.4 Cross-page revalidation

The existing `createInvite` and `revokeInvite` already call `revalidatePath("/household/settings")`. Add `revalidatePath("/dashboard")` to both, so changes made in either surface keep the other in sync. Two one-line additions to [src/app/household/settings/actions.ts](../../src/app/household/settings/actions.ts).

## 5. Data flow diagram

```
DashboardPage (server, role=owner)
  ├── requireHousehold()                              [existing]
  ├── createClient()                                  [existing]
  ├── select household_memberships where role=maid    [new]
  ├── select invites where intended_role=maid…        [new]
  └── render <OwnerInviteMaidCard state={…}>          [new]
        ├── state=empty   → form → inviteMaidFromHome → createInvite → reval(/dashboard)
        ├── state=pending → Copy / Share / form → revokeMaidInviteFromHome → revokeInvite → reval(/dashboard)
        └── state=joined  → static "Manage" link → /household/settings
```

## 6. Error handling

- **Invite generation fails** (DB error, RLS surprise): action throws; the existing app-level error boundary handles it. No card-local error UI in v1.
- **Revoke fails:** same — existing error path. Acceptable because the card re-renders on the next request and the owner can retry.
- **Clipboard API unavailable** (very old browsers): the Copy button still attempts `navigator.clipboard.writeText`; on rejection it does nothing visible. The full link is always shown in the `<code>` block, so the owner can long-press to copy. No fallback `document.execCommand` shim needed.
- **Web Share API unavailable** (desktop Chrome on Linux, etc.): Share button does not render. Copy + visible link cover that case.
- **Concurrent generate (double-tap):** mitigated by the idempotency guard in §4.3.
- **Hydration mismatch on Share button:** prevented by deferring the `navigator.share` check to a `useEffect` that sets a `canShare` state; the button only renders when `canShare === true`. Initial render = no Share button on either server or client.

## 7. Security

No new attack surface. All capability checks already exist:
- `createInvite` enforces "only owner can invite maid" + "no existing active maid".
- `revokeInvite` enforces "owner OR original inviter" + "household match" + "not already consumed".
- The dashboard-page reads run under the Clerk-JWT client, so household RLS scopes them to the owner's own household.
- The `Generate invite` and `Revoke` forms post to server actions; CSRF is handled by Next.js's built-in server-action protection.

## 8. Testing

- **Playwright e2e (new, file stub only):** `tests/e2e/dashboard-owner-invite-maid.spec.ts`. Three scenarios — empty card → generate → see code+link; revoke → back to empty; with a seeded active maid membership → see "Joined" state. Marked `test.skip` per the project's standing "we'll come back to tests" instruction; the stub captures intent so the next test push picks it up.
- **No new vitest tests.** `createInvite` / `revokeInvite` are unchanged; the new wrappers are too thin to merit dedicated unit tests.
- **Manual walkthrough** before merge:
  1. Sign in as the owner of a household with no maid → see State A on Home.
  2. Click `Generate invite` → see State B with code and link.
  3. Open the link in an incognito window, sign up as a different user, redeem → return to the owner window, refresh → see State C.
  4. (Optional) Have the joined maid leave via `/household/settings` → owner Home returns to State A on next render.
  5. From State B, click `Revoke` → returns to State A.

## 9. Files touched

| Path | Change |
|---|---|
| `src/app/dashboard/page.tsx` | Add owner-role queries + render `<OwnerInviteMaidCard>` |
| `src/app/dashboard/actions.ts` | **New.** Two thin server-action wrappers |
| `src/components/site/owner-invite-maid-card.tsx` | **New.** Client component with three render branches |
| `src/app/household/settings/actions.ts` | Add `revalidatePath("/dashboard")` in `createInvite` and `revokeInvite` |
| `tests/e2e/dashboard-owner-invite-maid.spec.ts` | **New, stub.** Skipped Playwright spec capturing intent |

## 10. Open questions

None at design time. Any per-card error UI, SMS/WhatsApp delivery, or guided onboarding is explicitly deferred per §2.
