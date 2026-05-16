import { describe, expect, it } from "vitest";
import {
  areDedupeKeysEqual,
  buildBillDedupeKey,
} from "@/app/bills/_dedupe";

describe("buildBillDedupeKey", () => {
  it("normalizes store name and unit; sorts lines deterministically", () => {
    const k = buildBillDedupeKey({
      store_name: "  NTUC Tampines  ",
      bill_date: "2026-05-16",
      lines: [
        { item_name: "Milk", quantity: 1, unit: " KG ", price: 3 },
        { item_name: "Basmati Rice", quantity: 1, unit: "kg", price: 12.5 },
      ],
    });
    expect(k).toEqual({
      store: "ntuc tampines",
      date: "2026-05-16",
      lines: [
        { name: "basmati rice", qty: 1, unit: "kg", price: 12.5 },
        { name: "milk", qty: 1, unit: "kg", price: 3 },
      ],
    });
  });

  it("returns null when store or date is missing", () => {
    expect(
      buildBillDedupeKey({
        store_name: "",
        bill_date: "2026-05-16",
        lines: [],
      }),
    ).toBeNull();
    expect(
      buildBillDedupeKey({
        store_name: "S",
        bill_date: "",
        lines: [],
      }),
    ).toBeNull();
    expect(
      buildBillDedupeKey({
        store_name: null,
        bill_date: "2026-05-16",
        lines: [],
      }),
    ).toBeNull();
  });
});

describe("areDedupeKeysEqual", () => {
  it("returns true regardless of original line order", () => {
    const a = buildBillDedupeKey({
      store_name: "A",
      bill_date: "2026-05-16",
      lines: [
        { item_name: "milk", quantity: 1, unit: "l", price: 3 },
        { item_name: "rice", quantity: 1, unit: "kg", price: 12 },
      ],
    })!;
    const b = buildBillDedupeKey({
      store_name: "A",
      bill_date: "2026-05-16",
      lines: [
        { item_name: "rice", quantity: 1, unit: "kg", price: 12 },
        { item_name: "milk", quantity: 1, unit: "l", price: 3 },
      ],
    })!;
    expect(areDedupeKeysEqual(a, b)).toBe(true);
  });

  it("distinguishes differing prices", () => {
    const a = buildBillDedupeKey({
      store_name: "A",
      bill_date: "2026-05-16",
      lines: [{ item_name: "milk", quantity: 1, unit: "l", price: 3 }],
    })!;
    const b = buildBillDedupeKey({
      store_name: "A",
      bill_date: "2026-05-16",
      lines: [{ item_name: "milk", quantity: 1, unit: "l", price: 3.5 }],
    })!;
    expect(areDedupeKeysEqual(a, b)).toBe(false);
  });

  it("distinguishes differing quantities", () => {
    const a = buildBillDedupeKey({
      store_name: "A",
      bill_date: "2026-05-16",
      lines: [{ item_name: "milk", quantity: 1, unit: "l", price: 3 }],
    })!;
    const b = buildBillDedupeKey({
      store_name: "A",
      bill_date: "2026-05-16",
      lines: [{ item_name: "milk", quantity: 2, unit: "l", price: 3 }],
    })!;
    expect(areDedupeKeysEqual(a, b)).toBe(false);
  });

  it("distinguishes differing units", () => {
    const a = buildBillDedupeKey({
      store_name: "A",
      bill_date: "2026-05-16",
      lines: [{ item_name: "milk", quantity: 1, unit: "l", price: 3 }],
    })!;
    const b = buildBillDedupeKey({
      store_name: "A",
      bill_date: "2026-05-16",
      lines: [{ item_name: "milk", quantity: 1, unit: "ml", price: 3 }],
    })!;
    expect(areDedupeKeysEqual(a, b)).toBe(false);
  });

  it("distinguishes differing line counts", () => {
    const a = buildBillDedupeKey({
      store_name: "A",
      bill_date: "2026-05-16",
      lines: [{ item_name: "milk", quantity: 1, unit: "l", price: 3 }],
    })!;
    const b = buildBillDedupeKey({
      store_name: "A",
      bill_date: "2026-05-16",
      lines: [
        { item_name: "milk", quantity: 1, unit: "l", price: 3 },
        { item_name: "rice", quantity: 1, unit: "kg", price: 12 },
      ],
    })!;
    expect(areDedupeKeysEqual(a, b)).toBe(false);
  });

  it("treats null qty/unit/price as comparable nulls", () => {
    const a = buildBillDedupeKey({
      store_name: "A",
      bill_date: "2026-05-16",
      lines: [{ item_name: "x", quantity: null, unit: null, price: null }],
    })!;
    const b = buildBillDedupeKey({
      store_name: "A",
      bill_date: "2026-05-16",
      lines: [{ item_name: "x", quantity: null, unit: null, price: null }],
    })!;
    expect(areDedupeKeysEqual(a, b)).toBe(true);
  });
});
