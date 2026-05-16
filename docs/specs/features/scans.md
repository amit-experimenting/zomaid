# Scans — architecture

**Status:** active
**Last reviewed:** 2026-05-16

The "scans" feature is the OCR pipeline that turns a photo of a paper bill into a parsed `ParsedBill` JSON the rest of the app can store. It owns the upload endpoint, the Anthropic Claude Sonnet 4.6 vision call, the retry queue + Vercel cron, the user-facing `/scans/pending` review surface, and the `/admin/bill-scans` admin tooling. It is intentionally distinct from:

- `features/bills.md` — owns the `bills` / `bill_line_items` data model, the `BillConfirmForm`, the `uploadBillFromScan` server action, and the `/bills/[id]` detail page (consumers of this feature's output).
- `features/inventory.md` — owns the `inventory_items` writes and the `inventory_bill_ingest` RPC (downstream of `uploadBillFromScan`, not of scans directly).

Everything under `src/app/api/bills/scan/*` lives under a `bills`-prefixed path for historical reasons (the bills feature was the first OCR consumer) but is owned here. `features/bills.md` lists those files as a courtesy locator and reiterates this ownership boundary.

## Routes
| Route | File | Type |
| --- | --- | --- |
| `/scans/pending` | `src/app/scans/pending/page.tsx` | page (caller's queue) |
| `/scans` (server actions) | `src/app/scans/actions.ts` | server-actions (`discardPendingScan`, `cancelFailedScan`) |
| `/admin/bill-scans` | `src/app/admin/bill-scans/page.tsx` | page (admin queue, `requireAdmin`-gated) |
| `/admin/bill-scans` (server actions) | `src/app/admin/bill-scans/actions.ts` | server-actions (`resetBillScan`, `resolveBillScan`) |
| `POST /api/bills/scan` | `src/app/api/bills/scan/route.ts` | API route (synchronous Sonnet call + on-failure queue) |
| `GET /api/cron/retry-bill-scans` | `src/app/api/cron/retry-bill-scans/route.ts` | Vercel cron, `*/15 * * * *` |
| `/api/bills/scan/_parse` (module) | `src/app/api/bills/scan/_parse.ts` | pure parser helper — bill-level header + line items |
| `/api/bills/scan/_sonnet` (module) | `src/app/api/bills/scan/_sonnet.ts` | Claude Sonnet 4.6 client + prompt |
| `/api/bills/scan/_storage` (module) | `src/app/api/bills/scan/_storage.ts` | `bill-scan-pending` path helpers + `shouldRetryAttempt` predicate |
| `/api/inventory/scan/_parse` (module) | `src/app/api/inventory/scan/_parse.ts` | shared unit / name / quantity normaliser — imported by `_parse.ts` above |

There is no `/scans` index page and there is no `/api/inventory/scan/route.ts`. The only inventory-scan-shaped folder under `src/app/api/` contains a single `_parse.ts` module of pure helpers (`SCAN_UNITS`, `coerceUnit`, `normalizeName`, `normalizeQuantity`, `parseScanResponse`, plus the `ScanUnit` type). That module is **not orphaned** — the bill-scan parser imports `coerceUnit` / `normalizeName` / `normalizeQuantity` / `ScanUnit` from it, so it is the canonical unit-coercion library for the scans feature. `tests/unit/inventory-scan-parse.test.ts` covers it directly. See Open questions for the misleading folder location. (`features/inventory.md` previously flagged this file as orphaned — that flag is incorrect and is superseded by this spec.)

Entry points into the pipeline:

- `/inventory/new?mode=scan` (owned by `features/inventory.md` for the mount; the `UploadBillForm` client at `src/app/inventory/new/_bill-form.tsx` posts to `POST /api/bills/scan`). The form compresses the image client-side via `browser-image-compression` (max 1 MB, max 1920 px), then `fetch`es the API.
- The API route returns one of three things:
  1. `{ ok: true, data: ParsedBill & { imageStoragePath } }` on a sync Sonnet success (image already persisted into `bill-images`). The form transitions to `BillConfirmForm`.
  2. `{ ok: false, error: { code: "BILL_SCAN_QUEUED", attemptId, message } }` with HTTP 202 on any Sonnet failure (timeout, 5xx, malformed JSON, missing text block). The image is stashed in `bill-scan-pending/<household>/<attemptId>.<ext>` and a `bill_scan_attempts` row is inserted with `status='pending'`, `attempts=1`, `last_attempted_at=now()`, `last_error=<sonnet message>`. The form shows a banner with a link to `/scans/pending`.
  3. `{ ok: false, error: { code: <other> } }` on validation / config / forbidden errors. Codes: `BILL_FORBIDDEN` (caller is not `owner`/`maid`), `BILL_NOT_CONFIGURED` (missing `ANTHROPIC_API_KEY`), `BILL_INVALID_FILE` (missing / empty / wrong-MIME / >10 MB image), `BILL_SCAN_FAILED` (Sonnet failed AND we could not even stash the image — only path that does **not** queue).
- `/scans/pending` reads `bill_scan_attempts` for the calling profile and partitions rows into three sections (`succeeded ∧ ¬reviewed`, `pending`, `failed ∧ ¬reviewed`). Succeeded rows expand into the same `BillConfirmForm` (owned by `features/bills.md`) pre-filled from `parsed_payload`. Failed rows can be cancelled.
- `/admin/bill-scans` reads `status='failed' ∧ ¬reviewed` cross-tenant for the admin role, with uploader + household name lookups and signed thumbnail URLs.
- The cron worker picks up `status='pending' ∧ attempts < max_attempts ∧ (last_attempted_at IS NULL OR last_attempted_at < now() - 14m)`, retries Sonnet via the shared `_sonnet.ts` helper, and either marks the row `succeeded` (with `parsed_payload`) or increments `attempts`. After `max_attempts` (default 3), the row transitions to `failed`. Web Push notifications fire on terminal transitions (succeeded → "ready to review", failed → "admin is looking").

## Server actions
| Action | File | Input shape | Output shape | Called by |
| --- | --- | --- | --- | --- |
| `discardPendingScan` | `src/app/scans/actions.ts:18` | `{ attemptId (uuid) }` via `AttemptIdSchema` (Zod). Service-role update stamping `reviewed_at = now()` scoped to caller's own succeeded-and-unreviewed row. | `ScanActionResult` (`{ ok: true } \| { ok: false, error: { code, message } }`); codes `SCAN_INVALID`, `SCAN_DB` | `src/app/scans/pending/_review-card.tsx` (`SucceededAttemptCard.onDiscard`) |
| `cancelFailedScan` | `src/app/scans/actions.ts:45` | `{ attemptId (uuid) }` via `AttemptIdSchema`. Same effect as discard (stamps `reviewed_at`) but on the caller's own failed-and-unreviewed row. Distinct action only so the UI copy ("Cancel" vs "Discard") can be tuned. | `ScanActionResult` | `src/app/scans/pending/_failed-card.tsx` (`FailedAttemptCard.onCancel`) |
| `resetBillScan` | `src/app/admin/bill-scans/actions.ts:19` | `{ attemptId (uuid) }`. Resets `status='pending'`, `attempts=0`, `last_error=null`, `last_attempted_at=null` so the cron treats it like a fresh row. The image stays put in `bill-scan-pending`. | `AdminBillScanResult` (`{ ok: true } \| { ok: false, error: { code, message } }`); codes `ADMIN_SCAN_INVALID`, `ADMIN_SCAN_DB` | `src/app/admin/bill-scans/_client.tsx` (`AdminBillScansClient.reset`) |
| `resolveBillScan` | `src/app/admin/bill-scans/actions.ts:48` | `{ attemptId (uuid) }`. Stamps `reviewed_at = now()` without creating a bill or re-queueing. | `AdminBillScanResult` | `src/app/admin/bill-scans/_client.tsx` (`AdminBillScansClient.resolve`) |

All four actions gate via `requireHousehold` (caller actions) or `requireAdmin` (admin actions) from `src/lib/auth/require.ts`. `requireAdmin` resolves the caller's profile and redirects to `/dashboard` unless `profiles.is_admin = true`; the flag is managed by env-sync on boot (`ZOMAID_ADMIN_CLERK_USER_IDS`) plus the Clerk webhook's lazy upsert. RLS is intentionally **not** the gate for writes on `bill_scan_attempts` — the table has no user-writable RLS policy by design, so every server action uses the service-role client (`createServiceClient` from `src/lib/supabase/service.ts`). The caller-scoped actions still constrain the update to the caller's own row in the SQL `where` (`uploaded_by_profile_id = ctx.profile.id` + `is null reviewed_at`), so the service-role client can't accidentally stamp someone else's queue.

Revalidation:

- `discardPendingScan` / `cancelFailedScan` revalidate `/scans/pending`.
- `resetBillScan` / `resolveBillScan` revalidate `/admin/bill-scans`.
- `uploadBillFromScan` (owned by `features/bills.md`) revalidates `/scans/pending` when `attemptId` is supplied so the just-finalised row disappears from the caller's queue.

Cross-feature server-action consumers:

- `uploadBillFromScan` (owned by `features/bills.md`) is the only writer that produces a `bills` row from a scan. When the caller passes `attemptId`, it reaches into this feature's table (`bill_scan_attempts`) via service-role to stamp `produced_bill_id` + `reviewed_at`, and copies the image from `bill-scan-pending` into `bill-images`. Documented in `features/bills.md`; mentioned here because it's the terminal step of the scan lifecycle.

## Components
| Component | File | Used by |
| --- | --- | --- |
| `PendingScansPage` (default) | `src/app/scans/pending/page.tsx` | Next.js route `/scans/pending`. Reads `bill_scan_attempts` for the caller, batches signed-URL minting for thumbnails (10-minute TTL) from `bill-scan-pending`, partitions into Ready/InProgress/Failed sections, and normalises `parsed_payload` (jsonb) back into `ConfirmFormInitial`. Renders `MainNav` with `active="inventory"`. |
| `SucceededAttemptCard` | `src/app/scans/pending/_review-card.tsx` | `PendingScansPage`. Collapsed: thumbnail + "Review & save" + "Discard". Expanded: mounts `BillConfirmForm` (owned by `features/bills.md`) pre-filled from `parsed_payload`, passes the row's `attemptId` through so `uploadBillFromScan` can stamp it. On save navigates to `/bills/[id]`. On discard calls `discardPendingScan`. |
| `FailedAttemptCard` | `src/app/scans/pending/_failed-card.tsx` | `PendingScansPage`. Thumbnail + last error + "Cancel" button (calls `cancelFailedScan`). Includes an "Admin is looking" badge because the cron's terminal-failure transition fires a Web Push that tells the user the same. |
| `AdminBillScansPage` (default) | `src/app/admin/bill-scans/page.tsx` | Next.js route `/admin/bill-scans`. `requireAdmin` gate. Cross-tenant read of `bill_scan_attempts` (status='failed', reviewed_at IS NULL) plus parallel name lookups against `profiles` + `households` and batch signed-URL minting from `bill-scan-pending`. |
| `AdminBillScansClient` | `src/app/admin/bill-scans/_client.tsx` | `AdminBillScansPage`. Thumbnail (96 × 96), uploader + household name, attempts/max, last error, "Mark resolved" + "Reset to pending" buttons wired to `resolveBillScan` / `resetBillScan`. |
| `PendingScansBanner` | `src/components/site/pending-scans-banner.tsx` | `src/app/inventory/page.tsx`. Server component — counts the caller's `succeeded ∧ ¬reviewed` rows via service-role and renders a "N bill scans ready to review" link to `/scans/pending`. Best-effort: any failure path returns `null` rather than throwing. |

Cross-feature components consumed by scans but owned elsewhere:

- `BillConfirmForm` (`src/components/bills/bill-confirm-form.tsx`) — owned by `features/bills.md`. Used by `SucceededAttemptCard`. Takes the `ConfirmFormInitial` snapshot + `attemptId` and calls `uploadBillFromScan` on save.
- `MainNav` (`src/components/site/main-nav.tsx`) — shared site chrome.
- `PendingButton` (`src/components/ui/pending-button.tsx`) — shared.

Cross-feature components scans is consumed by:

- `UploadBillForm` (`src/app/inventory/new/_bill-form.tsx`) — owned by `features/inventory.md` for the mount on `/inventory/new?mode=scan`. The component posts to `POST /api/bills/scan` (owned here) and threads its response into `BillConfirmForm` (owned by `features/bills.md`). All three features share the same HTTP boundary.

## DB surface
| Object | Kind | Introduced in | Notes |
| --- | --- | --- | --- |
| `bill_scan_attempts` | table | `20260629_001_bill_scan_retries.sql` | Owned here. Columns: `id`, `household_id` (FK `households`, `ON DELETE CASCADE`), `uploaded_by_profile_id` (FK `profiles`, `ON DELETE SET NULL`), `storage_path text NOT NULL` (path inside `bill-scan-pending`), `mime_type text NOT NULL`, `status text NOT NULL DEFAULT 'pending'` (check constraint `bill_scan_attempts_status_check` for values `pending`/`succeeded`/`failed`), `attempts int NOT NULL DEFAULT 0`, `max_attempts int NOT NULL DEFAULT 3`, `last_error text`, `last_attempted_at timestamptz`, `parsed_payload jsonb` (populated on success), `produced_bill_id uuid` (FK `bills`, `ON DELETE SET NULL` — stamped by `uploadBillFromScan`), `reviewed_at timestamptz`, `created_at`, `updated_at` (trigger `bsa_touch_updated_at` → `touch_updated_at()`). Indexes: partial `bill_scan_attempts_pending_idx (last_attempted_at nulls first) WHERE status='pending' AND attempts<max_attempts` (cron pick-up — null-first so brand-new inserts run on the next tick), partial `bill_scan_attempts_user_unreviewed_idx (uploaded_by_profile_id) WHERE status='succeeded' AND reviewed_at IS NULL` (drives the `PendingScansBanner` count + the Ready section on `/scans/pending`), `bill_scan_attempts_household_idx (household_id)`. |
| `bill_scan_attempts` RLS | policies | `20260629_001_bill_scan_retries.sql` | `bsa_self_read` (`uploaded_by_profile_id = public.current_profile_id()`), `bsa_household_read` (`public.has_active_membership(household_id)`), `bsa_admin_read` (`public.current_is_admin()`). **No write policies by design** — every write path uses the service-role client: `/api/bills/scan` (insert on failure), `/api/cron/retry-bill-scans` (status / attempts / parsed_payload updates), `/scans/actions` (discard / cancel), `/admin/bill-scans/actions` (reset / resolve), and `uploadBillFromScan` (stamp `produced_bill_id` + `reviewed_at` on save). |
| `bill-scan-pending` storage bucket | storage bucket | `20260629_001_bill_scan_retries.sql` | Private, service-role-only — **no storage RLS policies**, because no authenticated user ever reads or writes the bucket directly. Path scheme: `<household_id>/<attemptId>.<jpg|png|webp>` (built by `buildBillScanStoragePath`). Written by `/api/bills/scan` on the failure path; read by `/api/cron/retry-bill-scans` (download bytes for re-try), by `/scans/pending` (signed thumbnails, 10-min TTL), by `/admin/bill-scans` (signed thumbnails, 10-min TTL), and by `uploadBillFromScan` (download then re-upload to `bill-images` on queued-retry finalise). The image stays in this bucket even after the bill is finalised in v1 (we don't move it to `bill-images`, we copy it). |
| `bills` | table | (owned by `features/bills.md`) | Consumer only. Scans never writes here directly; `uploadBillFromScan` is the writer. The `produced_bill_id` FK on `bill_scan_attempts` points at this table. |
| `bill-images` storage bucket | (owned by `features/bills.md`) | Consumer only. `/api/bills/scan` writes here on the sync success path so `/bills/[id]` can render the photo via signed URL. `uploadBillFromScan` writes here when copying from `bill-scan-pending` on a queued-retry finalise. Storage RLS, path scheme, and bucket creation are owned by `features/bills.md`. |
| `profiles.is_admin` | column | (owned by `features/infrastructure.md` / household) | Consumer only. `requireAdmin` reads this; the env-synced bootstrap that sets it is documented elsewhere. |
| `push_subscriptions` | table | (owned by `features/infrastructure.md`) | Consumer only. `/api/cron/retry-bill-scans` reads active rows for the uploader profile after each terminal transition (succeeded / failed), sends via `sendWebPush`, and stamps `last_used_at` (success) or `revoked_at` (HTTP 410 from the push service). |
| `ingest_bill_ocr(p_bill_id, p_payload) → bills` | RPC | `20260530_001_ingest_bill_ocr_fn.sql` | **Not owned by scans.** Documented in `features/bills.md` as the historical GitHub-Issues OCR pipeline ingest function — dead code in the post-cleanup world. Confirmed here: no scan-feature file imports or calls this RPC. Scans is the new pipeline; it bypasses `ingest_bill_ocr` entirely. |

## External integrations
- **Anthropic Claude Sonnet 4.6 vision (`claude-sonnet-4-6`):** the only external model call in the feature. Lives in `src/app/api/bills/scan/_sonnet.ts` (`runSonnetBillScan`). Inputs: base64 image bytes + media type (`image/jpeg` / `image/png` / `image/webp`) + API key. Uses `output_config.format.type = "json_schema"` to constrain the response to the bill schema (header fields + items array). The system prompt is sent with `cache_control: { type: "ephemeral" }` so subsequent calls in the same hour-ish cache window are cheaper. Per-call timeout: 30 s (race against a `setTimeout`-backed rejection). Called twice in the codebase: synchronously by `POST /api/bills/scan` and on retry by `/api/cron/retry-bill-scans`. The shared helper is the single source of truth for the prompt + schema. `ANTHROPIC_API_KEY` is required server-side; "replace_me" is treated as unset.
- **Supabase Storage:**
  - Bucket `bill-scan-pending` (owned here, service-role-only) — primary storage during the retry lifecycle.
  - Bucket `bill-images` (owned by `features/bills.md`) — written by `/api/bills/scan` on sync success and indirectly via `uploadBillFromScan` on queued-retry finalise.
- **Supabase service-role client** (`src/lib/supabase/service.ts`): used by every scan write path because `bill_scan_attempts` has no user-writable RLS and `bill-scan-pending` is service-only.
- **Vercel Cron:** registered in `vercel.json` as `path: /api/cron/retry-bill-scans, schedule: */15 * * * *`. Auth via `Authorization: Bearer $CRON_SECRET`; unset / mismatched secret returns 500 / 401. Per-tick safety knobs: `BATCH_LIMIT = 10`, `WALLCLOCK_BUDGET_MS = 60_000`, `RETRY_GAP_MINUTES = 14` (one minute less than the cron cadence so a row mid-Sonnet-call isn't re-claimed by the next tick). Loop breaks early when the budget is exhausted, before kicking off another Sonnet call.
- **Clerk:** every page + server action calls `requireHousehold` or `requireAdmin` from `src/lib/auth/require.ts`. The `/api/bills/scan` route additionally rejects callers whose `membership.role` is neither `owner` nor `maid`.
- **Web Push:** `/api/cron/retry-bill-scans` calls `sendWebPush` from `src/lib/push/webpush.ts` after each terminal transition (success → "Bill scan ready", failure → "Bill scan failed"). Loops every active `push_subscriptions` row for the uploader profile; stamps `last_used_at` on success and `revoked_at` on HTTP 410. Push infrastructure itself is owned by `features/infrastructure.md`.
- **`browser-image-compression`** (client-side, in `_bill-form.tsx`): compresses to 1 MB / 1920 px before POST. Not on the scan-feature side per se (the form lives in `features/inventory.md`'s subtree), but it's the only reason the server's 10 MB hard ceiling is rarely hit.

## Open questions
- **`src/app/api/inventory/scan/_parse.ts` lives at a misleading path.** It is the canonical unit / name / quantity normaliser for the bills-scan parser (and has unit-test coverage at `tests/unit/inventory-scan-parse.test.ts`), not an inventory-scan endpoint. There is no `route.ts` next to it. Either move it under `src/app/api/bills/scan/` (or `src/lib/scans/`) and re-point the import, or accept the historical naming. `features/inventory.md` previously flagged this file as orphaned — that flag is incorrect; this spec supersedes it. Until the move happens the import in `src/app/api/bills/scan/_parse.ts:17` is the only thing pointing into the inventory folder from scan code.
- **`SucceededAttemptCard`'s docstring says "from the inventory-tab dot badge in the main nav".** `src/components/site/main-nav.tsx` does not currently render a dot badge for `bill_scan_attempts`; the only surface that counts unreviewed rows is `PendingScansBanner` on `/inventory`. Either ship the dot badge (`MainNav` would need to become server-aware or accept a count prop from a server wrapper) or correct the page comment.
- **`bill-scan-pending` images are never deleted.** Successful retries land in the bucket and stay there: `uploadBillFromScan` **copies** the bytes into `bill-images` rather than `moves` them (because the legacy retain-on-success policy was deliberate), and `discardPendingScan` / `cancelFailedScan` / `resolveBillScan` only stamp `reviewed_at`. Long-term storage cost will creep up. Either add a sweep cron that prunes `reviewed_at < now() - 30d` rows + their bucket objects, or flip the queued-retry path to a `move`.
- **No bucket-RLS asymmetry test.** `bill-scan-pending` deliberately has no storage policies (service-role only), but there's no negative test asserting that an authenticated user with a non-service-role token can't `list` or `download` from the bucket. Worth adding alongside the Phase 2 test pass.
- **Cron auth uses `Bearer $CRON_SECRET` directly** (not the Vercel-specific signed header). Adequate for our threat model — the secret is rotated with the env — but if Vercel ships a stronger primitive we'd want to revisit.
- **`shouldRetryAttempt` is exported from `_storage.ts` but the actual cron uses its own inline `or(...)` filter at the SQL layer** instead of pulling rows and re-checking in JS. The helper is covered by `tests/unit/bill-scan-retry.test.ts` and acts as executable documentation, but it isn't on the hot path. Either remove the helper or refactor the cron to use it (and slim the SQL filter).
- **`max_attempts` is per-row but defaults to 3 for every insert.** No UI or admin tool can bump a specific row's cap (a stubbornly broken bill that the admin wants to give one more shot still has to be reset, which moves it back to attempt 0 — fine in practice, but worth calling out).

## Test coverage
_To be filled in Phase 2._
