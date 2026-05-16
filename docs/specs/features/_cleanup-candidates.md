# Dead code cleanup candidates

Working list for Phase 3 of the codebase audit. Each candidate is verified manually
(via `rg` across `src/`, `tests/`, `supabase/`, `docs/HANDOFF.md`) before removal in Task 27.

Generated 2026-05-16 using `npx knip` (JSON reporter). Pre-existing "appears unused"
flags from feature specs about server actions or DB columns are NOT included here —
those need product decisions, not mechanical cleanup.

Filtering notes:
- `src/app/sw.ts` excluded — referenced from `next.config.ts` as `swSrc` (serwist).
- `tests/helpers/clerk.ts` `mockClerkUnauthed` excluded — lives under `tests/`.
- Server actions with no UI callers (`src/app/{inventory,bills,recipes,tasks}/actions.ts`:
  `updateInventoryItem`, `deleteInventoryItem`, `deleteBill`, `archiveRecipe`,
  `unarchiveRecipe`, `hideStarterRecipe`, `unhideStarterRecipe`, `archiveTask`,
  `unhideStandardTask`) excluded — these are pre-existing feature-spec flags that
  need product decisions, not mechanical removal.
- `package.json` unused-binary/dep entries from knip excluded — dep removal is out
  of scope for Phase 3.
- `src/lib/admin/env-sync.ts` "unlisted server-only" excluded — not a dead-code
  candidate, just a missing devDep listing.

## Unimported files
- _(none found)_

## Unused exports
- [x] `src/app/api/bills/scan/_parse.ts` — exports `ModelBillResponseSchema` — removed `export` keyword; used internally only
- [x] `src/app/api/bills/scan/_parse.ts` — exports type `ParsedBillLine` — removed `export` keyword; used internally only
- [x] `src/app/api/inventory/scan/_parse.ts` — exports `SCAN_UNITS`, `ModelResponseSchema` — removed `export` keyword on both; used internally only (SCAN_UNITS still backs exported ScanUnit type)
- [x] `src/app/bills/_dedupe.ts` — exports type `DedupeLine` — removed `export` keyword; used internally only
- [x] `src/lib/db/types.ts` — exports types `MembershipStatus`, `IntendedRole`, `MaidMode` — removed `export` from MembershipStatus and MaidMode (used in Database type); removed IntendedRole entirely (unused alias)
- [x] `src/lib/auth/current-household.ts` — exports types `Membership`, `Household` — removed `export` keyword; used internally only in CurrentHousehold
- [x] `src/components/plan/slot-row.tsx` — exports type `SlotRowOwnProps` — removed `export` keyword; used internally only
- [x] `src/components/bills/bill-confirm-form.tsx` — exports type `ConfirmFormInitialItem` — removed `export` keyword; used internally only

## Unused shadcn primitives
- [x] `src/components/ui/dropdown-menu.tsx` — deleted; only self-references in file. HANDOFF mention is historical note about the primitive being added.
- [x] `src/components/ui/card.tsx` — exports `CardFooter`, `CardAction` — deleted both functions and their export entries; zero callers
- [x] `src/components/ui/sheet.tsx` — exports `SheetClose`, `SheetFooter`, `SheetDescription` — deleted all three components and exports; zero callers
- [x] `src/components/ui/dialog.tsx` — exports `DialogClose`, `DialogDescription`, `DialogFooter`, `DialogOverlay`, `DialogPortal` — deleted DialogClose, DialogDescription, DialogFooter components; kept DialogPortal and DialogOverlay (used internally by DialogContent) but removed their exports

## Unused lib helpers
- [x] `src/lib/auth/require.ts` — exports `requireRole`, `requirePrivilege` — deleted both functions; also dropped unused Privilege/Role imports. requireHousehold and requireAdmin retained.
