import { describe, expect, it } from "vitest";

// Pure-function copy of the order map — keep in sync with require.ts.
const order = { view_only: 0, meal_modify: 1, full: 2 } as const;

describe("privilege ordering", () => {
  it("full satisfies any minimum", () => {
    for (const min of ["view_only", "meal_modify", "full"] as const) {
      expect(order["full"] >= order[min]).toBe(true);
    }
  });
  it("view_only does not satisfy meal_modify", () => {
    expect(order["view_only"] >= order["meal_modify"]).toBe(false);
  });
  it("meal_modify satisfies view_only but not full", () => {
    expect(order["meal_modify"] >= order["view_only"]).toBe(true);
    expect(order["meal_modify"] >= order["full"]).toBe(false);
  });
});
