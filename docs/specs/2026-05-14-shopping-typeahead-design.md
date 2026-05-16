# Shopping: typeahead, duplicate guard, and auto-refresh

> **Superseded as the living architecture doc for the shopping area by [`features/shopping.md`](features/shopping.md).** This dated spec is retained for historical context.

Date: 2026-05-14

## Problem

Three rough edges in the shopping page reported by the user:

1. **No typeahead in the add input.** [`QuickAdd`](../../src/components/shopping/quick-add.tsx)
   takes a name and submits on Enter / `+`. Typing "rice" doesn't surface an
   existing "Basmati Rice" on the list, so it's easy to add the same thing
   twice.
2. **No server-side dedupe.** [`addShoppingItem`](../../src/app/shopping/actions.ts)
   blindly inserts whatever name the client sends. Two rows with the same name
   can coexist on the active list.
3. **Toggling the checkbox doesn't refresh the page sections.** [`ItemRow`](../../src/components/shopping/item-row.tsx)
   calls `markShoppingItemBought` / `unmarkShoppingItemBought` and applies
   strikethrough styling, but the row stays in its current section until the
   user reloads. The user expects the row to move between "needed" and "Show
   bought" automatically.

## Scope

In scope:

- Inline typeahead dropdown below the QuickAdd input that surfaces matching
  existing items (both unbought and bought-in-last-7d).
- Server-side case-insensitive duplicate guard in `addShoppingItem`.
- Auto-refresh of the page lists after toggling bought/unbought.

Out of scope (deferred):

- Fuzzy / lemma matching across recipe ingredient names ("Basmati Rice" vs
  "rice"). Match is plain case-insensitive substring on `item_name`.
- Keyboard arrow-key navigation inside the dropdown (mouse / tap only for v1).
- A separate visible "Refresh" button. Auto-refresh after toggle covers the
  user's "refresh (auto or manual)" requirement; the existing "+ Auto-add 7d"
  button is the manual refresh for plan-driven items.
- Cross-household suggestions (each household sees only its own items; RLS
  already enforces this).

## Changes

### Server action ([src/app/shopping/actions.ts](../../src/app/shopping/actions.ts))

#### `addShoppingItem` — soft duplicate guard

Before the insert, look up an existing **unbought** row with the same
case-insensitive trimmed name in the same household:

```ts
const { data: existing } = await supabase
  .from("shopping_list_items")
  .select("id")
  .eq("household_id", ctx.household.id)
  .is("bought_at", null)
  .ilike("item_name", parsed.data.name)  // exact match, case-insensitive
  .maybeSingle();

if (existing) {
  return { ok: true, data: { itemId: existing.id, alreadyExists: true } };
}
```

`ShoppingActionResult<{ itemId: string }>` is widened to
`ShoppingActionResult<{ itemId: string; alreadyExists?: boolean }>` so the
client can show "Already on list" instead of confusingly silent success.

Note: `ilike("item_name", value)` without `%` wildcards matches the whole
string case-insensitively, which is what we want here.

#### New action: `searchShoppingItems`

Returns up to 8 matches scoped to the user's household, used by the typeahead:

```ts
export async function searchShoppingItems(input: { query: string }):
  Promise<ShoppingActionResult<Array<{
    id: string;
    name: string;
    quantity: number | null;
    unit: string | null;
    notes: string | null;
    boughtAt: string | null;  // null = on the active list
  }>>>
```

Behavior:

- `query` is trimmed; if empty or `< 1` char, return `{ ok: true, data: [] }`.
- `requireHousehold()` for auth + household scoping (RLS also enforces).
- Query: `shopping_list_items` where `item_name ilike '%' || query || '%'`
  AND (`bought_at` IS NULL OR `bought_at >= now() - interval '7 days'`),
  ordered by `bought_at IS NULL DESC` (active first), then `created_at desc`,
  limited to 8.
- The interval matches the existing "last 7d" window on the page so the
  dropdown is consistent with what the user can see.

The function is a server action so it goes through the same auth path as the
other actions in this file. The page-level `useSupabaseClient()` already has
RLS, but routing this through a server action keeps the household scoping
logic in one place and lets us evolve matching (e.g., add fuzzy search) later
without touching the client.

### QuickAdd component ([src/components/shopping/quick-add.tsx](../../src/components/shopping/quick-add.tsx))

Becomes the host for both the input and the suggestion dropdown.

State additions:

```ts
const [matches, setMatches] = useState<SearchResult[]>([]);
const [open, setOpen] = useState(false);
const [searching, startSearch] = useTransition();
```

Debounced search:

- 150ms debounce via `setTimeout` cleared on next keystroke (no library dep).
- Triggered on each `onChange` when the trimmed value length `>= 1`.
- On empty input → clear `matches`, close dropdown.
- Call `searchShoppingItems({ query })`; ignore stale responses by tracking
  the in-flight `query` and comparing to current state on resolve.

Rendering:

- If `open && (matches.length > 0 || trimmed.length > 0)`, render a dropdown
  panel below the input (`absolute`-positioned, full width of the input row).
- Each match row shows:
  - Item name (with the matching substring bolded — simple split, not regex).
  - Status chip: `On list` (no `bought_at`) or `Bought` (has `bought_at`).
  - Right side: action button.
    - `On list` → `Already on list` (disabled-look; clicking closes dropdown
      and clears input).
    - `Bought` → `Add back` (calls `unmarkShoppingItemBought` then refresh).
- Final row is always `+ Add "<typed text>" as new`, which calls the existing
  `addShoppingItem`. If the server responds with `alreadyExists: true`, show
  the same "Already on list" toast and clear the input.

Interactions:

- `onBlur` of the input → delay close by ~120ms so clicks on dropdown rows
  register before the panel disappears.
- `Esc` → close dropdown, keep input value.
- `Enter`:
  - If there's a case-insensitive exact match in `matches`, invoke that row's
    primary action (focus existing for `On list`, `Add back` for `Bought`).
  - Otherwise create new via `addShoppingItem`.
- Submit / successful action → close dropdown, clear input.

Refresh propagation:

- `QuickAdd` receives an optional `onChanged?: () => void` prop. The page
  passes its `refresh` function. `QuickAdd` calls it after any action that
  mutates the list (add, add-back, dedupe-hit-with-server-update).

### ItemRow component ([src/components/shopping/item-row.tsx](../../src/components/shopping/item-row.tsx))

Add optional `onChanged?: () => void` prop. After `markShoppingItemBought` /
`unmarkShoppingItemBought` resolves successfully, call `onChanged?.()`.

`BoughtHistory` passes `onChanged` through to its inner `ItemRow`s.

### Page ([src/app/shopping/page.tsx](../../src/app/shopping/page.tsx))

- Pass `onChanged={refresh}` to `<QuickAdd>`, `<ItemRow>`, and
  `<BoughtHistory>` (which forwards to its rows).
- No other change. The existing `refresh()` function already does the right
  thing (re-fetch unbought + last-7d bought).

### BoughtHistory component ([src/components/shopping/bought-history.tsx](../../src/components/shopping/bought-history.tsx))

Accept and forward `onChanged?: () => void` to each `ItemRow`.

## Data flow

1. User types "ric" → debounced 150ms → `searchShoppingItems({ query: "ric" })`
   → returns `[{ name: "Basmati Rice", boughtAt: null, ... }]`.
2. Dropdown shows "Basmati Rice · On list · Already on list" + "+ Add 'ric' as
   new".
3. User taps the "Basmati Rice" row → dropdown closes, input clears, no
   network mutation, no duplicate created.

For the bought-and-needed-again case:

1. User types "rice" → match returns "Basmati Rice" with `boughtAt` set.
2. Dropdown shows "Basmati Rice · Bought · Add back".
3. User taps "Add back" → `unmarkShoppingItemBought` → `refresh()` → row
   reappears in the active list.

For the add-via-Enter case where the server detects a dupe:

1. User types "Rice" (no existing match within debounce window — e.g., they
   typed and hit Enter too fast) → submit → server finds existing unbought
   "rice" → returns `{ ok: true, data: { itemId, alreadyExists: true } }`.
2. Client shows "Already on list" inline message, clears input, calls
   `refresh()` (harmless if nothing changed).

## Validation

- Server: `searchShoppingItems` validates `query` length `<= 120` (matches the
  existing `NameSchema` bound) and trims. Returns empty list on empty input.
- Server: `addShoppingItem` dedupe check uses `.ilike()` for exact
  case-insensitive match, scoped to the user's household (already enforced
  by `requireHousehold()` + RLS).
- Client: dropdown handles in-flight race conditions by tracking the most
  recent query string and ignoring stale resolves.

## Testing

- `pnpm test` / `npm test`: existing suite stays green.
- Manual browser check (per AGENTS.md):
  1. With an item "Basmati Rice" on the active list, type "rice" → dropdown
     shows it with "Already on list".
  2. Mark "Basmati Rice" bought → it moves to "Show bought (last 7d)"
     immediately (no manual reload).
  3. Type "rice" again → dropdown now shows "Bought · Add back".
  4. Tap "Add back" → row reappears in the active list immediately.
  5. With nothing typed, dropdown stays closed.
  6. Type a brand-new name, hit Enter → row appears in the active list.
  7. Hit Enter again with the same name → "Already on list" message, no
     duplicate row.

## Risks / open questions

- **Debounce vs perceived latency.** 150ms feels snappy on desktop; on a
  flaky mobile connection it might noticeably lag. The fallback is the
  "+ Add as new" row which works without waiting for matches.
- **`.ilike()` performance.** Without a trigram index, substring search on
  `item_name` is a sequential scan. Each household's list is small (tens to
  low hundreds of rows), so this is fine. If it ever isn't, add a
  `pg_trgm` GIN index on `lower(item_name)`.
- **`alreadyExists` widens the return shape.** Existing callers of
  `addShoppingItem` only destructure `itemId`; the optional flag is
  backwards-compatible.
