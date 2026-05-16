// Bill-scan response parser.
//
// Mirrors the shape of the receipt-scan parser but adds header-level
// fields (store name, bill date, currency, total) plus a per-line
// `price` field. Reuses unit / name / quantity normalisation from the
// receipt-scan parser so we have a single source of truth for units.
//
// Pure functions only — no side effects, no Anthropic SDK references.
// Imported by both the API route (in production) and the unit tests.

import { z } from "zod";
import {
  coerceUnit,
  normalizeName,
  normalizeQuantity,
  type ScanUnit,
} from "@/lib/scan/parse-helpers";

type ParsedBillLine = {
  item_name: string;
  quantity: number | null;
  unit: ScanUnit | null;
  price: number | null;
};

export type ParsedBill = {
  store_name: string | null;
  bill_date: string | null; // YYYY-MM-DD
  currency: string | null; // ISO 4217-ish, 3-letter uppercase
  total_amount: number | null;
  items: ParsedBillLine[];
};

// Permissive at the schema level — we coerce/null fields in
// parseBillScanResponse so a single bad field doesn't drop the row.
const ModelBillResponseSchema = z
  .object({
    store_name: z.unknown().optional(),
    bill_date: z.unknown().optional(),
    currency: z.unknown().optional(),
    total_amount: z.unknown().optional(),
    items: z
      .array(
        z
          .object({
            item_name: z.string(),
            quantity: z.unknown().optional(),
            unit: z.unknown().optional(),
            price: z.unknown().optional(),
          })
          .passthrough(),
      )
      .max(200),
  })
  .passthrough();

export function normalizeStoreName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length === 0) return null;
  // Cap at the column's check-constraint width.
  return s.slice(0, 200);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeBillDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!ISO_DATE_RE.test(s)) return null;
  // Quick sanity: must parse to a real calendar date.
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Round-trip check rejects 2026-02-30 etc.
  if (d.toISOString().slice(0, 10) !== s) return null;
  return s;
}

const CURRENCY_RE = /^[A-Z]{3}$/;

export function normalizeCurrency(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  if (!CURRENCY_RE.test(s)) return null;
  return s;
}

export function normalizePrice(raw: unknown): number | null {
  if (typeof raw !== "number") return null;
  if (!Number.isFinite(raw)) return null;
  if (raw < 0) return null;
  // Round to 2 dp — receipts are cents.
  return Math.round(raw * 100) / 100;
}

export function parseBillScanResponse(raw: unknown): ParsedBill {
  const parsed = ModelBillResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      store_name: null,
      bill_date: null,
      currency: null,
      total_amount: null,
      items: [],
    };
  }
  const items: ParsedBillLine[] = [];
  for (const item of parsed.data.items) {
    const name = normalizeName(item.item_name);
    if (name.length === 0) continue;
    items.push({
      item_name: name,
      quantity: normalizeQuantity(item.quantity),
      unit: coerceUnit(item.unit),
      price: normalizePrice(item.price),
    });
  }
  return {
    store_name: normalizeStoreName(parsed.data.store_name),
    bill_date: normalizeBillDate(parsed.data.bill_date),
    currency: normalizeCurrency(parsed.data.currency),
    total_amount: normalizePrice(parsed.data.total_amount),
    items,
  };
}
