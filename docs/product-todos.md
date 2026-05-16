# Product TODOs

Items where the product surface is incomplete relative to what the data model supports.
Surfaced during the 2026-05-16 codebase audit.

## Inventory item detail page

`/inventory/[id]` is read-only. The page renders item state but provides no edit or delete UI.

The corresponding server actions (`updateInventoryItem`, `deleteInventoryItem`) were removed
in Phase 4 of the audit (no callers). When the product wants this feature:
- Re-add the actions following the same shape as `createInventoryItem` / `adjustInventoryItem`
- Add edit form + delete confirm on `/inventory/[id]/page.tsx`
- Recommend reusing `InventoryItemForm` from `/inventory/new` for the edit form
