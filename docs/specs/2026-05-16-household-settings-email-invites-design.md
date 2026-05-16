# Household settings: maid grouping + email-whitelist invites

> **Superseded as the living architecture doc for the household area by [`features/household.md`](features/household.md).** This dated spec is retained for historical context.

Date: 2026-05-16

## Problem

Two changes to [/household/settings](../../src/app/household/settings/page.tsx):

1. **Members list order.** Today the page renders memberships in DB order
   (roughly join order). The owner wants the maid surfaced last and visually
   distinct from family members.
2. **Invite friction.** Today an invite is a 6-digit code + link the owner
   copies to the invitee. The owner wants an optional email field: when a
   person signs into the app with that email, they should be auto-joined to
   the household at the role/privilege the invite specified, without needing
   to paste a link or code.

## Scope

In scope:

- Sort active memberships so maid rows render last; visually tint the maid
  row.
- Add a nullable `intended_email` column to `public.invites` plus a partial
  unique index so the same household can't have two unconsumed email invites
  for the same address.
- Accept an optional email in `createInvite`. Validate, lowercase+trim,
  reject if a duplicate active email invite already exists for this
  household.
- Render an optional email input on the three invite forms (family member,
  maid, owner). Show the targeted email on each pending invite row.
- On authenticated request, when the user has no active household, scan
  pending email invites for a match on the user's profile email and redeem
  the most recent one via the existing `redeem_invite` RPC.

Out of scope (deferred):

- Sending the invite by email — no email-sending infra in this repo today.
  The email field is *only* used for matching at redemption.
- Editing or rotating the email on an existing invite. Revoke and re-create.
- Plus-aliasing (`alice+test@x.com` is treated as distinct from `alice@x.com`),
  domain wildcards, role-based domain rules.
- Notifying the inviter when redemption happens.
- Webhook-side auto-redemption on Clerk `user.created`. Lazy redemption on
  first authenticated request is enough for v1; we can add a webhook
  optimization later if first-load latency becomes a complaint.

## Changes

### Migration `20260623_001_invite_emails.sql`

```sql
alter table public.invites
  add column intended_email text
    check (
      intended_email is null
      or length(intended_email) between 3 and 254
    );

-- One pending email-targeted invite per (household, email).
create unique index invites_active_email_per_household_idx
  on public.invites (household_id, lower(intended_email))
  where consumed_at is null and intended_email is not null;

-- Fast lookup at redemption time: pending invites for a given lower(email).
create index invites_active_email_lookup_idx
  on public.invites (lower(intended_email))
  where consumed_at is null and intended_email is not null;
```

No new RPCs. The existing `redeem_invite(p_token text)` does all the
capacity-and-membership work; we just pick the right token to feed it.

### Server action: `createInvite`
([src/app/household/settings/actions.ts](../../src/app/household/settings/actions.ts))

Extend the zod schema:

```ts
const createInviteSchema = z.object({
  role: z.enum(["owner", "family_member", "maid"]),
  privilege: z.enum(["full", "meal_modify", "view_only"]).optional(),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
});
```

After existing capacity checks, if `email` is non-empty:

```ts
const existing = await svc
  .from("invites")
  .select("id")
  .eq("household_id", household.id)
  .is("consumed_at", null)
  .gt("expires_at", new Date().toISOString())
  .ilike("intended_email", data.email)
  .limit(1);
if (existing.data?.length) {
  throw new Error("an unconsumed invite for that email already exists");
}
```

Pass `intended_email: data.email || null` into the insert.

### New helper: `tryRedeemPendingEmailInvite`
([src/lib/auth/redeem-email-invite.ts](../../src/lib/auth/redeem-email-invite.ts) — new file)

```ts
import "server-only";
import { createClient, createServiceClient } from "@/lib/supabase/server";

// Returns true if a membership was created.
export async function tryRedeemPendingEmailInvite(profileEmail: string): Promise<boolean> {
  if (!profileEmail) return false;
  const svc = createServiceClient();
  const pending = await svc
    .from("invites")
    .select("token")
    .ilike("intended_email", profileEmail)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (pending.error || !pending.data?.length) return false;

  // Redeem via the RPC under the caller's JWT so it sees auth.jwt() and
  // enforces capacity + duplicate-membership checks.
  const supabase = await createClient();
  const { error } = await supabase.rpc("redeem_invite", { p_token: pending.data[0].token });
  return !error;
}
```

We swallow `redeem_invite` errors here — e.g. P0005 ("household already has
an active maid") shouldn't crash a dashboard load. The user just doesn't get
auto-joined; the existing invite is still pending.

### Hook into `getCurrentHousehold`
([src/lib/auth/current-household.ts](../../src/lib/auth/current-household.ts))

After the initial membership lookup returns no row, try email-redemption
once, then re-query:

```ts
if (!row) {
  const redeemed = await tryRedeemPendingEmailInvite(profile.email);
  if (!redeemed) return null;
  // Re-fetch with the same query.
  const after = await supabase
    .from("household_memberships")
    .select("*, household:households(*)")
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .order("joined_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (after.error) throw new Error(after.error.message);
  const r = after.data?.[0];
  if (!r) return null;
  // unpack as before…
}
```

This is the only entry point — everything goes through `requireHousehold` →
`getCurrentHousehold`, so a single hook covers all routes.

### Settings page UI
([src/app/household/settings/page.tsx](../../src/app/household/settings/page.tsx))

**Member order.** After fetching `members`, sort:

```ts
const sortedMembers = [...members.data!].sort((a, b) => {
  const am = a.role === "maid" ? 1 : 0;
  const bm = b.role === "maid" ? 1 : 0;
  return am - bm;
});
```

(Within each group the order stays as fetched, which is roughly join order.)

**Maid row styling.** Apply a `cn(... maid && "border-l-2 border-l-primary bg-primary/5 pl-3")`
class to the `<li>`. Role label gets a small uppercase badge color shift —
e.g. for `m.role === "maid"`, wrap the role text in `<span className="text-primary font-medium">`.

**Email input on invite forms.** Each of the three invite forms gets one
extra input:

```tsx
<Input
  name="email"
  type="email"
  placeholder="Email (optional)"
  className="mt-1 w-full"
/>
<p className="text-xs text-muted-foreground">
  Auto-join when this email signs in.
</p>
```

The action handlers (`inviteFamily`, `inviteMaid`, `inviteOwner`) read
`formData.get("email")` and pass it to `createInvite`.

**Invite display.** Each pending invite row gets a small line showing the
target email when set:

```tsx
{i.intended_email && (
  <div className="text-xs text-muted-foreground">→ {i.intended_email}</div>
)}
```

### Database types
([src/lib/db/types.ts](../../src/lib/db/types.ts))

Add `intended_email: string | null` to `invites.Row` / `Insert` / `Update`.

## Data flow

**Email invite happy path:**

```
Owner enters alice@example.com in family-member invite form
  └── createInvite stores invite row with intended_email='alice@example.com'

Alice signs up via Clerk with alice@example.com
  └── Clerk webhook upserts profiles row (email='alice@example.com')
  └── Alice opens /dashboard
       └── requireHousehold → getCurrentHousehold
            └── no active membership found
            └── tryRedeemPendingEmailInvite('alice@example.com')
                 ├── finds the pending invite
                 └── calls redeem_invite(token) under Alice's JWT
                      └── household_memberships row created
            └── re-fetch returns the new membership
       └── /dashboard renders normally
```

**Manual invite still works:**

No change. Token + 6-digit code redemption path through `/join/[token]`
and `/join/code` is untouched.

## Validation

- Migration: `intended_email` length-checked (3–254). Lowercased + trimmed
  on the way in by `z.string().toLowerCase()`.
- Migration: partial unique index prevents two active invites per
  `(household_id, lower(intended_email))` pair.
- Action: zod rejects malformed emails.
- Action: app-level duplicate check returns a clean error instead of a raw
  23505 unique-violation when two creates race.
- RPC: existing `redeem_invite` still enforces capacity, duplicate
  membership, and expiry — no new failure surfaces.

## Testing

- `pnpm test`: existing suite stays green. The action-tests in
  [tests/actions/invites-actions.test.ts](../../tests/actions/invites-actions.test.ts)
  are env-gated and currently skipped locally; the changes don't alter
  existing call signatures, so those tests still apply once env is set.
- Manual browser flow:
  1. Sign in as owner; on `/household/settings` create a family-member invite
     with `email = test@example.com`. Confirm the invite row shows
     `→ test@example.com`.
  2. Try creating a second invite with the same email and same role.
     Confirm the page surfaces "an unconsumed invite for that email already
     exists".
  3. Sign out. Sign up a new Clerk account using `test@example.com`. Land on
     `/dashboard`. Confirm the household appears with the role specified at
     invite time (no `/join` detour).
  4. As maid, invite the owner with an email and confirm the same flow.
  5. Confirm the members card shows the maid last with a tinted row.
  6. Token + code flow: create an invite *without* an email, copy the link,
     open in an incognito window with a different account, paste the 6-digit
     code on `/join/code`. Confirm it still works.

## Risks / open questions

- **Email matching uses `profiles.email`.** That's set by the Clerk webhook
  from the primary email. If a user has multiple verified emails on Clerk and
  the inviter typed a secondary one, no match — they'd need to use the link
  or code as before. Documented; not solving in v1.
- **Race between webhook profile creation and first page load.** Already
  handled by [`getCurrentProfile`](../../src/lib/auth/current-profile.ts):it lazily upserts a profile from Clerk if the webhook hasn't fired yet. By
  the time our `tryRedeemPendingEmailInvite` runs, `profile.email` is
  populated.
- **Invites with `intended_email` are still listed publicly to anyone who
  has the token.** This matches the existing model — the token itself is
  the bearer credential. The email is an additional convenience, not a
  restriction. (We do *not* enforce "redeemer's email must match" in the
  token-redemption path; that would break existing behavior and isn't
  requested.)
- **Email confusion across households.** If two households happen to send
  invites to the same email, the user gets joined to whichever invite is
  most recent (`order by created_at desc`). They can leave and re-redeem
  the other from `/join/code` if needed. v1 limitation.
