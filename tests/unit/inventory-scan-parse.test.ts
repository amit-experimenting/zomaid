import { describe, expect, it } from "vitest";
import {
  coerceUnit,
  normalizeName,
  normalizeQuantity,
  parseScanResponse,
} from "@/app/api/inventory/scan/_parse";

describe("coerceUnit", () => {
  it("passes known units through", () => {
    expect(coerceUnit("kg")).toBe("kg");
    expect(coerceUnit("g")).toBe("g");
    expect(coerceUnit("l")).toBe("l");
    expect(coerceUnit("ml")).toBe("ml");
    expect(coerceUnit("piece")).toBe("piece");
  });

  it("lowercases and trims", () => {
    expect(coerceUnit("  KG ")).toBe("kg");
    expect(coerceUnit("ML")).toBe("ml");
  });

  it("strips trailing periods and plural s", () => {
    expect(coerceUnit("kg.")).toBe("kg");
    expect(coerceUnit("kgs")).toBe("kg");
    expect(coerceUnit("Pcs.")).toBe("piece");
    expect(coerceUnit("liters")).toBe("l");
  });

  it("maps common variants", () => {
    expect(coerceUnit("kilogram")).toBe("kg");
    expect(coerceUnit("litre")).toBe("l");
    expect(coerceUnit("milliliter")).toBe("ml");
    expect(coerceUnit("each")).toBe("piece");
    expect(coerceUnit("pack")).toBe("piece");
    expect(coerceUnit("box")).toBe("piece");
  });

  it("returns null for unknown or empty", () => {
    expect(coerceUnit("lb")).toBeNull();
    expect(coerceUnit("dozen")).toBeNull();
    expect(coerceUnit("")).toBeNull();
    expect(coerceUnit(null)).toBeNull();
    expect(coerceUnit(undefined)).toBeNull();
  });
});

describe("normalizeName", () => {
  it("lowercases and trims", () => {
    expect(normalizeName("  Basmati Rice  ")).toBe("basmati rice");
  });
  it("caps length at 60 chars", () => {
    expect(normalizeName("a".repeat(120)).length).toBe(60);
  });
});

describe("normalizeQuantity", () => {
  it("passes finite positive numbers, rounding to 2dp", () => {
    expect(normalizeQuantity(1.5)).toBe(1.5);
    expect(normalizeQuantity(2.345)).toBe(2.35);
  });
  it("rejects zero, negative, NaN, Infinity, non-numbers", () => {
    expect(normalizeQuantity(0)).toBeNull();
    expect(normalizeQuantity(-1)).toBeNull();
    expect(normalizeQuantity(Number.NaN)).toBeNull();
    expect(normalizeQuantity(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeQuantity("2" as unknown)).toBeNull();
    expect(normalizeQuantity(null)).toBeNull();
  });
});

describe("parseScanResponse", () => {
  it("parses a clean model response", () => {
    const out = parseScanResponse({
      items: [
        { item_name: "Basmati Rice", quantity: 1, unit: "kg" },
        { item_name: "milk", quantity: 1.5, unit: "litre" },
        { item_name: "eggs", quantity: 12, unit: "each" },
      ],
    });
    expect(out).toEqual([
      { item_name: "basmati rice", quantity: 1, unit: "kg" },
      { item_name: "milk", quantity: 1.5, unit: "l" },
      { item_name: "eggs", quantity: 12, unit: "piece" },
    ]);
  });

  it("returns empty list on malformed shape", () => {
    expect(parseScanResponse({})).toEqual([]);
    expect(parseScanResponse({ items: "nope" })).toEqual([]);
    expect(parseScanResponse(null)).toEqual([]);
  });

  it("drops items with empty/whitespace names", () => {
    const out = parseScanResponse({
      items: [
        { item_name: "  ", quantity: 1, unit: "kg" },
        { item_name: "tomato", quantity: 0.5, unit: "kg" },
      ],
    });
    expect(out).toEqual([{ item_name: "tomato", quantity: 0.5, unit: "kg" }]);
  });

  it("nulls unknown units and unparseable quantities but keeps the row", () => {
    const out = parseScanResponse({
      items: [{ item_name: "Mystery Item", quantity: "??", unit: "lb" }],
    });
    expect(out).toEqual([{ item_name: "mystery item", quantity: null, unit: null }]);
  });

  it("handles missing optional fields", () => {
    const out = parseScanResponse({
      items: [{ item_name: "salt" }],
    });
    expect(out).toEqual([{ item_name: "salt", quantity: null, unit: null }]);
  });
});
