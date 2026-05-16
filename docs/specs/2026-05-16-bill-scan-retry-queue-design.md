# Zomaid — Bill-Scan Retry Queue — Design

> **Superseded as the living architecture doc for the bills area by [`features/bills.md`](features/bills.md).** This dated spec is retained for historical context.

- **Date**: 2026-05-16
- **Status**: Approved (no clarifications outstanding) — implementing in same session
- **Scope**: When the synchronous Claude Sonnet 4.6 bill scan on `/inventory/new`
  fails (timeout, 5xx, malformed JSON, network), persist the user's uploaded
  image in a private Supabase bucket and enqueue a retry attempt. A Vercel cron
  (every 15 min) picks up pending attempts, retries the parse up to 3 times,
  and on success drops the parsed payload into a `/scans/pending` review page
  that reuses the existing confirmation form. On 3 failures the attempt is
  surfaced in a new `/admin/bill-scans` queue for manual intervention.

## 1. Context

The Upload-Bill tab on [/inventory/new](../../src/app/inventory/new/page.tsx)
makes a synchronous call to [POST /api/bills/scan](../../src/app/api/bills/scan/route.ts),
which calls Claude Sonnet 4.6 with the user's photo and returns a parsed bill
that the [_bill-form.tsx](../../src/app/inventory/new/_bill-form.tsx) renders
into an editable confirmation form. When that call fails (intermittent Anthropic
5xx, network blip, JSON-schema mismatch) the user sees a friendly error and has
to re-pick + re-upload — annoying when the image was fine and the upstream just
hiccuped.

This spec adds a **background retry queue** that swallows the failure
gracefully, holds the image, retries on a cron, and either delivers the parsed
result to a review page or escalates to an admin queue after 3 strikes.

## 2. Decisions log (user-approved up front)

| Q | Decision |
|---|---|
| Cron interval | **15 min** (`*/15 * * * *`). Acceptable worst-case wait ≈ 15 min. |
| Retain images on success | **Yes — no deletion code.** Bucket retention is whatever Supabase defaults are. |
| Admin gating | Reuse existing `profiles.is_admin` (set on boot from `ZOMAID_ADMIN_CLERK_USER_IDS`). Use `requireAdmin()` helper. |
| Sync happy path | **Unchanged.** Only the failure branch is new. |
| Max attempts | 3 (column default; configurable per-row but global default is 3). |
| Retry strategy | Same Sonnet 4.6 call each time. No multi-prompt or model fallback. |
| Image storage | New private bucket `bill-scan-pending`. Path: `<householdId>/<uuid>.<ext>`. Service-role only — no user RLS policies on storage. |
| Auth on queue page | `requireHousehold()`. List shows the caller's attempts only. |
| Discard from review | Sets `reviewed_at = now()` without creating a bill. Row stays for audit. |
| Failed-row "cancel" | Same — sets `reviewed_at = now()`, no delete. |
| Push notifications | Reuse existing `sendWebPush`. Notify the **uploader** only (not the whole household). |
| Cron lock | Soft via `last_attempted_at < now() - interval '14 minutes'` window. 14 (not 15) avoids a tick-boundary race. |
| Concurrent claim | Single transaction `update ... returning *` claims up to 10 rows per cron tick. |
| Total budget per tick | 60s wall-clock (10 attempts × ~6s Sonnet average). |
| `produced_bill_id` | Populated when the user finalises a succeeded attempt via the review form. Useful for support follow-ups. |

## 3. Architecture

```
[/api/bills/scan POST]
        │  try Sonnet (existing)
        │
   ┌────┴────┐
   ▼         ▼
[ok=true]  [Sonnet failed | parse failed | timeout]
   │         │  service-client → put image in bill-scan-pending bucket
   │         │  insert bill_scan_attempts row, status='pending', attempts=1
   │         ▼
   │      return { ok:false, error:{ code:"BILL_SCAN_QUEUED", attemptId, message } }
   │                          │
   │                          ▼
   │            client shows "we'll retry, see /scans/pending"
   │
   ▼
sync confirmation form (unchanged)

──────────────────────────────────────────────────────────

[Vercel cron, */15 * * * *]
        │  GET /api/cron/retry-bill-scans (Bearer CRON_SECRET)
        │  service-client picks ≤10 rows where:
        │     status='pending' AND attempts < max_attempts
        │     AND (last_attempted_at IS NULL OR last_attempted_at < now() - interval '14 min')
        │  for each row:
        │     - download image from bill-scan-pending
        │     - call Sonnet (same helper)
        │     - on success: status='succeeded', parsed_payload=…, push uploader
        │     - on fail: attempts++, last_error=…; if attempts >= max_attempts:
        │         status='failed', push uploader (different message)
        ▼
returns { processed, succeeded, failed, stillPending }

──────────────────────────────────────────────────────────

[/scans/pending]
    user sees rows where uploaded_by_profile_id = caller
    grouped by: succeeded-unreviewed | pending | failed
    succeeded-unreviewed:
        ▶ "Review & save" → opens the existing _bill-form.tsx confirmation
           UI prefilled from parsed_payload; on save calls uploadBillFromScan
           with an optional new `attemptId` param → server action stamps
           reviewed_at + produced_bill_id on the attempt row after the bill insert.
        ▶ "Discard" → sets reviewed_at = now(), no bill created.
    pending: informational only.
    failed:  badge + "Cancel" (sets reviewed_at).

──────────────────────────────────────────────────────────

[/admin/bill-scans] (requireAdmin)
    lists status='failed' rows across all households, newest first.
    per-row admin actions:
        ▶ "Reset to pending"  status='pending', attempts=0, last_error=null
        ▶ "Mark resolved"     reviewed_at = now()
```

## 4. Migration: `supabase/migrations/20260629_001_bill_scan_retries.sql`

Spec provides the full SQL. Adds:

- `bill_scan_attempts` table (with status enum check, `parsed_payload jsonb`,
  `produced_bill_id` FK to `bills`, `reviewed_at` audit column, `updated_at`
  trigger).
- Three indexes:
  - partial on `last_attempted_at` for cron pick-up (`status='pending' AND
    attempts < max_attempts`)
  - partial on `uploaded_by_profile_id` for the user's unreviewed queue
  - regular on `household_id` for the household-scoped view
- RLS policies:
  - `bsa_self_read` — uploader sees their own (any status).
  - `bsa_household_read` — active household members can see attempts for their
    household. (No current consumer, but cheap to add and we may surface
    "Maya has 2 pending scans" on the household card later.)
  - `bsa_admin_read` — admins see everything.
  - **No write policies.** All writes go through service-role (cron worker,
    `/api/bills/scan`, admin actions).
- `touch_updated_at` trigger (function already exists from earlier slices).
- `bill-scan-pending` storage bucket (private). No storage RLS — service-role
  only, accessed via signed URLs for thumbnails on the review pages.

## 5. Code changes

### 5.1 `src/lib/db/types.ts`

Add `bill_scan_attempts` to `Database["public"]["Tables"]`. Row/Insert/Update
shape mirrors the SQL column list. `status` typed as
`"pending" | "succeeded" | "failed"`.

### 5.2 `src/app/api/bills/scan/route.ts`

- Extract the existing Sonnet call into an internal helper
  `runSonnetScan(base64, mediaType, apiKey)` that returns
  `{ ok: true, data } | { ok: false, message }`. Pure logic — no NextResponse.
- POST handler:
  1. `requireHousehold` + role check (unchanged — **no queueing for
     unauthenticated callers**).
  2. Validate the file (unchanged).
  3. Call `runSonnetScan`.
  4. On `ok: true`: return `{ ok: true, data }` (existing happy path).
  5. On `ok: false`: upload the image to `bill-scan-pending/<householdId>/<uuid>.<ext>`
     via service client, insert a `bill_scan_attempts` row with
     `status='pending', attempts=1, last_attempted_at=now(), last_error=…`,
     and return:
     ```json
     { "ok": false, "error": {
        "code": "BILL_SCAN_QUEUED", "attemptId": "<uuid>",
        "message": "We couldn't read the bill on the first try. We'll retry automatically — you'll get a push notification when it's ready (usually under an hour)."
     }}
     ```
     Status code 202 (accepted, async work pending).

### 5.3 New: `src/app/api/cron/retry-bill-scans/route.ts`

- Bearer-secret gate matching `dispatch-task-pushes`. **Reuses same `CRON_SECRET` env var.**
- `const BATCH_LIMIT = 10`, `const WALLCLOCK_BUDGET_MS = 60_000`.
- Select up to 10 candidate rows; for each one:
  - `download(storage_path)` from `bill-scan-pending` (skip + mark error if missing).
  - Call the same Sonnet helper.
  - On success: update row (`status='succeeded'`, `parsed_payload`, `attempts++`,
    `last_attempted_at=now()`, `last_error=null`), then push uploader.
  - On failure: update row (`attempts++`, `last_attempted_at=now()`,
    `last_error=…`). If `attempts >= max_attempts`: also set
    `status='failed'` and push uploader with the "admin will take a look" copy.
  - Break early if cumulative elapsed > 60s.
- Return `{ processed, succeeded, failed, stillPending }`.

### 5.4 New: `src/app/scans/pending/page.tsx`

- Server component. `requireHousehold`.
- Fetch caller's attempts where `(status='succeeded' AND reviewed_at IS NULL) OR
  status='pending' OR (status='failed' AND reviewed_at IS NULL)`.
- For each succeeded row, generate a signed URL (60 s TTL) for the thumbnail.
- Render three grouped sections: "Ready to review" (succeeded-unreviewed),
  "In progress" (pending), and "Couldn't read" (failed-unreviewed).
- Succeeded rows expand inline into the same confirmation UI as
  [_bill-form.tsx](../../src/app/inventory/new/_bill-form.tsx). To avoid
  copy-pasting 350 lines of UI, the existing form is extracted into a shared
  `BillConfirmForm` client component (props: initial `ParsedBill`, optional
  `attemptId`, `onDone` callback). Both `_bill-form.tsx` (after a sync scan)
  and the new pending-scan card pre-fill via the same component. Discard
  button → server action `discardPendingScan(attemptId)` → sets `reviewed_at`.
- Failed rows: badge "An admin is reviewing" + "Cancel" button → server action
  `cancelFailedScan(attemptId)` → sets `reviewed_at`.

### 5.5 New: `src/app/scans/actions.ts`

Server actions (service-role, internally re-verifies caller-owned rows):

- `discardPendingScan({ attemptId })` — caller's row only; sets `reviewed_at`.
- `cancelFailedScan({ attemptId })` — caller's row only; sets `reviewed_at`.

### 5.6 New: `src/app/admin/bill-scans/page.tsx` + actions

- `requireAdmin()`. Server component lists all `status='failed' AND
  reviewed_at IS NULL` rows newest-first.
- Joins uploader (`profiles.display_name`) and household (`households.name`).
- Per-row signed URL for the image preview.
- Actions:
  - `resetBillScan({ attemptId })` — `status='pending'`, `attempts=0`,
    `last_error=null`. Cron picks up on the next tick.
  - `resolveBillScan({ attemptId })` — `reviewed_at=now()`.

### 5.7 `src/app/bills/actions.ts` — extend `uploadBillFromScan`

Add an optional `attemptId?: string` field to `UploadBillFromScanSchema`.
After a successful bill insert, if `attemptId` is present:

```ts
await supabase
  .from("bill_scan_attempts")
  .update({ reviewed_at: new Date().toISOString(), produced_bill_id: billId })
  .eq("id", attemptId);
```

Best-effort — failure to stamp the attempt is logged but doesn't roll back
the bill insert.

### 5.8 `src/app/inventory/new/_bill-form.tsx`

- Refactor the confirmation form body into a new shared component
  `src/components/bills/bill-confirm-form.tsx` (props in §5.4). Existing flow
  unchanged from the user's perspective.
- Handle the new `BILL_SCAN_QUEUED` response: skip the existing
  red-error-message path and render a friendly notice with a link to
  `/scans/pending`. Don't auto-redirect.

### 5.9 `src/components/site/main-nav.tsx`

- Show a small dot badge on the "Inventory" tab when the caller has
  succeeded-unreviewed attempts. Implemented as a server component side-fetch
  on the main nav (cheap — one indexed query).

### 5.10 `vercel.json`

Add second cron entry, preserve the existing task-pushes one. Final shape:

```json
{
  "crons": [
    { "path": "/api/cron/dispatch-task-pushes", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/retry-bill-scans",      "schedule": "*/15 * * * *" }
  ]
}
```

### 5.11 `.env.local.example`

`CRON_SECRET` already exists. Add a short comment noting the new cron also reads it.

## 6. Tests

- Reuse the existing `bill-scan-parse.test.ts` for parser logic.
- New unit test for the cron's attempt-selection predicate
  (`shouldRetry(row, now)`) and the storage-path builder.

## 7. Out of scope

- Cleanup cron for old `bill-scan-pending` files (we keep them per design).
- Email notifications. Push only.
- Multi-prompt / model fallback on retry.
- Real Anthropic API calls during verification.
- Streaming events to the pending page (user can refresh).
- Per-household admin queue. One global queue is fine for now.

## 8. Risks

- **Push subscription not present.** The push notification is best-effort
  (`uploaded_by_profile_id` may not have an active push sub). The user can
  still see the result on `/scans/pending` via the nav badge.
- **Sonnet still flaky.** If Anthropic is down for hours, attempts accumulate
  in `failed` and the admin queue grows. Acceptable — admin can mass-reset
  once Anthropic recovers.
- **Storage cost.** ~1 MB per attempt. Negligible at expected volume
  (tens per day). No retention cap needed for v1.
