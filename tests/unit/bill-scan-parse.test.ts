import { describe, expect, it } from "vitest";
import {
  normalizeBillDate,
  normalizeCurrency,
  normalizePrice,
  normalizeStoreName,
  parseBillScanResponse,
} from "@/app/api/bills/scan/_parse";

describe("normalizeStoreName", () => {
  it("trims whitespace and keeps printable strings", () => {
    expect(normalizeStoreName("  NTUC Tampines  ")).toBe("NTUC Tampines");
  });
  it("returns null for empty / whitespace / non-strings", () => {
    expect(normalizeStoreName("")).toBeNull();
    expect(normalizeStoreName("   ")).toBeNull();
    expect(normalizeStoreName(null)).toBeNull();
    expect(normalizeStoreName(undefined)).toBeNull();
    expect(normalizeStoreName(42)).toBeNull();
  });
  it("caps at 200 chars to match the column check", () => {
    expect(normalizeStoreName("a".repeat(500))?.length).toBe(200);
  });
});

describe("normalizeBillDate", () => {
  it("passes valid YYYY-MM-DD through", () => {
    expect(normalizeBillDate("2026-05-16")).toBe("2026-05-16");
  });
  it("rejects bogus shapes and impossible dates", () => {
    expect(normalizeBillDate("2026/05/16")).toBeNull();
    expect(normalizeBillDate("16-05-2026")).toBeNull();
    expect(normalizeBillDate("2026-13-01")).toBeNull(); // month 13
    expect(normalizeBillDate("2026-02-30")).toBeNull(); // feb 30
    expect(normalizeBillDate("")).toBeNull();
    expect(normalizeBillDate(null)).toBeNull();
    expect(normalizeBillDate(20260516)).toBeNull();
  });
});

describe("normalizeCurrency", () => {
  it("uppercases and accepts 3-letter ISO codes", () => {
    expect(normalizeCurrency("sgd")).toBe("SGD");
    expect(normalizeCurrency("INR")).toBe("INR");
    expect(normalizeCurrency("usd")).toBe("USD");
  });
  it("rejects non-3-letter codes", () => {
    expect(normalizeCurrency("$")).toBeNull();
    expect(normalizeCurrency("Rs")).toBeNull();
    expect(normalizeCurrency("SGDX")).toBeNull();
    expect(normalizeCurrency("")).toBeNull();
    expect(normalizeCurrency(null)).toBeNull();
  });
});

describe("normalizePrice", () => {
  it("passes finite >= 0 numbers, rounding to 2dp", () => {
    expect(normalizePrice(0)).toBe(0);
    expect(normalizePrice(12.5)).toBe(12.5);
    expect(normalizePrice(7.456)).toBe(7.46);
  });
  it("rejects negative / non-finite / non-number", () => {
    expect(normalizePrice(-1)).toBeNull();
    expect(normalizePrice(Number.NaN)).toBeNull();
    expect(normalizePrice(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizePrice("3.5" as unknown)).toBeNull();
    expect(normalizePrice(null)).toBeNull();
  });
});

describe("parseBillScanResponse", () => {
  it("parses a clean bill response", () => {
    const out = parseBillScanResponse({
      store_name: "  NTUC Tampines  ",
      bill_date: "2026-05-16",
      currency: "sgd",
      total_amount: 42.5,
      items: [
        { item_name: "Basmati Rice", quantity: 1, unit: "kg", price: 12.5 },
        { item_name: "milk", quantity: 1.5, unit: "litre", price: 5 },
        { item_name: "eggs", quantity: 12, unit: "each", price: 8.5 },
      ],
    });
    expect(out).toEqual({
      store_name: "NTUC Tampines",
      bill_date: "2026-05-16",
      currency: "SGD",
      total_amount: 42.5,
      items: [
        { item_name: "basmati rice", quantity: 1, unit: "kg", price: 12.5 },
        { item_name: "milk", quantity: 1.5, unit: "l", price: 5 },
        { item_name: "eggs", quantity: 12, unit: "piece", price: 8.5 },
      ],
    });
  });

  it("nulls header fields when unparseable but still returns items", () => {
    const out = parseBillScanResponse({
      store_name: "",
      bill_date: "not-a-date",
      currency: "$",
      total_amount: "many",
      items: [{ item_name: "salt" }],
    });
    expect(out.store_name).toBeNull();
    expect(out.bill_date).toBeNull();
    expect(out.currency).toBeNull();
    expect(out.total_amount).toBeNull();
    expect(out.items).toEqual([
      { item_name: "salt", quantity: null, unit: null, price: null },
    ]);
  });

  it("drops empty-name items and unrecognized units", () => {
    const out = parseBillScanResponse({
      store_name: "S",
      bill_date: "2026-05-16",
      currency: "USD",
      total_amount: 10,
      items: [
        { item_name: "  ", quantity: 1, unit: "kg", price: 1 },
        { item_name: "Mystery", quantity: -1, unit: "lb", price: -2 },
      ],
    });
    expect(out.items).toEqual([
      { item_name: "mystery", quantity: null, unit: null, price: null },
    ]);
  });

  it("returns the empty-bill shape on malformed input", () => {
    const out = parseBillScanResponse(null);
    expect(out).toEqual({
      store_name: null,
      bill_date: null,
      currency: null,
      total_amount: null,
      items: [],
    });
  });
});
