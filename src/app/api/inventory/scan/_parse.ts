import { z } from "zod";

export type ParsedItem = {
  item_name: string;
  quantity: number | null;
  unit: ScanUnit | null;
};

export const SCAN_UNITS = ["kg", "g", "l", "ml", "piece"] as const;
export type ScanUnit = (typeof SCAN_UNITS)[number];

// Match the shape the model returns. Permissive on quantity/unit
// because we coerce them in parseScanResponse — only item_name is
// required to be a string at the schema level.
export const ModelResponseSchema = z.object({
  items: z
    .array(
      z
        .object({
          item_name: z.string(),
          quantity: z.unknown().optional(),
          unit: z.unknown().optional(),
        })
        .passthrough(),
    )
    .max(200),
});

const UNIT_MAP: Record<string, ScanUnit> = {
  kg: "kg",
  kilo: "kg",
  kilogram: "kg",
  g: "g",
  gm: "g",
  gram: "g",
  l: "l",
  lt: "l",
  liter: "l",
  litre: "l",
  ml: "ml",
  milliliter: "ml",
  millilitre: "ml",
  piece: "piece",
  pc: "piece",
  pcs: "piece",
  pack: "piece",
  packet: "piece",
  box: "piece",
  each: "piece",
  ea: "piece",
  unit: "piece",
};

export function coerceUnit(raw: unknown): ScanUnit | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase();
  // Strip trailing periods, then trailing plural "s".
  while (s.endsWith(".")) s = s.slice(0, -1);
  if (s.length > 2 && s.endsWith("s")) s = s.slice(0, -1);
  s = s.trim();
  if (s.length === 0) return null;
  return UNIT_MAP[s] ?? null;
}

export function normalizeName(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 60);
}

export function normalizeQuantity(raw: unknown): number | null {
  if (typeof raw !== "number") return null;
  if (!Number.isFinite(raw)) return null;
  if (raw <= 0) return null;
  // Round to 2 decimal places for sanity in the form.
  return Math.round(raw * 100) / 100;
}

export function parseScanResponse(raw: unknown): ParsedItem[] {
  const parsed = ModelResponseSchema.safeParse(raw);
  if (!parsed.success) return [];
  const out: ParsedItem[] = [];
  for (const item of parsed.data.items) {
    const name = normalizeName(item.item_name);
    if (name.length === 0) continue;
    out.push({
      item_name: name,
      quantity: normalizeQuantity(item.quantity),
      unit: coerceUnit(item.unit),
    });
  }
  return out;
}
