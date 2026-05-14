import { describe, expect, it } from "vitest";
import { parseOnboardingFormData } from "@/app/inventory/_onboarding-parse";

const STARTERS = ["basmati rice", "milk", "eggs"] as const;

function fd(entries: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

describe("parseOnboardingFormData", () => {
  it("emits starter rows with qty > 0 and a unit", () => {
    const rows = parseOnboardingFormData(
      fd([
        ["qty_basmati rice", "2"],
        ["unit_basmati rice", "kg"],
        ["qty_milk", "1.5"],
        ["unit_milk", "l"],
      ]),
      STARTERS,
    );
    expect(rows).toEqual([
      { name: "basmati rice", quantity: 2, unit: "kg" },
      { name: "milk", quantity: 1.5, unit: "l" },
    ]);
  });

  it("skips starter rows with qty <= 0, missing, non-numeric, or empty unit", () => {
    const rows = parseOnboardingFormData(
      fd([
        ["qty_basmati rice", "0"],
        ["unit_basmati rice", "kg"],
        ["qty_milk", "-1"],
        ["unit_milk", "l"],
        ["qty_eggs", "abc"],
        ["unit_eggs", "piece"],
      ]),
      STARTERS,
    );
    expect(rows).toEqual([]);
  });

  it("skips starter row when unit is missing", () => {
    const rows = parseOnboardingFormData(
      fd([["qty_milk", "1"]]),
      STARTERS,
    );
    expect(rows).toEqual([]);
  });

  it("emits custom rows with name + qty > 0 + unit", () => {
    const rows = parseOnboardingFormData(
      fd([
        ["custom_name_0", "paneer"],
        ["custom_qty_0", "0.25"],
        ["custom_unit_0", "kg"],
      ]),
      STARTERS,
    );
    expect(rows).toEqual([{ name: "paneer", quantity: 0.25, unit: "kg" }]);
  });

  it("skips custom rows with empty/whitespace name, qty <= 0, or empty unit", () => {
    const rows = parseOnboardingFormData(
      fd([
        ["custom_name_0", "   "],
        ["custom_qty_0", "1"],
        ["custom_unit_0", "kg"],
        ["custom_name_1", "okra"],
        ["custom_qty_1", "0"],
        ["custom_unit_1", "kg"],
        ["custom_name_2", "ghee"],
        ["custom_qty_2", "1"],
        ["custom_unit_2", ""],
      ]),
      STARTERS,
    );
    expect(rows).toEqual([]);
  });

  it("trims the custom row name", () => {
    const rows = parseOnboardingFormData(
      fd([
        ["custom_name_0", "  paneer  "],
        ["custom_qty_0", "0.25"],
        ["custom_unit_0", "kg"],
      ]),
      STARTERS,
    );
    expect(rows).toEqual([{ name: "paneer", quantity: 0.25, unit: "kg" }]);
  });

  it("handles sparse custom indices in ascending order", () => {
    const rows = parseOnboardingFormData(
      fd([
        ["custom_name_3", "paneer"],
        ["custom_qty_3", "0.25"],
        ["custom_unit_3", "kg"],
        ["custom_name_0", "tofu"],
        ["custom_qty_0", "0.1"],
        ["custom_unit_0", "kg"],
      ]),
      STARTERS,
    );
    expect(rows).toEqual([
      { name: "tofu", quantity: 0.1, unit: "kg" },
      { name: "paneer", quantity: 0.25, unit: "kg" },
    ]);
  });

  it("orders starters before customs", () => {
    const rows = parseOnboardingFormData(
      fd([
        ["custom_name_0", "paneer"],
        ["custom_qty_0", "0.25"],
        ["custom_unit_0", "kg"],
        ["qty_milk", "1"],
        ["unit_milk", "l"],
      ]),
      STARTERS,
    );
    expect(rows).toEqual([
      { name: "milk", quantity: 1, unit: "l" },
      { name: "paneer", quantity: 0.25, unit: "kg" },
    ]);
  });

  it("ignores stray custom_qty_* / custom_unit_* without a matching custom_name_*", () => {
    const rows = parseOnboardingFormData(
      fd([
        ["custom_qty_0", "1"],
        ["custom_unit_0", "kg"],
      ]),
      STARTERS,
    );
    expect(rows).toEqual([]);
  });
});
