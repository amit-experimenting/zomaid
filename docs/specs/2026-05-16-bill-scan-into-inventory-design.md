# Zomaid — Bills: Upload-Bill Tab + Inventory Linkage — Design

> **Superseded as the living architecture doc for the inventory area by [`features/inventory.md`](features/inventory.md).** This dated spec is retained for historical context.
> **Superseded as the living architecture doc for the bills area by [`features/bills.md`](features/bills.md).** This dated spec is retained for historical context.

- **Date**: 2026-05-16
- **Status**: Approved (no clarifications outstanding) — implementing in same session
- **Scope**: Adds a third tab on [`/inventory/new`](../../src/app/inventory/new/page.tsx) called **"Upload bill"**. Uploading a photo of a paper grocery bill runs it through Claude Sonnet 4.6 vision (the same pattern as the receipt-scan tab), shows an editable confirmation screen, and on Save creates a `bills` row, `bill_line_items` rows, and an `inventory_items` row per line item the user checked "Add to inventory". A new column on `bill_line_items` records which inventory row each line produced. Duplicate bills (same store + date + same set of items) are rejected before insert.

## 1. Context

Today `/inventory/new` has two tabs: **Manual** ([_onboarding-form.tsx](../../src/app/inventory/new/_onboarding-form.tsx) single-item or onboarding multi-row) and **Scan receipt** ([_scan-form.tsx](../../src/app/inventory/new/_scan-form.tsx) — Sonnet 4.6 vision shortcut into inventory creation, no bill record).

We're adding a third tab that is the inverse of "Scan receipt": a fully-fledged bill capture flow that does create the `bills` + `bill_line_items` rows, optionally pushing each line into inventory in a single confirmation step. This replaces the older OCR-via-GitHub-issue path (`/bills/new` + `uploadBill` + `UploadForm`) at the entry point — the user lands on `/inventory/new`'s third tab, not on `/bills/new`. The legacy upload action and `/bills/new` page are slated for removal by a separate sub-agent and **are not touched here**.

## 2. Decisions log (agreed up front, 2026-05-16)

| Q | Decision |
|---|---|
| LLM | Anthropic `@anthropic-ai/sdk`, model id **`claude-sonnet-4-6`** exactly. Vision + JSON-schema structured output, same shape as receipt scan. |
| Image input | base64-encoded JPEG/PNG/WebP. Client compresses with `browser-image-compression` (~1 MB / max 1920 px). Server re-validates ≤ 10 MB. |
| Auth | `requireHousehold()` + role ∈ (`owner`, `maid`) on both the API route and the server action. |
| Currency / bill date / total | Sonnet may return `null` if not detected. The user fills in or corrects on the confirmation form. **No defaults** — `currency` is required at save time. |
| Unit coercion | Reuse `coerceUnit` / `normalizeName` / `normalizeQuantity` from [src/app/api/inventory/scan/_parse.ts](../../src/app/api/inventory/scan/_parse.ts). No duplication. |
| Duplicate check | Exact match on (`lower(trim(store_name))`, `bill_date`, set of `(lower(trim(item_name)), quantity, unit, price)` tuples). On match → reject with code `BILL_DUPLICATE`. No fuzzy matching, no auto-merge. |
| Inventory link column | Use the **existing** `bill_line_items.matched_inventory_item_id uuid references inventory_items(id) on delete set null` (added in [20260611_001_inventory_column_additions.sql](../../supabase/migrations/20260611_001_inventory_column_additions.sql)). The migration we ship is a defensive `IF NOT EXISTS` no-op so the contract is documented at today's date. |
| Image persistence | **None.** The bytes go to Claude in-flight only. No Supabase Storage write. This means `bills.image_storage_path` (which the table requires `NOT NULL`) is filled with a sentinel string `bill-scan-not-persisted`. |
| "Add to inventory" default | ON. Lines the user unticks are still written to `bill_line_items` (with `matched_inventory_item_id` left `NULL`) so the bill remains a faithful record. |
| Empty-name rows | Skipped entirely (no `bill_line_items` row, no inventory row). |
| `/inventory/new` tabs | Three tabs: Manual / Scan receipt / Upload bill. Hidden during `?onboarding=1` (matching the existing scan-receipt precedent). |
| Save success redirect | `/bills/<id>` so the user sees the persisted bill detail page. |
| Tests | Pure-helper unit tests for the dedupe key-builder + scan parser. No live LLM tests, no Anthropic SDK mocks. |

## 3. Architecture

```
[user picks file]
        │  client compress (max 1 MB / 1920 px)
        ▼
[POST /api/bills/scan, multipart 'image=<file>']
        │  requireHousehold + role check
        │  validate mime/size
        │  base64 + Anthropic.messages.create(model=claude-sonnet-4-6,
        │      output_config.format=json_schema)
        │  parse + coerce units + clean names
        ▼
{ ok: true, data: { store_name, bill_date, currency, total_amount,
                    items: [{ item_name, quantity, unit, price }, ...] } }
        │
        ▼
[client renders editable confirmation form in _bill-form.tsx]
        │  user edits header + per-row + checkboxes; clicks Save
        ▼
[server action uploadBillFromScan]
        │  zod-validate
        │  build dedupeKey + query bills for prior matches
        │     ├─ match → return { ok: false, code: 'BILL_DUPLICATE' }
        │     └─ unique:
        │         1. insert bills row (image_storage_path sentinel)
        │         2. for each checked line, call createInventoryItem
        │            and capture inventory_item.id
        │         3. insert bill_line_items rows
        │            (matched_inventory_item_id from step 2 or null)
        ▼
{ ok: true, data: { billId } }  →  redirect /bills/<billId>
```

## 4. File-level changes

### 4.1 New: [supabase/migrations/20260627_001_bill_inventory_link.sql](../../supabase/migrations/20260627_001_bill_inventory_link.sql)

(Renamed from `20260626_001_*` to avoid a date-version collision with the in-flight `20260626_001_tasks_member_insert.sql` migration — Supabase's `schema_migrations` table keys on the 8-digit date prefix alone.)

Defensive idempotent migration. The column **already exists** as `matched_inventory_item_id` (added 2026-06-11 to support the legacy bill-ingest review queue). This migration:

```sql
alter table public.bill_line_items
  add column if not exists matched_inventory_item_id uuid
    references public.inventory_items(id) on delete set null;
```

No indexes — low cardinality, joins are rare and small.

The user spec asked for a column named `inventory_item_id`. We reuse `matched_inventory_item_id` because:
1. It already has the exact semantics the spec requires (nullable FK to `inventory_items(id)`, `ON DELETE SET NULL`).
2. Adding a parallel column would mean two columns mean the same thing — bad.
3. Server-side code uses `matched_inventory_item_id` already (`inventory_bill_ingest` RPC).

### 4.2 New: [src/app/api/bills/scan/route.ts](../../src/app/api/bills/scan/route.ts)

`POST` only. Returns `{ ok: true, data: ParsedBill } | { ok: false, error: { code, message } }`.

Mirrors [src/app/api/inventory/scan/route.ts](../../src/app/api/inventory/scan/route.ts) for setup + auth + Anthropic call. Differences:
- 10 MB upload ceiling (vs 5 MB on receipt scan — bills are higher-stakes captures).
- JSON schema now includes store/date/currency/total at the top level plus a `price` field on items.
- System prompt explicitly tells the model to skip non-grocery lines (tax, totals, payment) when emitting `items`.

### 4.3 New: [src/app/api/bills/scan/_parse.ts](../../src/app/api/bills/scan/_parse.ts)

Pure functions + zod schema for the model response. Reuses `coerceUnit`, `normalizeName`, `normalizeQuantity` from `src/app/api/inventory/scan/_parse.ts` (imported, not copied). Adds:
- `normalizeStoreName(raw: unknown): string | null` — trims; returns null on empty.
- `normalizeBillDate(raw: unknown): string | null` — passes `YYYY-MM-DD` through; null otherwise.
- `normalizeCurrency(raw: unknown): string | null` — uppercase 3-letter ISO-ish; null if it doesn't match `/^[A-Z]{3}$/`.
- `normalizePrice(raw: unknown): number | null` — finite ≥ 0 only; round to 2 dp.
- `parseBillScanResponse(raw: unknown): ParsedBill`.

### 4.4 New: [src/app/bills/actions.ts](../../src/app/bills/actions.ts) — add `uploadBillFromScan`

Append to the existing actions file (don't touch existing exports). Signature:

```ts
type Unit = "kg" | "g" | "l" | "ml" | "piece";
type BillScanLineInput = {
  item_name: string;
  quantity: number | null;
  unit: Unit | null;
  price: number | null;
  addToInventory: boolean;
};
export type UploadBillFromScanInput = {
  store_name: string;
  bill_date: string;             // YYYY-MM-DD
  currency: string;              // 3-letter
  total_amount: number | null;
  items: BillScanLineInput[];
};
export async function uploadBillFromScan(
  input: UploadBillFromScanInput,
): Promise<BillActionResult<{ billId: string }>>;
```

Behavior:
1. `requireHousehold()`; role gate.
2. zod-validate. Empty `store_name`, missing `bill_date`, or empty `items` → `BILL_INVALID` 400-ish.
3. Build the dedupe key (see §6) and query `bills` + `bill_line_items` for the household. Equality of two key objects → reject with `BILL_DUPLICATE` and the original bill's `bill_date` in the message.
4. Insert `bills` row. `image_storage_path: "bill-scan-not-persisted"`. `status: "processed"`. `processed_at: now()`.
5. For each checked, non-empty-name item: `createInventoryItem({ item_name, quantity, unit })`. Capture `id`.
6. Bulk-insert `bill_line_items` rows in original order with `position` = 1..N. Set `matched_inventory_item_id` from step 5 for checked lines; `null` for unchecked or empty-name lines (empty-name lines are still dropped — they get no row).
7. Return `{ ok: true, data: { billId } }`.

If any step after the `bills` insert fails: best-effort delete the `bills` row (RLS via owner/maid policy permits it) and surface the error. We don't wrap in a transaction because Supabase JS doesn't expose multi-statement transactions; the rollback is opportunistic.

### 4.5 New: [src/app/inventory/new/_bill-form.tsx](../../src/app/inventory/new/_bill-form.tsx)

`"use client"` component. State machine:
- `phase: "pick" | "compressing" | "scanning" | "confirm"`
- `parsed: ParsedBill | null`
- `header: { store, date, currency, total }`
- `rows: Array<{ id, name, qty, unit, price, addToInventory }>`
- `error: string | null`

Render (split by `phase`):
- `pick` / `compressing` / `scanning`: file input + Scan button (very similar to receipt scan).
- `confirm`: editable header (store / date `<input type="date">` / currency / total) + per-row grid (name, qty, unit `<select>`, price, addToInventory `<input type="checkbox">`) + Discard / Save buttons.

Submission uses `useTransition` rather than form action so we can call `uploadBillFromScan` directly with a typed object and handle the `BILL_DUPLICATE` error inline.

### 4.6 Update: [src/app/inventory/new/page.tsx](../../src/app/inventory/new/page.tsx)

Add a third `ModeTab` and a `mode === "bill"` branch that renders `<UploadBillForm />`. The bill tab is shown only when `!isOnboarding`, identical to the existing `mode === "scan"` gating.

### 4.7 Type update: [src/lib/db/types.ts](../../src/lib/db/types.ts)

`bill_line_items.Row` already has `matched_inventory_item_id: string | null`. **No change.** The migration is defensive only; the types file is already correct.

### 4.8 Bill detail page

[src/app/bills/[id]/page.tsx](../../src/app/bills/[id]/page.tsx) already queries `matched_inventory_item_id` via `_inventory-queue` and renders processed bills cleanly. No change required.

## 5. Prompt template

`BILL_SYSTEM_PROMPT` (frozen, cacheable):

```
You extract grocery-bill data from a photo of a paper retail receipt or invoice.

Return a JSON object with these top-level fields:
- store_name (string or null): the merchant name as printed at the top
  of the bill. Strip address lines, phone numbers, GST/UEN codes. Title
  Case is fine. Null if unreadable.
- bill_date (string YYYY-MM-DD, or null): the bill / transaction date.
  Null if not clearly printed.
- currency (string ISO 4217, e.g. "SGD", "USD", "INR", "EUR", or null):
  the currency symbol or code. Use "SGD" for "$" with a Singapore-context
  bill, "USD" if clearly American, "INR" for ₹ or "Rs". Null if unsure.
- total_amount (number or null): the grand total the customer paid.
  Excludes "subtotal" — use the final number after tax. Null if unclear.
- items (array): each entry has:
    - item_name (string, lowercase, no brand prefixes / SKU codes;
      e.g. "basmati rice", "toor dal", "milk").
    - quantity (number or null): purchased amount.
    - unit (string or null): one of "kg", "g", "l", "ml", "piece".
    - price (number or null): the line total in the bill's currency
      (not the per-unit price).

Rules:
- Output only the JSON object. No prose, no markdown fence.
- Skip non-grocery lines in `items`: subtotal, tax, GST, discount,
  loyalty points, store address, payment method, change, "thank you".
- Skip items you cannot confidently identify.
- If the image is not a grocery bill, return:
  {"store_name": null, "bill_date": null, "currency": null,
   "total_amount": null, "items": []}.
- Keep names short (under 60 chars) and lowercase.
```

`BILL_USER_PROMPT`:

```
Extract the bill header and grocery line items from this bill.
```

JSON schema (`output_config.format`):

```ts
{
  type: "json_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["store_name", "bill_date", "currency", "total_amount", "items"],
    properties: {
      store_name: { type: ["string", "null"] },
      bill_date: { type: ["string", "null"] },
      currency: { type: ["string", "null"] },
      total_amount: { type: ["number", "null"] },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["item_name", "quantity", "unit", "price"],
          properties: {
            item_name: { type: "string" },
            quantity: { type: ["number", "null"] },
            unit: { type: ["string", "null"] },
            price: { type: ["number", "null"] },
          },
        },
      },
    },
  },
}
```

## 6. Dedupe key

```ts
type DedupeLine = {
  name: string;   // lower(trim(item_name))
  qty: number | null;
  unit: string | null;
  price: number | null;
};
type DedupeKey = {
  store: string;    // lower(trim(store_name))
  date: string;     // YYYY-MM-DD
  lines: DedupeLine[];  // sorted alphabetically by name, then qty
};
```

Two keys are duplicates when `store === store`, `date === date`, and `lines` is element-wise equal (same length, same name/qty/unit/price tuple, in sorted order). The pure helper `buildBillDedupeKey` lives in `src/app/bills/_dedupe.ts` with the comparison fn `areDedupeKeysEqual` — both are unit-tested.

The query: pull every bill from the household with matching `lower(trim(store_name)) = $1` AND `bill_date = $2`, fetch their `bill_line_items`, build their dedupe keys, run the comparison in JS. Households produce ~tens of bills/month, so this is small and the JS comparison keeps the SQL trivial.

## 7. Tests

- **`src/app/api/bills/scan/_parse.ts`**: same shape as the receipt-scan parser tests — known + unknown currencies, ISO date filter, price normalization, total bill assembly.
- **`src/app/bills/_dedupe.ts`**: builds + compares dedupe keys; ensures sort-order independence; ensures price/qty differences split into distinct keys; ensures case/whitespace differences in store name and item names are normalized.
- **No live LLM tests** — Sonnet SDK call is brittle to mock.

## 8. Out of scope

- The existing `uploadBill` action and `UploadForm` / `/bills/new` page — left untouched. A separate sub-agent deletes them.
- Main navigation changes.
- Storage of the bill image to Supabase.
- Multi-bill batches, model fallback, retries, background queueing.
- Auto-merging bill line items into existing inventory rows (`createInventoryItem` already has unique-name+unit collision handling via the `inventory_items` unique index — the per-item flow is straightforward `insert` here; reconciliation happens at the inventory layer if a future row collides).

## 9. Risks & open questions

- **Sentinel `image_storage_path`.** The legacy bill detail page tries to sign-URL the path; with sentinel `"bill-scan-not-persisted"` the signed URL will fail silently and `imageUrl` will be `null`, so the `<img>` block doesn't render. Acceptable for v1 — the user sees the parsed line items without the photo.
- **Dedupe key brittleness.** Two scans of the same bill with slightly different prices (model misread) will not be deduped. The user can manually delete the second bill. The decision was "exact match for v1", deliberate.
- **`createInventoryItem` per-item.** N round-trips when the user checks N lines. Acceptable for typical bills (≤ 30 lines). If this becomes a hot path we can later switch to a bulk RPC.
- **Currency required at save.** If Sonnet returns `null` and the user forgets to fill it in, save fails. The form blocks submit if currency is empty.
