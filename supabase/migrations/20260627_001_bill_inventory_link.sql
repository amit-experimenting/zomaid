-- Defensive: ensure bill_line_items has the inventory-link FK.
-- The column was first added in 20260611_001_inventory_column_additions.sql
-- (as part of the legacy bill-ingest review queue). The new
-- /inventory/new "Upload bill" tab depends on it too, so we re-assert the
-- contract here with IF NOT EXISTS so the migration is safe to apply on
-- any environment whether or not the earlier migration ran.
--
-- Nullable on purpose: bill line items the user explicitly chose NOT to
-- push to inventory (or empty-name skip rows in legacy data) stay NULL.
-- No index — low cardinality, joins are rare and small.

alter table public.bill_line_items
  add column if not exists matched_inventory_item_id uuid
    references public.inventory_items(id) on delete set null;
