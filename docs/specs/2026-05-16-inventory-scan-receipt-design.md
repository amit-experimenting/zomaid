# Zomaid — Inventory: Scan a Receipt (Claude Vision Pre-fill) — Design

- **Date**: 2026-05-16
- **Status**: Approved (no clarifications outstanding) — implementing in same session
- **Scope**: [src/app/inventory/new/page.tsx](../../src/app/inventory/new/page.tsx) gets a second entry mode ("Scan receipt") alongside the existing manual onboarding form. A new server route accepts the photo, calls Claude Sonnet 4.6 vision, and returns a list of line items that the client renders into an editable pre-filled form. Save goes through the existing inventory-create action — no schema changes, no bills coupling.

## 1. Context

`/inventory/new` currently shows the [OnboardingInventoryForm](../../src/app/inventory/new/_onboarding-form.tsx) (15 starter rows + free-form custom rows). Users adding many items from a grocery receipt have to type each one — laborious and error-prone. We want a "snap a photo" shortcut that pre-fills the same form.

The bills flow (`/bills`) does something superficially similar (OCR via Claude over GitHub webhooks) but is intentionally separate — bills track expense history with line items linked to a `bill` row; inventory-scan is just an input-method shortcut into inventory creation. **No bill row is created and the receipt image is not persisted.**

## 2. Decisions log (agreed up front, 2026-05-16)

| Q | Decision |
|---|---|
| Tabs UI | Two-button toggle at top of `/inventory/new`. No tab library. Default selection: "Manual" (preserves today's behavior for users with the page bookmarked). |
| Tab visibility | Both tabs shown always when the page renders (auth + role gate unchanged). |
| Onboarding mode (`?onboarding=1`) | Tabs disabled — onboarding still shows the existing form only. This avoids dragging Claude into a setup-first-load critical path. |
| LLM | Anthropic `@anthropic-ai/sdk`, model id **`claude-sonnet-4-6`** exactly. |
| Image input | base64-encoded JPEG/PNG/WebP via the SDK's `image` content block. |
| Structured output | **JSON-only system prompt + strict response parsing.** No tool use; the Sonnet 4.6 family supports `output_config.format` with a JSON schema, which we use for a 1-call structured response. |
| Allowed units | `kg`, `g`, `l`, `ml`, `piece` (matches [STARTER_ITEMS](../../src/app/inventory/_starter-items.ts) and onboarding `<select>` options). |
| Unit coercion | Server-side coercion of common variants (`liter`→`l`, `litre`→`l`, `gram(s)`→`g`, `kilogram(s)`→`kg`, `kg.`→`kg`, `ml.`→`ml`, `each`/`pcs`/`pc`/`pack(s)`→`piece`, case-insensitive). Anything still unrecognised after coercion is dropped (the field becomes empty so the user picks). |
| Quantity | If absent or unparseable, leave empty on the pre-filled form. |
| Image size limit | 5 MB after client-side compression. Server re-validates. |
| Compression | `browser-image-compression`, same library and pattern as [recipe-form.tsx](../../src/components/recipes/recipe-form.tsx) and [bills/upload-form.tsx](../../src/components/bills/upload-form.tsx). Target ~1.5 MB / max 2400 px. |
| Retries / streaming | None. One-shot non-streaming call, 30 s overall timeout. Surface a single error string to the user. |
| Auto-save | No. Scan output is only ever a pre-fill; the user clicks **Save inventory** explicitly. |
| Image storage | None. The bytes go to Claude in-flight and are immediately garbage-collected. No Supabase Storage, no on-disk copy. |
| Auth on the route | Same `requireHousehold()` + owner/maid role gate as page (server route reuses the helper). |
| Anthropic key location | `ANTHROPIC_API_KEY` env var. Server-only — never imported into a client component. Documented in [.env.local.example](../../.env.local.example). |
| Failure behavior | If the parse returns zero items or the API call errors, surface the message in red below the file picker and leave the existing pre-fill (if any) untouched. |

## 3. Architecture

```
[user picks file]
       │  client-side compress (browser-image-compression)
       ▼
[POST /api/inventory/scan, multipart 'image=<file>']
       │  requireHousehold + role check
       │  validate mime / size
       │  base64 + Anthropic.messages.create({ model: claude-sonnet-4-6, ... })
       │  parse + coerce units + drop unknowns
       ▼
[{ items: [{ item_name, quantity?, unit? }, ...] }]
       │
       ▼
[client renders editable rows in _scan-form.tsx]
       │  user edits / removes / adds rows / clicks Save
       ▼
[server action: createInventoryItemsBulk via FormData (reuses existing path)]
       │
       ▼
[redirect /inventory]
```

The scan route does not touch the DB; saving the items is the existing `createInventoryItemsBulk` action, which loops over `createInventoryItem`. We reuse the bulk action's FormData contract (`custom_name_<i>`, `custom_qty_<i>`, `custom_unit_<i>`) so the parser doesn't have to know about scanned vs custom rows.

## 4. File-level changes

### 4.1 New: [src/app/api/inventory/scan/route.ts](../../src/app/api/inventory/scan/route.ts)

`POST` only. Returns `{ items: ParsedItem[] }` on success, `{ error: string }` on failure (HTTP 200 on validation failures so the client can render the message; 4xx on auth, 5xx on upstream errors).

Flow:
1. `await requireHousehold()`; if role isn't `owner` or `maid`, return 403.
2. `const form = await request.formData()`. Pull `image` (must be a `File`). Validate `type` ∈ allowed MIME set, `size` ≤ 5 MB.
3. Read bytes, base64 encode, build the Anthropic request:
   - `model: "claude-sonnet-4-6"`
   - `max_tokens: 2048`
   - `system: SCAN_SYSTEM_PROMPT` (see §5)
   - `messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type, data } }, { type: "text", text: SCAN_USER_PROMPT }] }]`
   - `output_config: { format: { type: "json_schema", schema: ITEM_LIST_SCHEMA } }` — Sonnet 4.6 enforces this strictly.
4. Wrap the call in `Promise.race(call, sleep(30_000).then(reject))` for a 30 s overall timeout.
5. Parse `response.content` looking for the first `text` block, `JSON.parse` it, validate with a Zod schema mirroring `ITEM_LIST_SCHEMA`.
6. Map each item: lowercase + trim name; coerce unit via small table; if unit isn't in `kg|g|l|ml|piece` after coercion, set `unit` to `null`. Quantity passes through if finite > 0; otherwise `null`.
7. Return `Response.json({ items: cleaned })`.

Errors:
- Missing key → `Response.json({ error: "Receipt scanning is not configured." }, { status: 500 })`.
- Anthropic SDK error → log to console, return `{ error: "Couldn't read that receipt. Try a clearer photo." }`.
- Validation / parse failure → same friendly error.

Cache + prompt caching: the system prompt is a frozen string > 1k tokens with a `cache_control: { type: "ephemeral" }` breakpoint on the last system block, so repeated scans on the same dev server hit the prefix cache. (Optimization — does not affect correctness.)

### 4.2 New: [src/app/inventory/new/_scan-form.tsx](../../src/app/inventory/new/_scan-form.tsx)

`"use client"`. Imports `createInventoryItemsBulk` from `@/app/inventory/actions`.

State:
- `phase: "idle" | "compressing" | "scanning" | "ready" | "error"`
- `items: Array<{ id: number; name: string; quantity: string; unit: string }>` (id stable across renders, name/qty/unit mutable)
- `error: string | null`

Render:
1. `<form action={createInventoryItemsBulk}>` wrapping everything (Save uses the bulk action directly).
2. File input (`accept="image/jpeg,image/png,image/webp"`, `capture="environment"` for mobile camera).
3. `<PendingButton type="button" pending={phase === "compressing" || phase === "scanning"} onClick={onScan}>Scan</PendingButton>` — triggers `POST /api/inventory/scan`, updates `items`.
4. If `items.length > 0`: render each as a 4-col grid identical to `CustomRowFields` in the onboarding form (`1fr_80px_80px_24px`), with name/qty/unit inputs whose `name` attributes are `custom_name_<i>`, `custom_qty_<i>`, `custom_unit_<i>` so the bulk parser picks them up. Each row has an `×` remove button.
5. `<button type="button">+ Add row</button>` — appends a blank editable row (still in the `custom_*` namespace, so the parser doesn't care if it was scanned or manually added).
6. `<PendingButton type="submit">Save inventory</PendingButton>` — disabled when `items.length === 0`.
7. Error string in red below the file picker.

Editing logic is a small controlled-input setup; the row id is React's key, the index in `items` is the FormData index.

### 4.3 Update: [src/app/inventory/new/page.tsx](../../src/app/inventory/new/page.tsx)

- Add a `mode` search-param (`?mode=scan`) defaulting to `manual`. When `?onboarding=1` is set, ignore `mode` and render manual only (keeps onboarding bulletproof).
- Above the form (and above the single-item form), render two `<Link>` buttons styled as tabs:
   - "Manual" → `/inventory/new`
   - "Scan receipt" → `/inventory/new?mode=scan`
- Active tab gets `border-b-2 border-primary`; inactive is muted.
- Conditional render: `mode === "scan" ? <ScanForm /> : (isOnboarding ? <OnboardingInventoryForm /> : <singleItemForm />)`.

The single-item add path (the existing default for non-onboarding) stays — the tabs sit between the header and the form. Result is 3 routes:
   - `/inventory/new` → single-item manual
   - `/inventory/new?mode=scan` → scan flow
   - `/inventory/new?onboarding=1` → onboarding form (no tabs, unchanged)

### 4.4 Update: [.env.local.example](../../.env.local.example)

Add at the bottom (after the cron block):

```
# ── Anthropic API (slice: inventory scan) ──────────────────────────
# Used by /api/inventory/scan to parse uploaded receipt photos with
# Claude Sonnet 4.6 vision. Server-only, never exposed to the client.
# Get from https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=replace_me
```

## 5. Prompt template

`SCAN_SYSTEM_PROMPT` (frozen, cacheable):

```
You extract grocery line items from a photo of a paper retail receipt.

Return a JSON object with a single key "items" whose value is an array.
Each item is an object with three fields:
- item_name (string, required): the human-readable name in lowercase,
  with brand prefixes/SKU numbers/store codes stripped. e.g. "basmati
  rice", "toor dal", "tomato", "ghee", "milk".
- quantity (number or null): the amount the customer purchased, NOT
  the unit price. If the receipt shows weight (1.5 kg), use that; if
  it shows count (12 eggs), use that; if unclear, null.
- unit (string or null): one of "kg", "g", "l", "ml", "piece", or null
  if unsure. Default to "piece" for discrete items (eggs, bread loaves,
  packets) only when count is obvious.

Rules:
- Output only the JSON object. No prose, no markdown fence, no commentary.
- Skip non-grocery lines: subtotal, tax, GST, discount, loyalty points,
  store address, cashier name, payment method, change, "thank you".
- Skip items you cannot confidently identify. Missing items are better
  than hallucinated items.
- If the image is not a grocery receipt, return {"items": []}.
- Keep names short (under 60 chars) and lowercase.
```

`SCAN_USER_PROMPT`:

```
Extract the grocery line items from this receipt.
```

JSON schema (`output_config.format`):

```ts
{
  type: "json_schema",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["item_name", "quantity", "unit"],
          properties: {
            item_name: { type: "string" },
            quantity: { type: ["number", "null"] },
            unit: { type: ["string", "null"] },
          },
        },
      },
    },
  },
}
```

## 6. Server-side unit coercion table

| Raw value (lowercased, trimmed, trailing `.` and `s` stripped) | Coerced to |
|---|---|
| `kg`, `kilogram`, `kilo` | `kg` |
| `g`, `gm`, `gram` | `g` |
| `l`, `lt`, `liter`, `litre` | `l` |
| `ml`, `milliliter`, `millilitre` | `ml` |
| `piece`, `pc`, `pcs`, `pack`, `packet`, `box`, `each`, `unit`, `ea` | `piece` |
| anything else | `null` (user picks in dropdown) |

## 7. Tests

- **Pure helpers (unit-testable):** the unit-coercion function and the Zod parser for the model's JSON response live in [src/app/api/inventory/scan/_parse.ts](../../src/app/api/inventory/scan/_parse.ts) so they can be tested without mocking the SDK. Cover: known units, common variants (case, trailing dot, plural), unknown units → null, non-finite quantity → null, names trimmed/lowercased, malformed shape → empty list.
- **No live LLM tests.** Mocking `@anthropic-ai/sdk` in vitest is brittle and the user will exercise the end-to-end flow live.
- **No new e2e** — existing `/inventory/new` redirect test stays green.

## 8. Out of scope

- Bills (`/bills`) integration. The scan route does not create a `bill` row.
- Inventory schema changes.
- Receipt image storage, even temporary.
- Streaming responses, multi-image batches, model fallback (Haiku) on Sonnet failure.
- Auto-merge with existing inventory rows (e.g. "you already have basmati rice, +2 kg?"). v1 always creates new rows; the user can deduplicate by editing names.
- LLM retries, queue, background jobs.
- Anthropic SDK mocking in tests.

## 9. Risks & open questions

- **Latency.** One Sonnet 4.6 vision call on a 1–2 MP image is typically 5–15 s. The 30 s server timeout is generous but not unlimited; users on bad connections may see the friendly error. Acceptable for v1.
- **Hallucinated items.** The prompt explicitly tells the model to skip rather than guess; the user reviews every row before saving. Worst case is one or two missing items that the user adds with `+ Add row`.
- **Cost.** ~$3/MTok input, ~$15/MTok output. A 1.5 MB image is ~2k input tokens + a few hundred output tokens — well under a cent per scan.
- **Key leakage.** `ANTHROPIC_API_KEY` is read only in the server route module, which is never bundled to the client. The route file does not export the key.
- **Unit drift.** If the conversions table changes later, the coercion table here should follow. There's only one consumer of these units (the inventory unit `<select>`), so the drift surface is small.
