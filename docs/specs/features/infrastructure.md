# Infrastructure — architecture

**Status:** active
**Last reviewed:** 2026-05-16

This spec covers the cross-cutting plumbing every feature depends on: Clerk authentication, the Supabase client trio, the proxy/middleware route gate, the Clerk webhook, the Vercel cron driver and its three currently-mounted endpoints, the Web Push delivery wrapper, the Serwist service worker / PWA shell, the admin env-sync boot task, and the foundational household data model (`profiles`, `households`, `household_memberships`, `invites`, the `redeem_invite` RPC, the `diet` enum, and the `has_active_membership` / `is_active_owner` / `is_active_owner_or_maid` security-definer helpers). Feature-owned routes, server actions, components, and DB objects live in their own feature specs; this spec links to them rather than re-describing them. The boundaries are called out throughout.

The `MainNav` shared chrome and the small `ui/*` primitives that every feature mounts also live here — feature-specific composites such as `HouseholdModeCard` or `BillConfirmForm` stay with their owning feature.

## Routes
| Route | File | Type |
| --- | --- | --- |
| `/` | `src/app/page.tsx` | page — public landing. Server-side `auth()` check: if signed in, redirects to `/dashboard` or `/onboarding` based on `getCurrentHousehold()`; otherwise renders `<SignInButton>` / `<SignUpButton>` (Clerk redirect mode targeting `/sign-in` and `/sign-up`). |
| `/sign-in/[[...sign-in]]` | `src/app/sign-in/[[...sign-in]]/page.tsx` | page — catch-all so Clerk can route its multi-step sign-in flow (verification, second factor, etc.). Mounts `<SignIn />`. |
| `/sign-up/[[...sign-up]]` | `src/app/sign-up/[[...sign-up]]/page.tsx` | page — same shape for sign-up. After auth Clerk redirects to `CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` (currently `/dashboard`). |
| `/join/[token]` | `src/app/join/[token]/page.tsx` | page — thin shim. Auth-checks; on signed-out, redirects to `/?redirect_url=/join/<token>`; on signed-in, calls `redeemInvite({ tokenOrCode: token })` (owned by `features/household.md`) and `redirect('/dashboard')`. Re-throws Next's `NEXT_REDIRECT` signal so the redirect propagates. |
| `/join/code` | `src/app/join/code/page.tsx` | page — 6-digit code entry form, posts to an inline `'use server'` wrapper that calls `redeemInvite` and `revalidatePath('/dashboard')`. Same auth gate as `/join/[token]`. |
| `/api/webhooks/clerk` (POST) | `src/app/api/webhooks/clerk/route.ts` | api — Svix-verified Clerk webhook. Handles `user.created`/`user.updated` (upsert `profiles` row with email + display_name) and `user.deleted` (hard-delete by `clerk_user_id`). Uses the service-role client. Returns 400 on missing/invalid signature, 500 on misconfiguration or DB error. |
| `/api/cron/dispatch-task-pushes` (GET) | `src/app/api/cron/dispatch-task-pushes/route.ts` | api — Vercel cron, every 5 minutes. Bearer-token gated on `CRON_SECRET`. **Cron driver is here; feature semantics owned by `features/tasks.md`.** Fans out Web Push for due-but-unnotified `task_occurrences` to owner+maid push subscriptions, marks `notified_at`, revokes 410/404 subscriptions. |
| `/api/cron/retry-bill-scans` (GET) | `src/app/api/cron/retry-bill-scans/route.ts` | api — Vercel cron, every 15 minutes. **Cron driver is here; feature semantics owned by `features/scans.md`.** Re-runs Claude Sonnet 4.6 against `bill_scan_attempts` rows in `pending` status, with per-tick batch limit + wallclock budget, attempt counter + 14-minute claim gap, and per-uploader push notifications on success/terminal-failure. |
| `/api/cron/sweep-checked-shopping` (GET) | `src/app/api/cron/sweep-checked-shopping/route.ts` | api — Vercel cron, daily at 16:05 UTC (00:05 SGT). **Cron driver is here; feature semantics owned by `features/shopping.md`.** Calls the `shopping_sweep_checked` RPC which iterates all households and commits every checked-but-not-bought row to inventory. |
| `manifest.webmanifest` | `src/app/manifest.ts` | metadata — Next 16 metadata route. Standalone PWA shell (name/short_name `Zomaid`, `start_url='/'`, `display='standalone'`, `theme_color=#000`). Icons point to the `/icon` and `/apple-icon` dynamic routes. |
| `/icon` | `src/app/icon.tsx` | metadata — dynamic 192×192 OG-style PNG, white "Z" on black. |
| `/apple-icon` | `src/app/apple-icon.tsx` | metadata — dynamic 180×180 PNG with rounded-corner mask. |
| `/sw.js` | `src/app/sw.ts` (compiled by `@serwist/next` to `public/sw.js`) | service-worker — Serwist runtime cache + skipWaiting/clientsClaim + navigation preload. Adds the `push` listener (renders `payload.title`/`payload.body`, tags by `data.occurrenceId`) and `notificationclick` listener (focuses existing `/tasks` window or opens one). Push payload shape lives with `features/tasks.md`. |
| `/admin/bill-scans` | `src/app/admin/bill-scans/page.tsx` | page — admin queue for terminally-failed bill scans. **Owned by `features/scans.md`.** Listed here only because `requireAdmin()` from this spec is the gate. |
| `/admin/tasks` | `src/app/admin/tasks/page.tsx` | page — admin tasks tooling. **Owned by `features/tasks.md`.** Listed here only because `requireAdmin()` from this spec is the gate. |

Public-route matcher in `src/proxy.ts` (`createRouteMatcher`): `/`, `/sign-in(.*)`, `/sign-up(.*)`, `/join/(.*)`, `/api/webhooks/(.*)`, `/api/cron/(.*)`.

Auth-gated matcher: `/dashboard(.*)`, `/household(.*)`, `/inventory(.*)`, `/onboarding(.*)`, `/recipes(.*)`, `/shopping(.*)`, `/bills(.*)`, `/tasks(.*)`, `/admin(.*)`, `/scans(.*)`. The middleware only enforces "signed in or not"; the `/onboarding` ↔ `/dashboard` choice is per-page (`requireHousehold()` / `getCurrentHousehold()`). Anonymous hits on a gated route are redirected to `/` (the landing page, which mounts the Clerk sign-in/up buttons). Other unmatched routes (e.g. typoed paths) are left alone — Next renders its standard 404. The middleware matcher config excludes `_next`, `sw.js`, `manifest.webmanifest`, the icon routes, and a long list of static-asset extensions; `(api|trpc)(.*)` is force-matched.

The `/proxy.ts` filename (rather than the more familiar `middleware.ts`) is the Next 16 convention — see the deprecation note in `node_modules/next/dist/docs/`.

## Server actions
| Action | File | Input shape | Output shape | Called by |
| --- | --- | --- | --- | --- |
| `subscribePush` | `src/app/push/actions.ts:18` | `{ endpoint: url, p256dh: string, auth: string, userAgent?: string≤500 }` (Zod). | `PushActionResult<{ subscriptionId: string }>` — discriminated `ok` union with `PUSH_SUBSCRIPTION_INVALID` error code. | `src/components/tasks/notification-toggle.tsx` (owned by `features/tasks.md`). The action is at `src/app/push/actions.ts` (infrastructure-owned wire) because the wire is generic — any future per-feature push opt-in (e.g. shopping due-soon, bill ready) would call the same surface. Same-endpoint re-subscribe revokes prior rows then inserts. |
| `unsubscribePush` | `src/app/push/actions.ts:51` | `{ endpoint: url }` (Zod). | `PushActionResult<{ revoked: number }>` — discriminated `ok` union. | `src/components/tasks/notification-toggle.tsx` (owned by `features/tasks.md`). Sets `revoked_at = now()` on every active row matching `(profile_id, endpoint)`. |
| `tryRedeemPendingEmailInvite` (helper) | `src/lib/auth/redeem-email-invite.ts` | `profileEmail: string` | `Promise<boolean>` (true if a pending invite was redeemed) | `getCurrentHousehold()` in `src/lib/auth/current-household.ts` only. Side-channel for email-whitelist invites — finds the most-recent unconsumed-unexpired invite by case-insensitive email and calls the `redeem_invite` RPC under the caller's JWT (so RLS sees them). Swallows errors — failed auto-redeem is silent. Not a server action in the React sense (no `"use server"`), but the only `lib/auth` helper that performs writes; listed here for visibility. |

Most `lib/auth/*` helpers are read-only context resolvers, not server actions: `getCurrentProfile()` (`src/lib/auth/current-profile.ts`, returns the caller's profile row, lazy-upserting from Clerk if missing as a backstop for delayed `user.created` webhooks), `getCurrentHousehold()` (`src/lib/auth/current-household.ts`, returns `{ profile, household, membership }` for the most recent active membership), `requireHousehold()` / `requireRole()` / `requirePrivilege()` / `requireAdmin()` (`src/lib/auth/require.ts`, redirect to `/onboarding` / `/dashboard` on failure). All four `require*` helpers are the canonical gate every feature page uses.

Admin env-sync (`src/lib/admin/env-sync.ts`) exposes `syncAdminFlags({ clerkUserIds, pgClient? })` and `readAdminEnv()`. Run from `src/instrumentation.ts` on Node-runtime boot only; it unflags every `profiles.is_admin = true` row not in `ZOMAID_ADMIN_CLERK_USER_IDS`, then flags the ones that are. The `PostgREST update without WHERE` gotcha is dodged with `.neq('clerk_user_id', '__never_admin_sentinel__')` (matches every row). Test path takes a pg client and runs raw SQL — the corrected `profiles_block_protected_columns` trigger (migration `20260515_001`) silently no-ops the is_admin protection when `auth.jwt() ->> 'sub'` is null, which is exactly the boot-task / pg-client case.

## Components
| Component | File | Used by |
| --- | --- | --- |
| `RootLayout` (default) | `src/app/layout.tsx` | every Next.js route. Wraps the whole tree in `<ClerkProvider>`, applies the Geist font (`--font-sans` CSS var), sets viewport (`width=device-width`, `viewportFit=cover`, `themeColor=#000`), and injects the React-19/Turbopack performance-measure dev shim that swallows the `performance.measure(name, { start: 0, end: -Infinity })` TypeError thrown by `react-server-dom-turbopack`'s `flushComponentPerformance` when an RSC chunk's status is `rejected`. **TEMP** — remove once the upstream React 19 RSC perf-track bug is patched. |
| `Home` (default) | `src/app/page.tsx` | Next.js route `/`. Public landing. Server-side `auth()` redirect for signed-in users; renders `<Show when="signed-out">` Clerk modal buttons otherwise. |
| `SignInPage` / `SignUpPage` | `src/app/sign-in/[[...sign-in]]/page.tsx`, `src/app/sign-up/[[...sign-up]]/page.tsx` | Next.js catch-all routes. Each mounts the matching Clerk component (`<SignIn />` / `<SignUp />`) inside a centered main. |
| `JoinTokenPage` / `JoinCodePage` | `src/app/join/[token]/page.tsx`, `src/app/join/code/page.tsx` | Next.js routes. Both delegate redemption to `redeemInvite` from `src/app/household/settings/actions.ts` (owned by `features/household.md`). |
| `MainNav` | `src/components/site/main-nav.tsx` | every authed feature page + their `loading.tsx` skeletons (counted occurrences ≈ 17). Owns the four-tab nav (`Home` → `/dashboard`, `Meal` → `/recipes`, `Shopping` → `/shopping`, `Inventory` → `/inventory`), the inline gear icon linking to `/household/settings`, and Clerk's `<UserButton>`. The gear icon is inlined SVG rather than using `UserButton.MenuItems` because that API is finicky under React 19 / Next 16 dev. **Owned here** — shared site chrome. |
| `Button`, `Card`/`CardContent`/`CardHeader`/`CardTitle`, `Dialog`, `DropdownMenu`, `Input`, `Label`, `PendingButton`, `Sheet`, `Textarea` | `src/components/ui/*` | every feature page that needs a primitive. Standard shadcn forms + `clsx`/`tailwind-merge`-based `cn()` helper from `src/lib/utils.ts`. `PendingButton` is the only non-shadcn primitive — drop-in `Button` replacement that ORs `useFormStatus()` with a caller-supplied `pending?: boolean` (from `useTransition`) and renders a spinner; safe to use outside `<form action={…}>` because `useFormStatus` returns `{ pending: false }` there. |
| `Spinner` (internal to `PendingButton`) | `src/components/ui/pending-button.tsx` | not exported; used only by `PendingButton`. |

Other `src/components/site/*` files (`day-strip.tsx`, `household-mode-card.tsx`, `inventory-prompt-card.tsx`, `owner-invite-maid-card.tsx`, `pending-scans-banner.tsx`, `task-setup-prompt-card.tsx`) are mounted only on `/dashboard` and live under `site/` for historical reasons (early Slice 4–5 work) — they are owned by `features/dashboard.md`. The `site/` directory is not a privileged location; it's just where the dashboard's composites have not been moved to `components/dashboard/`.

## DB surface
| Object | Kind | Introduced in | Notes |
| --- | --- | --- | --- |
| `profiles` | table | `20260510_001_profiles.sql` | **Owned here.** One row per Clerk user. `clerk_user_id` unique. RLS: self-read, self-update (limited columns), admin-read (cross-tenant via `current_is_admin()`). Service-role bypass for the webhook + boot tasks. Insert path is the webhook + the lazy-upsert in `getCurrentProfile()` (with `ignoreDuplicates: true` to survive the race with a webhook landing first). |
| `profiles_block_protected_columns` | trigger | `20260510_001_profiles.sql` (corrected by `20260515_001_admin_trigger_fix.sql`) | **Owned here.** Blocks `id` / `clerk_user_id` changes outright; silently keeps `email` and `is_admin` on updates. The `20260515_001` fix makes `is_admin` protection skip when `auth.jwt() ->> 'sub'` is null so the boot task (`syncAdminFlags`) and the test pg client can flip the flag. |
| `current_profile_id() → uuid` | helper | `20260510_001_profiles.sql` | **Owned here.** `security definer`, stable. Resolves the caller's `profiles.id` from `auth.jwt() ->> 'sub'`. Used by every per-feature RLS policy that scopes by profile. |
| `current_is_admin() → boolean` | helper | `20260510_001_profiles.sql` | **Owned here.** `security definer`. Used by `profiles_admin_read` and by feature-side admin scopes. |
| `touch_updated_at()` | trigger function | `20260512_001_household_memberships.sql` (also reused widely) | **Owned here.** Generic `before update` trigger that bumps `updated_at = now()`. Attached to dozens of tables across features. |
| `households` | table | `20260511_001_households.sql` (read/update policies added in `20260512_001`) | **Owned here.** Read-policy: `has_active_membership(id)`. Update-policy: `is_active_owner(id)`. Insert-policy: creator must equal `current_profile_id()`. The `name`, `diet_preference`, `maid_mode`, `address_line`, `postal_code` columns and their write paths are owned by the consuming feature specs (`features/household.md`, `features/onboarding.md`, `features/dashboard.md`). |
| `household_memberships` | table | `20260512_001_household_memberships.sql` (extended by `20260624_001_diet_preferences.sql` for `diet_preference`) | **Owned here** (the base schema, RLS, and the partial unique indexes). Three enums: `household_role` (`owner`/`family_member`/`maid`), `household_privilege` (`full`/`meal_modify`/`view_only`), `membership_status` (`active`/`pending`/`removed`). Partial unique indexes `hm_unique_active_pair`, `hm_unique_active_maid`, `hm_unique_active_owner` enforce the foundational invariants. RLS: self-read, household-member cross-read, owner-update, self-leave-to-removed, owner-insert. The `diet_preference` column + its writers live in `features/household.md`; the `tasks_member_insert` extension (`20260626_001`) is documented under `features/tasks.md`. |
| `has_active_membership(p_household uuid) → boolean` | helper | `20260512_001_household_memberships.sql` | **Owned here.** `security definer`. Used by RLS in `households`, `invites`, every feature-side household-scoped table. |
| `is_active_owner(p_household uuid) → boolean` | helper | `20260512_001_household_memberships.sql` | **Owned here.** Used by `households_owner_update`, `hm_owner_update`, `hm_owner_insert`, and the owner-only branches in feature-side RLS. |
| `is_active_owner_or_maid(p_household uuid) → boolean` | helper | `20260517_001_recipes.sql` (defined alongside recipes but used app-wide) | **Owned here** (since it's the canonical "household-write-capable user" predicate). Joins `household_memberships → profiles` rather than going through `current_profile_id()` (the recipes migration applied before the helper-extraction pattern was fully consistent — see Open questions). Used by recipes, meal_plans, household_recipe_hides, shopping_list_items, bills, bill_images, tasks, push_subscriptions (none — uses inline clerk_user_id), inventory_items, unit_conversions, inventory helpers, inventory_bill_rpcs, inventory_manual_adjust, household_setup_gates. |
| `invites` | table | `20260513_001_invites.sql` (extended by `20260623_001_invite_emails.sql` for `intended_email`) | **Owned here.** Token (base64url, 32 random bytes) plus a 6-digit `code`. RLS read/insert/update gated on `has_active_membership` + inviter-or-owner. The `code` is partially unique among unconsumed rows; the email column adds a `(household, lower(email))` partial unique for unconsumed-unexpired-with-email rows. Write surface (the `createInvite`/`revokeInvite` actions, the `intended_email` UI affordance) lives in `features/household.md`. |
| `redeem_invite(p_token text) → public.household_memberships` | RPC | `20260514_001_redeem_invite_rpc.sql` (extended by `20260516_001_redeem_invite_duplicate_check.sql`) | **Owned here.** `security definer`, locked `search_path`. Resolves caller via `auth.jwt() ->> 'sub'` (so callers must use the JWT-bearing RLS client, not service-role). Enforces: caller has a `profiles` row (P0001), invite found (P0002), not consumed (P0003), not expired (P0004), no active maid in target household for maid invites (P0005), no active owner for owner invites (P0006), caller is not already a non-removed member (P0007). Inserts the membership and marks the invite consumed in one transaction; row-locks the invite via `for update`. `grant execute … to authenticated`. |
| `diet` | enum | `20260624_001_diet_preferences.sql` | **Owned here** (the enum itself + the strictness ordering `vegan > vegetarian > eggitarian > non_vegetarian` used by `household_strictest_diet`). The enum is consumed by `household_memberships.diet_preference` (owned by `features/household.md`), `households.diet_preference` (owned by `features/household.md`), and `recipes.diet` (owned by `features/recipes.md`). |
| `push_subscriptions` | table | `20260531_001_tasks_and_occurrences.sql` (within the Slice-5 migration) | **Owned here** (the subscription-management surface is cross-cutting; tasks is just the first consumer). Per-profile, not per-household. Unique on `endpoint`. RLS gates everything on `profile_id in (select id from profiles where clerk_user_id = auth.jwt() ->> 'sub')` — i.e. only the owning user can read/insert/update/delete their own rows. `subscribePush` / `unsubscribePush` from `src/app/push/actions.ts` are the only app-side writers; the two cron drivers (`dispatch-task-pushes`, `retry-bill-scans`) update `last_used_at` and `revoked_at` from service-role context. |

External SQL surface **not** owned here but worth naming for the boundary:
- `tasks_generate_occurrences`, `task_occurrences`, `tasks`, `standard_tasks`, `task_picks` → `features/tasks.md`.
- `recipes`, `recipe_*`, `effective_recipes`, `household_strictest_diet`, `household_effective_diet`, `household_recipe_hides`, `recipe_nutrition` → `features/recipes.md`.
- `meal_plans`, `mealplan_*` RPCs → `features/meal-plan.md`.
- `shopping_list_items`, `shopping_*` RPCs, `ingredient_aliases` → `features/shopping.md`.
- `bills`, `bill_line_items`, `bill_images` bucket → `features/bills.md`.
- `bill_scan_attempts`, `bill-scan-pending` bucket → `features/scans.md`.
- `inventory_items`, `inventory_transactions`, `unit_conversions`, inventory RPCs → `features/inventory.md`.
- `household_meal_times`, `households.diet_preference`, `households.maid_mode`, `household_memberships.diet_preference` → `features/household.md` (with `maid_mode` co-owned by `features/dashboard.md`).

## External integrations
- **Clerk (`@clerk/nextjs` and `@clerk/nextjs/server`):** the foundational identity provider.
  - `<ClerkProvider>` mounts at `src/app/layout.tsx` so client components can use `useAuth()` and `<Show>`/`<UserButton>`/`<SignIn>`/etc.
  - `clerkMiddleware` + `createRouteMatcher` in `src/proxy.ts` enforce auth on the gated route list.
  - `auth()` (server) is called by `src/app/page.tsx`, both `/join` pages, every feature-side server action and page (via `getCurrentProfile` → `getCurrentHousehold` → `requireHousehold`).
  - `currentUser()` (server) is called by `getCurrentProfile()` only — needed to read `emailAddresses` + name fields for the lazy-upsert backstop.
  - `useAuth().getToken({ template: 'supabase' })` is the only way the Supabase clients (browser + server) get an `accessToken` — Clerk owns the session entirely.
  - Webhook: `/api/webhooks/clerk` consumes `user.created` / `user.updated` / `user.deleted` events, verified with `svix` against `CLERK_WEBHOOK_SIGNING_SECRET`.
  - Sign-in/up redirect targets are env-driven: `CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` (typically `/dashboard`) is the post-auth landing.
- **Supabase (`@supabase/supabase-js`):**
  - Three client factories, all parameterised on `Database` from `src/lib/db/types.ts`:
    - `useSupabaseClient()` (`src/lib/supabase/client.ts`) — browser-side, memoised via `useMemo`. Forwards Clerk's `getToken({ template: 'supabase' })` via the `accessToken` callback. Uses `@supabase/supabase-js` directly (not `@supabase/ssr`) because the SSR helpers disallow combining `accessToken` with their cookie storage.
    - `createClient()` (`src/lib/supabase/server.ts`) — server-side, async (calls `auth()`). Same `accessToken` pattern. This is the RLS-bearing client; every feature server action and page uses it for caller-scoped reads/writes.
    - `createServiceClient()` (exported from both `src/lib/supabase/server.ts` and `src/lib/supabase/service.ts`) — service-role, bypasses RLS. Used by the Clerk webhook, the cron drivers, `getCurrentProfile()`'s lazy upsert, `syncAdminFlags()`, and a handful of feature server actions where RLS would block a cross-membership read (e.g. owner reading maid's profile email). Server-only; `service.ts` includes a defensive env-var check to fail fast in unconfigured environments.
  - Storage buckets (none are infrastructure-owned — `bill-images`, `bill-scan-pending`, and `recipe-photos` are all owned by their respective feature specs).
- **Vercel Cron:** `vercel.json` (project root) registers three crons:
  - `*/5 * * * *` → `/api/cron/dispatch-task-pushes`.
  - `*/15 * * * *` → `/api/cron/retry-bill-scans`.
  - `5 16 * * *` → `/api/cron/sweep-checked-shopping` (00:05 SGT).
  All three are bearer-token gated on `CRON_SECRET` via `Authorization: Bearer …`; misconfiguration returns 500. The cron handlers themselves live next to the relevant feature in `src/app/api/cron/*` but the driver shape (auth, batching, return JSON) is the same for all three.
- **web-push (`web-push` npm):** `src/lib/push/webpush.ts` wraps `setVapidDetails` + `sendNotification`. Validates `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` on first call; throws a clear error on misconfiguration. Returns a discriminated `{ ok: true } | { ok: false; gone; status; message }` — the `gone` flag is set on HTTP 410 (subscription expired) or 404 (subscription not found), which the cron drivers use to set `push_subscriptions.revoked_at`. The only consumers are the two push-using cron drivers (`dispatch-task-pushes`, `retry-bill-scans`); the in-app `subscribePush` / `unsubscribePush` actions don't actually send pushes, they just register/revoke the browser subscription.
- **Svix (`svix` npm):** the Clerk webhook signature verifier. Only used in `/api/webhooks/clerk/route.ts`.
- **Serwist (`@serwist/next`, `serwist`):** the PWA toolchain. `next.config.ts` wires `withSerwistInit({ swSrc: 'src/app/sw.ts', swDest: 'public/sw.js' })` with `disable: process.env.NODE_ENV === 'development'` (no service worker in dev). `src/app/sw.ts` creates a `Serwist` instance with `defaultCache`, `precacheEntries: self.__SW_MANIFEST`, `skipWaiting: true`, `clientsClaim: true`, `navigationPreload: true`, and adds the `push` and `notificationclick` handlers. The middleware matcher in `src/proxy.ts` explicitly skips `sw.js` and `manifest.webmanifest` so they're not auth-gated.
- **`next/font/google` (Geist):** `src/app/layout.tsx` mounts Geist with `--font-sans` CSS var; consumed by `globals.css`'s `@theme inline { --font-sans: var(--font-sans); }`.
- **`next/og` (`ImageResponse`):** used by `src/app/icon.tsx` and `src/app/apple-icon.tsx` to render dynamic PWA icons.
- **Tailwind v4 + shadcn:** `src/app/globals.css` imports `tailwindcss`, `tw-animate-css`, and `shadcn/tailwind.css`. `cn()` in `src/lib/utils.ts` is the standard `clsx` + `tailwind-merge` combinator used by every UI component.
- **`siteUrl()` (`src/lib/site-url.ts`):** infrastructure helper that reads request headers (`host`, `x-forwarded-proto`) to build a fully-qualified URL without an env var. Only used by `features/household.md` (the invites card mints `${siteUrl()}/join/${token}`) — listed here because the helper is cross-cutting and could be reused by any future link-building surface.

No Anthropic SDK calls are made from infrastructure-owned code. The two callers (`/api/bills/scan/route.ts` + `_sonnet.ts`, and the bill-scan retry cron's `runSonnetBillScan`) both belong to `features/scans.md` (the latter is invoked by the infrastructure-owned cron driver but the helper itself, the API key plumbing, and the parse logic are scans-feature concerns).

No Sentry or other dedicated observability integration; the dev shim in `src/app/layout.tsx` is the only error-suppression path.

## Open questions
- **`src/components/site/` is a legacy bucket.** Six of the seven files there (`day-strip`, `household-mode-card`, `inventory-prompt-card`, `owner-invite-maid-card`, `pending-scans-banner`, `task-setup-prompt-card`) are mounted only from `/dashboard` and are owned by `features/dashboard.md`. Only `main-nav.tsx` is genuinely cross-cutting site chrome. Either move the dashboard composites to `src/components/dashboard/` and keep `site/` for true site chrome (`MainNav`, future footer, etc.), or leave the directory as-is and document the convention.
- **`is_active_owner_or_maid` is defined in the recipes migration (`20260517_001`).** Every other foundational helper lives in `20260510_001` or `20260512_001`. The recipes migration was the first writer that needed the predicate and it ended up there; moving it to the foundations migration set would require either (a) a migration that drops + recreates it from a new file, or (b) accepting the historical placement. Documented here so future readers know to look for it in the recipes migration.
- **`HouseholdModeCard`, `OwnerInviteMaidCard`, `TaskSetupPromptCard`, `InventoryPromptCard`, `PendingScansBanner`, `DayStrip` all live in `src/components/site/`** despite being feature-scoped. See first bullet.
- **`/instrumentation.ts` only runs on Node runtime** (`process.env.NEXT_RUNTIME === 'nodejs'`). Edge-runtime invocations of the Clerk webhook or any future edge route will skip env-sync — that's correct (env-sync is a boot-once task), but the guard means hot module replacement in dev does not re-run it. If the admin-user list changes in `.env.local`, the dev server needs a full restart for the flags to update. Could be surfaced as a doc note rather than a code change.
- **`getCurrentProfile()` upsert race with `user.created` webhook.** Documented in code: `ignoreDuplicates: true` on the upsert + a follow-up `select` is the chosen race resolver. The webhook's `onConflict: 'clerk_user_id'` (no `ignoreDuplicates`) is authoritative on `email`/`display_name` if the webhook lands first. This works but is subtle; a single helper that both call-sites delegate to could eliminate the inline duplication.
- **The dev `performance.measure` shim in `RootLayout` is a TODO with no tracking issue.** The comment block calls out the upstream React 19 RSC perf-track bug. Either link a tracked issue or accept the indefinite shim. Risk is low (dev-only, dangerouslySetInnerHTML body is short and constant).
- **Public route matcher allows `/api/cron/(.*)` past the auth gate.** The cron handlers themselves enforce `Authorization: Bearer $CRON_SECRET`. That's correct, but the public-route allowlist looks scarier than it is at a glance — a comment on the matcher (or a tighter matcher) would help. Same for `/api/webhooks/(.*)` (Svix signature is the gate).
- **`auth-gated` matcher in `src/proxy.ts` is a *redirect* signal, not an *enforcement*.** Any path that's not in the gated list AND not signed in falls through to render normally. Today there are no such routes (every authed surface is in the list), but if a new authed route lands without being added, the page itself will need to call `requireHousehold()` (it would anyway) to be safe. The two are belt-and-braces; document as a deliberate redundancy.
- **No `tests/api/` directory** despite three cron handlers + one webhook handler. Coverage of bearer-token rejection, Svix-signature rejection, and the lazy-upsert race in `getCurrentProfile()` would go here. Phase 2 will populate the test coverage table.
- **`tryRedeemPendingEmailInvite` swallows RPC errors silently.** That's the documented behaviour (failed auto-redeem falls through to the no-household flow), but there's no telemetry hook — a chronically-failing invite is invisible. Could add a `console.warn` or an admin-visible counter without changing the silent-to-user contract.

## Test coverage

Cron-driver entries below are listed here because the routes themselves (bearer-token gating, return JSON shape, scheduling) are infra concerns. Their underlying feature RPCs (`shopping_sweep_checked`, `dispatch-task-pushes` payload semantics, `runSonnetBillScan`) are owned by — and tracked from — the consuming feature specs.

| Code unit | File | Unit | Integration | E2E | Priority gap | Recommended test type |
| --- | --- | --- | --- | --- | --- | --- |
| `createClient` (RLS-scoped server client) | `src/lib/supabase/server.ts` | — | — | — | high | `tests/auth/` |
| `createServiceClient` | `src/lib/supabase/server.ts`, `src/lib/supabase/service.ts` | — | — | — | high | `tests/auth/` |
| `getCurrentHousehold()` (incl. lost-membership fallthrough) | `src/lib/auth/current-household.ts` | — | — | — | high | `tests/auth/` |
| `getCurrentProfile()` (lazy upsert race with webhook) | `src/lib/auth/current-profile.ts` | — | — | — | high | `tests/auth/` |
| `GET /api/cron/dispatch-task-pushes` (driver: bearer gate, return shape) | `src/app/api/cron/dispatch-task-pushes/route.ts` | — | — | — | high | `tests/actions/` (route test) |
| `GET /api/cron/retry-bill-scans` (driver: bearer gate, return shape) | `src/app/api/cron/retry-bill-scans/route.ts` | — | — | — | high | `tests/actions/` (route test) |
| `GET /api/cron/sweep-checked-shopping` (driver: bearer gate, return shape) | `src/app/api/cron/sweep-checked-shopping/route.ts` | — | — | — | high | `tests/actions/` (route test) |
| `POST /api/webhooks/clerk` (Svix verify, user.created/updated/deleted) | `src/app/api/webhooks/clerk/route.ts` | — | — | — | high | `tests/actions/` (route test) |
| `requireAdmin()` | `src/lib/auth/require.ts` | — | — | — | high | `tests/auth/` |
| `requireHousehold()` | `src/lib/auth/require.ts` | — | — | — | high | `tests/auth/` |
| `requirePrivilege()` (incl. order map) | `src/lib/auth/require.ts` | partial via `tests/auth/helpers.test.ts` (privilege-order map copy only) | — | — | high | `tests/auth/` |
| `requireRole()` | `src/lib/auth/require.ts` | — | — | — | high | `tests/auth/` |
| `sendWebPush()` (incl. 410/404 → `gone` flag) | `src/lib/push/webpush.ts` | — | — | — | high | `tests/unit/` |
| `current_is_admin()` helper | `supabase/migrations/20260510_001_profiles.sql` | — | — | — | medium | `tests/db/` |
| `current_profile_id()` helper | `supabase/migrations/20260510_001_profiles.sql` | — | — | — | medium | `tests/db/` |
| `has_active_membership(p_household)` helper | `supabase/migrations/20260512_001_household_memberships.sql` | — | — | — | medium | `tests/db/` |
| `Home` (`/`) signed-in redirect branch | `src/app/page.tsx` | — | — | partial via `tests/e2e/foundations.spec.ts` (sign-in CTA only) | medium | `tests/e2e/` |
| `is_active_owner(p_household)` helper | `supabase/migrations/20260512_001_household_memberships.sql` | — | — | — | medium | `tests/db/` |
| `is_active_owner_or_maid(p_household)` helper | `supabase/migrations/20260517_001_recipes.sql` | — | — | — | medium | `tests/db/` |
| `JoinCodePage` (`/join/code`) | `src/app/join/code/page.tsx` | — | — | — | medium | `tests/e2e/` |
| `JoinTokenPage` (`/join/[token]`) | `src/app/join/[token]/page.tsx` | — | — | — | medium | `tests/e2e/` |
| `MainNav` | `src/components/site/main-nav.tsx` | — | — | — | medium | `tests/e2e/` |
| `push_subscriptions` RLS (per-profile scoping) | `supabase/migrations/20260531_001_tasks_and_occurrences.sql` | — | — | — | medium | `tests/db/` |
| `readAdminEnv()` | `src/lib/admin/env-sync.ts` | — | — | — | medium | `tests/admin/` |
| `SignInPage` / `SignUpPage` | `src/app/sign-in/[[...sign-in]]/page.tsx`, `src/app/sign-up/[[...sign-up]]/page.tsx` | — | — | — | medium | `tests/e2e/` |
| `siteUrl()` (header-derived origin) | `src/lib/site-url.ts` | — | — | — | medium | `tests/unit/` |
| `src/proxy.ts` (public/auth-gated route matcher) | `src/proxy.ts` | — | — | partial via `tests/e2e/{foundations,inventory,shopping,bills,tasks,recipes-plan}.spec.ts` (unauth → `/` redirects) | medium | `tests/e2e/` |
| `touch_updated_at()` trigger | `supabase/migrations/20260512_001_household_memberships.sql` | — | — | — | medium | `tests/db/` |
| `useSupabaseClient()` (browser client; Clerk token forwarding) | `src/lib/supabase/client.ts` | — | — | — | medium | `tests/unit/` |
| `apple-icon` route | `src/app/apple-icon.tsx` | — | — | — | low | `tests/unit/` |
| `cn()` helper | `src/lib/utils.ts` | — | — | — | low | `tests/unit/` |
| `diet` enum + strictness ordering | `supabase/migrations/20260624_001_diet_preferences.sql` | — | `tests/db/household-diet-preference.test.ts` (exercises ordering via `household_effective_diet`) | — | low | — |
| `icon` route | `src/app/icon.tsx` | — | — | — | low | `tests/unit/` |
| `manifest.webmanifest` | `src/app/manifest.ts` | — | — | — | low | `tests/unit/` |
| `PendingButton` (incl. `useFormStatus` outside `<form>`) | `src/components/ui/pending-button.tsx` | — | — | — | low | `tests/unit/` |
| `RootLayout` (Geist font, perf-measure dev shim) | `src/app/layout.tsx` | — | — | — | low | `tests/unit/` |
| Shadcn UI primitives (`Button`, `Card`, `Dialog`, `DropdownMenu`, `Input`, `Label`, `Sheet`, `Textarea`) | `src/components/ui/*` | — | — | — | low | `tests/unit/` |
| `sw.ts` service worker (push + notificationclick handlers) | `src/app/sw.ts` | — | — | — | low | `tests/unit/` |
| `households` table RLS | `supabase/migrations/20260511_001_households.sql`, `20260512_001_household_memberships.sql` | — | `tests/db/households.test.ts` | — | none | — |
| `household_memberships` table RLS + invariants | `supabase/migrations/20260512_001_household_memberships.sql` | — | `tests/db/memberships.test.ts` | — | none | — |
| `invites` table RLS + visibility | `supabase/migrations/20260513_001_invites.sql` | — | `tests/db/invites.test.ts` | — | none | — |
| `profiles` table RLS | `supabase/migrations/20260510_001_profiles.sql` | — | `tests/db/profiles.test.ts` | — | none | — |
| `profiles_block_protected_columns` trigger | `supabase/migrations/20260510_001_profiles.sql`, `20260515_001_admin_trigger_fix.sql` | — | `tests/db/profiles.test.ts` (is_admin denial under auth context); `tests/admin/env-sync.test.ts` (null-jwt boot-task path) | — | none | — |
| `redeem_invite(p_token)` RPC | `supabase/migrations/20260514_001_redeem_invite_rpc.sql`, `20260516_001_redeem_invite_duplicate_check.sql` | — | `tests/db/invites.test.ts`, `tests/actions/invites.test.ts` | — | none | — |
| `syncAdminFlags()` boot task | `src/lib/admin/env-sync.ts` | — | `tests/admin/env-sync.test.ts` | — | none | — |

`tryRedeemPendingEmailInvite` (`src/lib/auth/redeem-email-invite.ts`) is listed under Server actions for visibility but its gap row lives in `features/household.md` (where the email-whitelist UI + semantics are owned). Likewise `subscribePush` / `unsubscribePush` gap rows live in `features/tasks.md`.
