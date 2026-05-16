// Duplicate-bill detection for the "Upload bill" flow.
//
// A bill is a duplicate of an earlier one when the (store, date, set
// of (item_name, qty, unit, price) tuples) match exactly. No fuzzy
// matching for v1 — the user wanted the safest possible "looks the
// same to me too" guard before re-inserting a bill into Postgres.
//
// Pure functions only. Unit-tested.

type DedupeLine = {
  name: string;          // lower(trim(item_name))
  qty: number | null;    // raw, no rounding beyond what the parser did
  unit: string | null;   // lower(trim(unit))
  price: number | null;  // raw
};

export type DedupeKey = {
  store: string;       // lower(trim(store_name))
  date: string;        // YYYY-MM-DD
  lines: DedupeLine[]; // sorted
};

export type DedupeLineInput = {
  item_name: string;
  quantity: number | null;
  unit: string | null;
  price: number | null;
};

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function normUnit(u: string | null | undefined): string | null {
  if (u == null) return null;
  const s = u.trim().toLowerCase();
  return s.length === 0 ? null : s;
}

function compareLines(a: DedupeLine, b: DedupeLine): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  const aq = a.qty ?? -1;
  const bq = b.qty ?? -1;
  if (aq !== bq) return aq < bq ? -1 : 1;
  const au = a.unit ?? "";
  const bu = b.unit ?? "";
  if (au !== bu) return au < bu ? -1 : 1;
  const ap = a.price ?? -1;
  const bp = b.price ?? -1;
  if (ap !== bp) return ap < bp ? -1 : 1;
  return 0;
}

/**
 * Build the canonical comparison key for a bill candidate.
 * Returns `null` when the bill is missing the required identifying
 * fields (store name or date) — meaning we can't dedupe it; the
 * caller should always insert in that case.
 */
export function buildBillDedupeKey(input: {
  store_name: string | null | undefined;
  bill_date: string | null | undefined;
  lines: DedupeLineInput[];
}): DedupeKey | null {
  const store = norm(input.store_name);
  const date = (input.bill_date ?? "").trim();
  if (store.length === 0 || date.length === 0) return null;
  const lines: DedupeLine[] = input.lines.map((l) => ({
    name: norm(l.item_name),
    qty: l.quantity ?? null,
    unit: normUnit(l.unit),
    price: l.price ?? null,
  }));
  lines.sort(compareLines);
  return { store, date, lines };
}

export function areDedupeKeysEqual(a: DedupeKey, b: DedupeKey): boolean {
  if (a.store !== b.store) return false;
  if (a.date !== b.date) return false;
  if (a.lines.length !== b.lines.length) return false;
  for (let i = 0; i < a.lines.length; i++) {
    if (compareLines(a.lines[i], b.lines[i]) !== 0) return false;
  }
  return true;
}
