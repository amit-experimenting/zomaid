# Zomaid — Inventory Onboarding: Per-Item Default Units + Custom Rows — Design

- **Date**: 2026-05-14
- **Status**: Approved (brainstorming) — pending implementation plan
- **Scope**: [src/app/inventory/new/page.tsx](../../src/app/inventory/new/page.tsx) onboarding form only (`?onboarding=1`). The non-onboarding single-item add path is unchanged.

## 1. Context

The onboarding inventory form at `/inventory/new?onboarding=1` renders 15 starter items with a quantity input and a unit `<select>`. Every dropdown defaults to `kg`, which is wrong for items typically sold by litre (cooking oil, milk), discrete pieces (eggs), or small mass (ginger, garlic, turmeric powder, ghee). Users also can't add anything outside the 15 hard-coded items, which forces them to abandon onboarding and come back via the single-item flow for any unlisted item.

This spec makes two changes:

1. Each starter item gets a sensible default unit.
2. Users can append free-text custom rows (name + qty + unit) and submit them in the same Save action.

## 2. Decisions log (from brainstorming, 2026-05-14)

| Q | Decision |
|---|---|
| Unit options per dropdown | **Unchanged — all five options (kg/g/l/ml/piece) on every row.** Only the default selection varies per starter item. Keeps the UI uniform and lets users override. |
| Custom row name input | **Free text.** No autocomplete from the seed conversions table. Simplicity over data hygiene; conversion lookup is name-based and falls back to "unstocked" if unknown, so a typo doesn't break anything downstream. |
| Custom row default unit | **`kg`.** No per-row signal to do better, and the user is already filling a unit selector. |
| Custom row removal | **Yes — each custom row has an "×" remove button.** Starter rows have no remove (they're optional via qty=0). |
| Add-row cap | **No cap.** A user filling 30 items in onboarding is rare but not worth a hard limit. |
| Server action shape | **Move `submitOnboarding` from inline to [src/app/inventory/actions.ts](../../src/app/inventory/actions.ts).** A client component cannot define `"use server"` inline actions; the export must come from a server module. |
| Validation | **Reuse existing `createInventoryItem` Zod schema.** Bulk action loops and calls per row; if one row fails (e.g. empty name) it is skipped silently, matching today's silent skip on `q <= 0`. |
| Persistence across reload | **Out of scope.** Custom rows live in client state only. Reload = start over. |
| Reorder rows | **Out of scope.** Starter items render in their fixed order; custom rows render in append order. |
| Item-name suggestions / autocomplete | **Out of scope.** |

## 3. Default units per starter item

| Item | Default | Item | Default |
|---|---|---|---|
| basmati rice | kg | eggs | piece |
| toor dal | kg | onion | kg |
| urad dal | kg | tomato | kg |
| whole wheat flour | kg | ginger | g |
| cooking oil | l | garlic | g |
| ghee | g | turmeric powder | g |
| salt | kg | milk | l |
| sugar | kg | | |

Reasoning: rice / dals / flours / large produce are weighed in kg in IN supermarkets and mandis; oil and milk are sold by the litre; eggs are discrete; spices and ghee come in 100–500 g packs.

The `<select>` `defaultValue` is set per row to match the table above. All five options remain selectable.

## 4. File-level changes

### 4.1 [src/app/inventory/new/page.tsx](../../src/app/inventory/new/page.tsx)

- Replace the `STARTER_ITEMS` `as const` string tuple with an array of `{ name, defaultUnit }` tuples (typed `readonly`).
- Delete the inline `submitOnboarding` server action (moves to actions.ts — see 4.2).
- Replace the inline onboarding `<form>` with `<OnboardingInventoryForm starterItems={STARTER_ITEMS} />` (see 4.3).
- The `submitSingle` inline action and the non-onboarding form are unchanged.
- Page remains a server component (auth check, role gate, search-param read).

### 4.2 [src/app/inventory/actions.ts](../../src/app/inventory/actions.ts)

Add `createInventoryItemsBulk(formData: FormData)`:

- Marked `"use server"` (file is already a server-actions module).
- Calls `requireHousehold()`.
- Iterates the known starter-item names: reads `qty_${name}` and `unit_${name}` keys; for each row with `qty > 0` and a non-empty unit, calls `createInventoryItem({ item_name: name, quantity, unit })`.
- Iterates FormData entries: for each key matching `custom_name_<n>` where `n` is a non-negative integer, reads the paired `custom_qty_<n>` and `custom_unit_<n>`. If `name.trim() !== ""` and `qty > 0` and `unit !== ""`, calls `createInventoryItem(...)`.
- Calls `redirect("/dashboard")` on completion (mirrors today's behavior).
- Returns nothing (server action form submission).

The starter-item list (name + default unit) is exported from `actions.ts` as `STARTER_ITEMS` so the page, the client component, and this action share one source of truth. The action only needs the names; the page and client component need the defaults.

### 4.3 New: [src/app/inventory/new/_onboarding-form.tsx](../../src/app/inventory/new/_onboarding-form.tsx)

`"use client"`. Imports `createInventoryItemsBulk` from `@/app/inventory/actions`.

Props: `{ starterItems: ReadonlyArray<{ name: string; defaultUnit: string }> }`.

State: `const [customRows, setCustomRows] = useState<Array<{ id: number }>>([])` plus a `nextId` ref/counter so removal-by-id is stable across re-renders.

Render:

1. `<form action={createInventoryItemsBulk} className="flex flex-col gap-3 px-4 py-2">`.
2. For each starter item: identical layout to today (`grid grid-cols-[1fr_80px_80px]`). Quantity input keyed `qty_${name}`, unit `<select>` keyed `unit_${name}` with `defaultValue={item.defaultUnit}`.
3. For each custom row (index `i`, stable `id`): four-column grid (`1fr_80px_80px_24px`). Inputs keyed `custom_name_${i}`, `custom_qty_${i}`, `custom_unit_${i}`; trailing `×` button calls `setCustomRows(r => r.filter(x => x.id !== row.id))`, `type="button"`.
4. `<button type="button" onClick={addRow}>+ Add another item</button>` below the rows; styled as a quiet secondary button.
5. `<Button type="submit">Save inventory</Button>` at the bottom (existing component).

`addRow` appends `{ id: nextId++ }`. Index-in-the-array (not id) is used in the FormData key names, so re-renders use stable indices on the form payload. (Server action does not rely on contiguous indices anyway — it scans for any `custom_name_*` key.)

No `aria-live`, no toasts, no client-side validation. The native HTML `min="0"` / `step="0.01"` carries over; empty rows are silently dropped by the server action.

## 5. Tests

- **Existing:** [tests/e2e/inventory.spec.ts](../../tests/e2e/inventory.spec.ts) and the `tests/db/inventory-*.test.ts` suite must remain green.
- **New e2e:** at `tests/e2e/inventory.spec.ts` (extend the file, don't make a new one):
  1. Sign in as an owner whose household has zero inventory items.
  2. Navigate to `/inventory/new?onboarding=1`.
  3. Assert the `cooking oil` row's unit `<select>` shows `l` selected, and the `eggs` row shows `piece`.
  4. Click `+ Add another item`.
  5. Fill the custom row: name = `paneer`, qty = `0.25`, unit = `kg`.
  6. Fill a starter row: `milk` qty = `2` (unit pre-defaults to `l`).
  7. Click `Save inventory`; assert redirect to `/dashboard`.
  8. Navigate to `/inventory`; assert both `paneer` (0.25 kg) and `milk` (2 l) appear.

No DB-level unit tests needed; the action is a thin loop over `createInventoryItem`, which already has DB coverage.

## 6. Out of scope

- Item-name autocomplete from the conversions seed.
- Per-row unit suggestions for custom items (e.g. "you typed paneer, did you mean g?").
- Row reordering, drag-to-rearrange.
- Persisting partially-filled onboarding across reloads or sessions.
- Editing the starter list, hiding rows the user said no to, or remembering "user dismissed this starter".
- Bulk import (CSV, photo, etc.) — separate slice.

## 7. Risks

- **Stale FormData keys on re-render.** Mitigated by using stable `id`s in React keys (so React reconciles correctly) while keys in FormData use indices that match the current render order. Server action does not care about contiguous indices, only matching `custom_name_n` ↔ `custom_qty_n` ↔ `custom_unit_n` pairs.
- **Empty custom-row spam.** Server action silently drops rows with empty name or `qty <= 0`, same posture as today's starter-row handling. No error surfaced to the user.
- **No transaction around bulk insert.** Today's action also inserts one row at a time; partial failure leaves a partial save. Acceptable for v1 — `createInventoryItem` failures are unlikely in practice and the user can retry. If we revisit, wrap in a single RPC.
