# Zomaid — Slice 3: Bill Scanning + OCR via GitHub-Mediated Claude — Design

- **Date**: 2026-05-11
- **Status**: Approved (brainstorming) — pending implementation plan
- **Slice**: 3 of 7
- **Owner**: amit@instigence.com
- **Depends on**: [2026-05-10 Foundations Design](./2026-05-10-foundations-design.md), [2026-05-11 Slice 2a Design](./2026-05-11-slice-2a-recipes-meal-plan-design.md), [2026-05-11 Slice 2b Design](./2026-05-11-slice-2b-shopping-list-design.md)

## 1. Context

Slice 3 lets a household scan a paper grocery receipt and have its line items extracted automatically. Instead of running OCR locally or paying for the Anthropic API per request, the app delegates OCR to **Claude via the Claude Code GitHub Action** — billed against the user's Claude subscription. The bill image is uploaded to Supabase Storage; the app creates a GitHub Issue with the image embedded and an `@claude` prompt; the Claude Code Action processes the receipt and posts the structured result as an issue comment; a Next.js webhook ingests the JSON, writes line items to the database, fuzzy-matches them against the household's unbought shopping items (marking matches as bought), and closes the issue.

This is an experimental architecture. It trades latency (~30 s – 3 min end-to-end) and operational complexity (GitHub + Claude subscription + webhook) for zero per-bill cost beyond the existing subscription.

## 2. Decomposition

| # | Slice | Status |
|---|---|---|
| 1 | Foundations | Done |
| 2a | Recipes + meal plan + suggestion engine | Done |
| 2b | Shopping list | Done |
| 3 | Bill scanning + OCR (this doc) | Designing |
| 4 | Fridge with expiry recommendations | Pending |
| 5 | Tasks + reminders + Web Push | Pending |
| 6 | Billing + subscription tiers | Pending |
| 7 | Admin tools | Pending |

## 3. Decisions log (from brainstorming, 2026-05-11)

| Q | Decision |
|---|---|
| PII on GitHub | **Accepted for v1** (private repo + single household). Documented as a Risk. |
| Write-back path | **Comment + webhook** — Claude posts JSON in an issue comment; Next.js `/api/webhooks/github` ingests it |
| Scope split | **Single slice 3** — not split |
| Upload entry point | **Standalone `/bills` page** |
| Auto-link to shopping list | **Yes** — case-insensitive substring fuzzy match marks exact-1 matches bought automatically |
| GH integration | **REST API + `GITHUB_TOKEN` PAT** (no `gh` CLI dependency in runtime) |
| Extraction schema | **Store + bill date + line items (name, qty, unit, unit price, line total) + total** (no tax/GST/raw text in v1) |
| Failure handling | **`bills.status` enum** (`pending` / `processing` / `processed` / `failed`); failed bills get a manual-entry fallback action |
| Retention | **Close GH issue on success**; image + issue body persist on GitHub for audit |
| Manual override | **Line items editable**; bill header (date / store / total) is read-only |
| Edit permissions | **Owner + maid** (same as slice 2a/2b); family read-only |

## 4. Domain model

### 4.1 Enum

```
bill_status: 'pending' | 'processing' | 'processed' | 'failed'
```

### 4.2 Tables

```
bills
  id                     (uuid, pk, default gen_random_uuid())
  household_id           (uuid fk → households.id, ON DELETE CASCADE, not null)
  uploaded_by_profile_id (uuid fk → profiles.id, ON DELETE SET NULL)
  status                 (bill_status, not null, default 'pending')
  status_reason          (text, NULL ok)              ← human-readable reason for 'failed'
  bill_date              (date, NULL ok)              ← null until processed
  store_name             (text, NULL ok)              ← null until processed
  total_amount           (numeric, NULL ok)           ← null until processed
  currency               (text, not null, default 'SGD')
  image_storage_path     (text, not null)             ← path inside `bill-images` bucket
  github_issue_number    (int, NULL ok)
  github_issue_url       (text, NULL ok)
  created_at, updated_at, processed_at (timestamptz; updated_at via trigger)

  index bills_household_created_idx
    on (household_id, created_at desc);

  index bills_status_idx
    on (status)
    where status in ('pending', 'processing');

bill_line_items
  id                         (uuid, pk)
  bill_id                    (uuid fk → bills.id, ON DELETE CASCADE, not null)
  position                   (int, not null, check >= 1)
  item_name                  (text, not null, check length between 1 and 120)
  quantity                   (numeric, NULL ok, check is null or > 0)
  unit                       (text, NULL ok, check is null or length between 1 and 24)
  unit_price                 (numeric, NULL ok, check is null or >= 0)
  line_total                 (numeric, NULL ok, check is null or >= 0)
  matched_shopping_item_id   (uuid fk → shopping_list_items.id, ON DELETE SET NULL, NULL ok)
  created_at, updated_at (timestamptz)

  unique (bill_id, position)
  index bill_line_items_bill_id_idx on (bill_id)
```

A bill goes through `pending → processing → processed | failed`. Transitions are:

- `pending → processing`: after `uploadBill` successfully creates the GitHub issue.
- `processing → processed`: after the webhook ingests valid JSON and writes line items.
- `processing → failed`: webhook receives malformed JSON or a Claude-error comment; or a separate maintenance check determines the issue is stale (deferred — v1 only fails on webhook-side errors).
- `failed → processing`: the `retryBill` action re-creates the GH issue.
- Any → `processed` via `markBillManuallyProcessed` for the manual-entry fallback.

## 5. Architecture

### 5.1 End-to-end flow

```
1. User taps "Upload bill" on /bills/new, picks an image.
2. Client compresses the image (≤ 2 MB, max 2400 px long edge) and submits via FormData.
3. uploadBill (server action):
   a. Validates: ≤ 5 MB after compression; MIME in (jpeg|png|webp); requireHousehold().
   b. Inserts `bills` row with status='pending', image_storage_path placeholder.
   c. Uploads file to `bill-images/<household_id>/<bill_id>.<ext>` (RLS-gated; owner/maid only).
   d. Updates `bills.image_storage_path` with the real path.
   e. Generates a 24-hour signed URL for the image.
   f. Calls GitHub REST API: POST /repos/<owner>/<repo>/issues. Body contains:
        - Markdown image embed (the signed URL)
        - Metadata block (bill ID, household ID, optional store hint)
        - @claude prompt asking for a single ```json code block in the response
   g. Updates `bills` with github_issue_number, github_issue_url, status='processing'.
   h. Returns { billId } so the UI can navigate to /bills/<billId>.
4. GitHub fires the Claude Code Action workflow on the repo.
5. Claude reads the image, posts a comment on the issue containing a fenced ```json
   code block matching the schema in §5.4.
6. GitHub fires `issue_comment.created` event → POST /api/webhooks/github.
7. Webhook handler:
   a. Verifies HMAC signature against GITHUB_WEBHOOK_SECRET.
   b. Filters to comments on issues authored by our app's bot identity (a label or
      the issue body containing a known sentinel "<!-- zomaid-bill -->").
   c. Looks up the bill by github_issue_number.
   d. Parses the JSON code block; validates schema (Zod).
   e. Inside a single transaction:
        - INSERT bill_line_items rows.
        - For each line item, run fuzzy match (§5.5) and link if exactly-1 unbought
          shopping_list_items match. Set matched_shopping_item_id and update the
          shopping item's bought_at + bought_by_profile_id.
        - UPDATE bills SET status='processed', processed_at=now(),
          bill_date, store_name, total_amount.
   f. Calls GitHub REST API to close the issue with a comment "✅ Processed → bill <id>".
   g. Returns 200.
8. UI on /bills/<id> auto-refreshes (server-side revalidatePath, or client polling)
   and shows the processed bill.
```

### 5.2 Failure paths

- **GitHub API call fails in uploadBill (step 3f)**: leave `bills.status = 'pending'`, surface error to the UI. User can re-submit via `retryBill`.
- **Claude Code Action errors / never responds**: bill stays in `processing`. v1 has no timeout job; user manually `retryBill` or `markBillManuallyProcessed`. v2: add a daily cron that flips long-stuck `processing` bills to `failed`.
- **Webhook receives a comment with no JSON code block or malformed JSON**: respond 200 (don't have GitHub retry), set `bills.status = 'failed'`, `status_reason = 'Claude response missing JSON block' | 'JSON schema invalid'`. UI shows the failure on `/bills/<id>` with manual-entry button.
- **HMAC verification fails**: respond 401 immediately. Log the event for monitoring.
- **Webhook comment is not on a zomaid-bill issue**: respond 200 (acknowledge but no-op).

### 5.3 Webhook security

- GitHub webhooks include `X-Hub-Signature-256: sha256=<hmac>` header. We verify with `crypto.timingSafeEqual` against HMAC-SHA256 of the raw request body using `GITHUB_WEBHOOK_SECRET`.
- The handler uses the raw body (not a parsed body) for HMAC; Next.js's App Router route handlers accept `Request` and we call `request.text()` once to get the raw body, then parse with `JSON.parse`.
- The shared secret is generated once by the user, stored as a repo webhook secret on GitHub side and as `GITHUB_WEBHOOK_SECRET` env var on the app side.

### 5.4 GitHub issue body template

This is the contract between the app and Claude.

```markdown
<!-- zomaid-bill -->
**Bill ID:** `<uuid>`
**Household:** `<uuid>`
**Uploaded:** 2026-05-11T14:23:00Z
**Store hint (user-provided):** _(none)_

![bill](https://<supabase-signed-url-24h>)

---

@claude please read the attached receipt image and reply **only** with a single fenced JSON code block matching this schema. Use SGD. Use ISO date `YYYY-MM-DD`. If a value isn't visible, use `null`.

\`\`\`json
{
  "store_name": "string or null",
  "bill_date": "YYYY-MM-DD or null",
  "total_amount": 0.00,
  "line_items": [
    { "item_name": "string", "quantity": 0, "unit": "string or null", "unit_price": 0.00, "line_total": 0.00 }
  ]
}
\`\`\`

Do not include any prose; the parser reads only the JSON code block.
```

### 5.5 Fuzzy-match algorithm

For each ingested `bill_line_items` row:

1. **Normalize** the candidate name: `lower(trim(item_name))`.
2. **Find unbought shopping items** in the same household:

   ```
   SELECT id, item_name
   FROM shopping_list_items
   WHERE household_id = <bill.household_id>
     AND bought_at IS NULL
     AND (
       lower(trim(item_name)) LIKE '%' || <normalized candidate> || '%'
       OR
       <normalized candidate> LIKE '%' || lower(trim(item_name)) || '%'
     );
   ```

3. **Decision**:
   - **Exactly 1 row** → set `bill_line_items.matched_shopping_item_id` = that row's id; UPDATE that `shopping_list_items` row to `bought_at = bills.bill_date OR now()`, `bought_by_profile_id = bills.uploaded_by_profile_id`.
   - **0 or ≥2 rows** → leave `matched_shopping_item_id` NULL. No shopping items are touched.

Bi-directional substring catches both "rice" ← "Basmati Rice 5kg" and "long-grain rice" ← "rice". Acceptable to over-match for v1 because the user can `unmark` on `/shopping` if wrong.

## 6. Authorization (RLS)

Reuses slice 2a helpers (`has_active_membership`, `is_active_owner_or_maid`).

```
bills
  read:   has_active_membership(household_id)
  insert: is_active_owner_or_maid(household_id)
  update: is_active_owner_or_maid(household_id)
  delete: is_active_owner_or_maid(household_id)

bill_line_items
  read:   EXISTS (bill where caller can read it)
  insert/update/delete: EXISTS (bill where caller can write it)

Storage: bill-images bucket (created in Task 2, see §7)
  Path convention: <household_id>/<bill_id>.<ext>
  read/write rules mirror recipe-images-household (member-read, owner-or-maid-write)
```

The webhook handler **does not** go through RLS. It uses the **service-role Supabase client** because (a) the request originates from GitHub (no authenticated end-user JWT), (b) it needs to touch `bills`, `bill_line_items`, AND `shopping_list_items` rows that might belong to different roles. The webhook validates HMAC instead of relying on JWT auth.

## 7. Storage bucket

A new private bucket `bill-images` with RLS mirroring `recipe-images-household`:

```
read:                   bucket_id = 'bill-images'
                        AND has_active_membership((split_part(name, '/', 1))::uuid)
insert/update/delete:   bucket_id = 'bill-images'
                        AND is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
```

Path convention: `<household_id>/<bill_id>.<ext>` where `<ext>` is `jpg|png|webp`.

## 8. API surface

### 8.1 Server actions — `src/app/bills/actions.ts`

| Action | Inputs | Effect |
|---|---|---|
| `uploadBill` | FormData: `{ file: File, storeHint?: string }` | Validates photo (≤ 5 MB, MIME); creates `bills` row (status=`pending`); uploads to Storage; generates signed URL; POSTs GitHub issue; updates row with `github_issue_*` (status=`processing`). Returns `{ billId }`. |
| `updateBillLineItem` | `{ lineItemId, name?, quantity?, unit?, unitPrice?, lineTotal? }` | Patches an existing line item. Owner/maid only. |
| `deleteBill` | `{ billId }` | Hard delete bill (cascades line items). Does NOT unmark previously linked shopping items (their bought state is historical). |
| `retryBill` | `{ billId }` | For `failed` or `processing` bills (no responsive Claude). Re-creates the GitHub issue with the same image (regenerates signed URL). Sets status back to `processing`. |
| `markBillManuallyProcessed` | `{ billId, billDate, storeName, totalAmount, lineItems: [{ name, quantity?, unit?, unit_price?, line_total? }] }` | Fallback for unrecoverable failures. Manually inserts line items + sets `bills.status = 'processed'`, populates header fields. Also runs the same fuzzy-match step on the manually-entered items. |

### 8.2 Webhook handler — `src/app/api/webhooks/github/route.ts`

`POST` handler that:
1. Reads raw body.
2. Verifies `X-Hub-Signature-256` against `GITHUB_WEBHOOK_SECRET`.
3. Parses JSON; rejects events that aren't `issue_comment.created` on the configured repo.
4. Filters out comments not on a `<!-- zomaid-bill -->` issue.
5. Resolves the `bills` row by `github_issue_number`.
6. Extracts the first ```json ... ``` fenced code block from the comment body.
7. Validates with Zod against the schema in §5.4.
8. Inside a Supabase transaction (via an `rpc` or sequenced calls — see §8.3):
   - Insert `bill_line_items`.
   - Run fuzzy-match per item; link + mark shopping bought where exactly-1 match.
   - UPDATE `bills` to `status='processed'`, populate header fields.
9. Closes the GH issue via REST API.
10. Returns 200.

### 8.3 Webhook DB write

Supabase JS doesn't expose a cross-table transaction. The webhook uses a Postgres **function** `ingest_bill_ocr(p_bill_id uuid, p_payload jsonb)` that runs the entire write in a single transaction:

```sql
ingest_bill_ocr(p_bill_id uuid, p_payload jsonb)
  RETURNS bills
  -- security definer (called via service-role client); transaction is implicit.
  -- The payload schema matches §5.4 (validated by Zod in the webhook before calling).
  --
  -- Behavior:
  --   1. UPDATE bills SET store_name=$1.store_name, bill_date=$1.bill_date,
  --      total_amount=$1.total_amount, status='processed', processed_at=now()
  --      WHERE id = p_bill_id RETURNING household_id INTO v_household.
  --
  --   2. For each line item in p_payload.line_items (with position = 1..N):
  --        a. INSERT into bill_line_items.
  --        b. Run the fuzzy-match query against shopping_list_items.
  --        c. If exactly 1 unbought match: UPDATE shopping_list_items SET
  --           bought_at = COALESCE(bill_date, now()),
  --           bought_by_profile_id = bills.uploaded_by_profile_id;
  --           UPDATE the just-inserted bill_line_items row to set
  --           matched_shopping_item_id.
  --
  --   3. RETURN the updated bills row.
```

The function is `security definer` and called via service-role from the webhook. App-level callers cannot invoke it.

### 8.4 GitHub REST client — `src/lib/github/issues.ts`

```ts
createBillIssue({ billId, householdId, signedImageUrl, storeHint, uploadedAt }): Promise<{ issueNumber: number; issueUrl: string }>
closeBillIssue({ issueNumber, completionComment }): Promise<void>
```

Implementation: plain `fetch` to `https://api.github.com/repos/<owner>/<repo>/issues` with `Authorization: Bearer ${process.env.GITHUB_TOKEN}` and the issue body from the template in §5.4. Owner/repo come from env (`GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`).

### 8.5 Error codes added by this slice

```
BILL_NOT_FOUND
BILL_FORBIDDEN
BILL_INVALID_FILE              (size / MIME)
BILL_GITHUB_CREATE_FAILED      (uploadBill couldn't reach GH)
BILL_ALREADY_PROCESSED         (retry / manual on already-processed bill)
BILL_LINE_ITEM_NOT_FOUND
WEBHOOK_INVALID_SIGNATURE      (returned 401)
WEBHOOK_NO_MATCHING_BILL       (returned 200, no-op)
WEBHOOK_JSON_PARSE_FAILED      (bill marked 'failed')
```

## 9. UI surfaces

### 9.1 Routes added

```
/bills           List view (table or card list of bills)
/bills/new       Upload form
/bills/[id]      Detail view (header + line items + matched-shopping chips)
```

### 9.2 `/bills` — list

- Header: title + **+ New** button → `/bills/new`.
- Card list, each card: store name (or "Awaiting OCR…" while pending/processing), bill date (or "—"), total (or "—"), status badge.
- Sorted by `created_at desc`.
- Failed bills shown with a red badge + "Retry" inline button.

### 9.3 `/bills/new` — upload

- File input (image only, accept="image/*", "capture=environment" for mobile-camera).
- Optional **Store hint** text input (e.g., "NTUC Tampines").
- Submit calls `uploadBill`. On `{ ok: true, data: { billId } }` → redirect to `/bills/<billId>`.
- Client-side compression via `browser-image-compression` (already a dep).
- Loading state shows "Uploading… → Creating ticket… → Waiting for Claude…" copy as the server action progresses (one button-state per phase is fine for v1).

### 9.4 `/bills/[id]` — detail

- Header section (read-only):
  - Status badge.
  - Store name + bill date + total (or "Processing…" placeholders for pending/processing).
  - GitHub issue link ("See ticket #123") for transparency / debugging.
- Image preview (the same image we uploaded, fetched via signed URL).
- Line items list (rendered after `status = 'processed'`):
  - Each row: name + quantity/unit + line_total + a chip "→ marked _shopping item name_ bought" if matched.
  - Owner/maid: per-row **Edit** opens a sheet to patch the line item; **Delete** removes it.
  - Family: read-only.
- For `status = 'failed'`:
  - Show `status_reason`.
  - Big button: **Enter line items manually** → opens the manual-entry form (re-uses the same line-item editor in repeat mode; on submit calls `markBillManuallyProcessed`).
  - Smaller button: **Retry OCR** → `retryBill`.

### 9.5 MainNav

`src/components/site/main-nav.tsx` becomes 4 links: **Plan · Recipes · Shopping · Bills**. Added to `/bills`, `/bills/new`, `/bills/[id]` (alongside the existing 3 routes). The `active` prop gains a `bills` value.

### 9.6 Proxy

`src/proxy.ts` adds `/bills(.*)` to the `isAuthGated` matcher.

## 10. Edge cases

- **User uploads a non-receipt image** (a photo of a tree): Claude responds with empty line items or "I can't parse this." Webhook either ingests the empty result (bill becomes `processed` with no line items) or, if Claude says "I can't parse this" in prose, the JSON code block is missing → bill goes to `failed`. UI shows "No line items found. Retry or enter manually."
- **Same bill uploaded twice**: each upload creates a separate `bills` row + separate GH issue. Both processed; both contribute line items; fuzzy match runs on the first one to land. The second's matches will find the items already bought (no unbought match) → `matched_shopping_item_id` stays NULL. Acceptable; no dedupe in v1.
- **User uploads two pages of one receipt**: same as above — two bills, two ticket. No multi-page support in v1.
- **Network blip mid-upload**: client retry. The `uploadBill` action is not idempotent — a retry creates a new bill row. User can manually delete the orphan.
- **Webhook receives the same `issue_comment.created` event twice** (GH retries): idempotency from the `ingest_bill_ocr` function — it checks `bills.status` and returns early if already `processed`. (Adds a CHECK in the function.)
- **Claude posts JSON that doesn't validate**: bill `failed` with reason `"Claude response: JSON schema invalid"`. The raw comment URL is reachable through `github_issue_url`.
- **`bill_date` from Claude is in the future** (e.g., misread "1/12" as "12/01" giving 2027): no special check — we trust Claude. The user can edit the line items but not the header in v1; if it's badly wrong, they can delete and re-upload.
- **Shopping item that has been edited / renamed since the bill was uploaded**: fuzzy match runs on the **current** state of `shopping_list_items` at the moment of webhook ingest. Renames after the match has been applied don't propagate back.
- **`uploaded_by_profile_id` is NULL (uploader deleted their account)** at the time of the webhook: the `bought_by_profile_id` we'd assign to matched shopping items also becomes NULL. Acceptable.
- **Signed image URL expires before Claude reads it**: 24 h is generous; in practice Claude Code responds within minutes. If expired, Claude posts a "couldn't read image" comment → bill `failed` → user retries (regenerates signed URL).
- **Webhook arrives before `uploadBill` has updated `github_issue_number`** (race between GH issue creation and immediate comment): unlikely (Claude takes seconds to respond, GH issue creation returns synchronously before our `update` call). If it does happen, the webhook finds no matching `bills` row and returns 200/no-op; the comment is missed. v2: introduce an outbox pattern.

## 11. Testing strategy

Same shape as 2a/2b — DB + actions + E2E. Slice 3 also needs **webhook tests**.

- **DB-level**:
  - `bills` and `bill_line_items` RLS coverage (member read, owner-or-maid write, family no-write, cross-household isolation).
  - `ingest_bill_ocr` transaction invariants (insert line items, fuzzy-match-and-link, update bill status; idempotency on `processed` re-call).
  - Status-transition CHECKs (if any are added — currently transitions are app-enforced).
- **Server-action level**:
  - `uploadBill` happy path + invalid file rejections + GitHub API failure path (mock).
  - `markBillManuallyProcessed` calls the same matching logic.
- **Webhook-level (vitest with HTTP mocking via MSW)**:
  - Valid HMAC + valid payload → bill becomes `processed`.
  - Invalid HMAC → 401.
  - Comment without JSON code block → bill becomes `failed`.
  - Comment with invalid JSON → bill becomes `failed`.
  - Replay (same event twice) → idempotent (no duplicate line items).
- **E2E (Playwright)**:
  - Route gating: unauthenticated `/bills` redirects to `/`.
  - Authenticated upload smoke is part of the manual walkthrough.

Per the user's "we'll come back to tests" instruction, the implementation plan ships test tasks as separate steps that can be deferred.

## 12. Out of scope (deferred to later slices)

- **Inventory tracking** ("we have 2 bottles of soy sauce") → slice 4 (fridge).
- **Bill analytics** ("you spent $X on groceries this month") → later.
- **Multi-currency bills** → SGD only in v1.
- **Multi-page receipt support** → upload pages as separate bills in v1.
- **Manual link/unlink** of `bill_line_items` ↔ `shopping_list_items` after the fact (beyond editing line item names) → later.
- **Image deletion / retention policy** → v1 keeps everything indefinitely.
- **Push notification on bill processed** → slice 5.
- **Dedupe of same bill uploaded twice** → v1 accepts duplicates.
- **Long-stuck `processing` bills auto-flip to `failed`** → v1 relies on user retry.
- **GitHub App + installation token** (instead of long-lived PAT) → v2.
- **Public-facing dashboard for bills processed across all households** (admin tooling) → slice 7.

## 13. Pre-flight (one-time manual setup before Task 1)

The user must do these before the implementation plan can be executed:

- **A. Install the Claude Code GitHub Action** on the target repo (`amit-experimenting/zomaid`). Visit `https://github.com/apps/claude`, click "Install", select the repo. This is the integration that responds to `@claude` mentions; billing is against the user's Claude subscription.
- **B. Create a Personal Access Token** with `repo` scope. Set as `GITHUB_TOKEN` env var locally (`.env.local`) and on Vercel (Production + Preview).
- **C. Note the repo owner and name.** Set env vars `GITHUB_REPO_OWNER=amit-experimenting`, `GITHUB_REPO_NAME=zomaid`.
- **D. Generate a webhook secret.** `openssl rand -hex 32`. Save as `GITHUB_WEBHOOK_SECRET` env var locally + on Vercel. Use the **same** value when configuring the webhook in step F.
- **E. For local dev: expose the webhook via ngrok or Cloudflare Tunnel**, e.g., `ngrok http 3000`. Note the public HTTPS URL.
- **F. Register the webhook on the GitHub repo**: Settings → Webhooks → Add webhook. URL = `<public-host>/api/webhooks/github`. Content type = `application/json`. Secret = the value from D. Events = "Let me select…" → check **Issue comments**. Save.

When A–F are green, start Task 1.

## 14. Risks & open questions

- **PII on GitHub** (accepted, documented): bill images contain itemized purchases and timestamps. Risk lives at the GitHub-org level. If the project ever multi-tenants beyond your own household, this needs revisiting.
- **Claude Code Action availability**: third-party dependency; if the action is paused/deprecated, the slice stops working. Mitigation: the manual-entry fallback (`markBillManuallyProcessed`) keeps the data path usable; bills just don't get OCR'd.
- **Subscription rate limits**: heavy bill upload bursts may throttle the Claude Code Action. Acceptable for single-household v1.
- **Webhook reachability in production**: relies on Vercel's HTTPS endpoint being publicly accessible (default). No special setup needed for prod; only dev needs ngrok.
- **Auto-link false positives**: substring matching can mis-link ("milk" → "soy milk"). User can `unmark bought` on `/shopping` if needed. Tightening to token-level matching is a v2 win.
- **Bill image PII visible via the issue body's signed URL** for 24 h: anyone with the URL can fetch. Mitigation: short expiry, but the URL is in the GH issue forever (the resource it points to expires after 24 h and returns 403 thereafter).
- **No app-side audit log** for OCR ingestion: the GitHub issue **is** the audit log. Adequate for v1.
- **`gh auth` PAT vs dedicated bot PAT**: using a personal `gh auth` token mixes the user's identity with the app's bot identity in created issues. v1 acceptable; v2: a dedicated bot account / GitHub App.
- **No retry budget on Claude failures**: a malformed-JSON loop would require human intervention each time. Acceptable for low volume; revisit if bills exceed ~5/day.
