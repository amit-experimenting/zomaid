# Zomaid — Inventory Onboarding: Per-Item Default Units + Custom Rows — Design

> **Superseded as the living architecture doc for the inventory area by [`features/inventory.md`](features/inventory.md).** This dated spec is retained for historical context.
> **Superseded as the living architecture doc for the onboarding area by [`features/onboarding.md`](features/onboarding.md).** This dated spec is retained for historical context.

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
- Calls `parseOnboardingFormData(formData, STARTER_ITEMS.map(i => i.name))` (see 4.4) to get the list of `{ name, quantity, unit }` rows.
- For each parsed row, calls `createInventoryItem({ item_name: name, quantity, unit })`. Failures are silently dropped (matches today's silent-skip posture on `q <= 0`).
- Calls `redirect("/dashboard")` on completion (mirrors today's behavior).
- Returns nothing (server action form submission).

The starter-item list (name + default unit) is exported from `actions.ts` as `STARTER_ITEMS` so the page, the client component, and this action share one source of truth. The action only needs the names; the page and client component need the defaults.

### 4.4 New: [src/app/inventory/_onboarding-parse.ts](../../src/app/inventory/_onboarding-parse.ts)

Pure helper with no React, no DB, no auth dependencies — exists so the FormData parsing logic is unit-testable in isolation.

```ts
export type OnboardingRow = { name: string; quantity: number; unit: string };

export function parseOnboardingFormData(
  formData: FormData,
  starterNames: readonly string[],
): OnboardingRow[];
```

Behavior:

- For each `name` in `starterNames`: read `qty_${name}` and `unit_${name}`. Coerce qty via `Number(...)`. If `Number.isFinite(qty) && qty > 0 && typeof unit === "string" && unit.length > 0`, emit `{ name, quantity: qty, unit }`.
- Then scan all FormData keys: for each key matching `/^custom_name_(\d+)$/`, capture the index, read paired `custom_qty_<n>` and `custom_unit_<n>`. If `name.trim() !== ""`, `Number.isFinite(qty) && qty > 0`, and `unit.length > 0`, emit `{ name: name.trim(), quantity: qty, unit }`.
- Order: all surviving starter rows first (in `starterNames` order), then custom rows (in ascending index order).
- Sparse indices are fine — the scan keys off `custom_name_*` presence, not contiguity.

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

The project has no authenticated e2e harness (existing `tests/e2e/inventory.spec.ts` only tests unauthenticated redirects), and a UI-level test for default `<select>` values is brittle. So testing is split:

- **Pure FormData parser, unit-tested.** Extract `parseOnboardingFormData(formData, starterNames)` returning `Array<{ name: string; quantity: number; unit: string }>` as a pure helper (no DB, no auth) in [src/app/inventory/_onboarding-parse.ts](../../src/app/inventory/_onboarding-parse.ts). The server action calls it. Unit tests at [tests/unit/inventory-onboarding-parse.test.ts](../../tests/unit/inventory-onboarding-parse.test.ts) cover: starter rows with `qty > 0` parsed correctly; starter rows with `qty = 0` skipped; starter rows with `qty < 0` or non-numeric skipped; custom rows with non-empty name + `qty > 0` + unit parsed; custom rows missing any of those skipped; sparse indices (e.g. `custom_name_0` and `custom_name_3` with 1/2 removed) handled.
- **Existing e2e:** [tests/e2e/inventory.spec.ts](../../tests/e2e/inventory.spec.ts) must remain green — `/inventory/new` still redirects when unauthenticated. No new e2e added.
- **Existing db tests:** `tests/db/inventory-*.test.ts` continue to cover `createInventoryItem`'s DB behavior; the bulk action is a thin loop over it.

Manual verification (UI defaults aren't asserted in tests):

1. `pnpm dev`, sign in as owner of a household with no inventory items, visit `/inventory/new?onboarding=1`.
2. Confirm cooking oil and milk show `l`; eggs shows `piece`; ghee, ginger, garlic, turmeric powder show `g`; everything else shows `kg`.
3. Click `+ Add another item`, fill name=`paneer` qty=`0.25` unit=`kg`. Save. Confirm `/dashboard` redirect and `paneer` visible in `/inventory`.

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
