import { describe, it, expect } from "vitest";
import { primitiveSizes } from "@/lib/design/sizes";

const TAP_MIN = 44;

describe("touch target floor (44px)", () => {
  it("at least one primitive registered", () => {
    expect(Object.keys(primitiveSizes).length).toBeGreaterThan(0);
  });

  for (const [primitive, sizes] of Object.entries(primitiveSizes)) {
    for (const [variant, spec] of Object.entries(sizes)) {
      it(`${primitive}.${variant} respects 44px (height=${spec.height}, extendsRow=${spec.extendsRow ?? false})`, () => {
        if (spec.height >= TAP_MIN) return;
        expect(spec.extendsRow, `${primitive}.${variant} is ${spec.height}px and must set extendsRow:true to be allowed`).toBe(true);
      });
    }
  }
});
