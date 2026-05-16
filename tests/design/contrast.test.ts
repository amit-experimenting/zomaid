import { describe, it, expect } from "vitest";
import { colorPairs } from "@/lib/design/color-pairs";

/** Relative luminance per WCAG 2.x. Input: 0..1 sRGB channel. */
function srgbToLinear(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(v => srgbToLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(fg: string, bg: string): number {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe("color contrast registry", () => {
  it("contains at least one pair", () => {
    expect(colorPairs.length).toBeGreaterThan(0);
  });

  for (const pair of colorPairs) {
    it(`${pair.label} meets ${pair.min}:1`, () => {
      const r = ratio(pair.fg, pair.bg);
      expect(r, `${pair.fg} on ${pair.bg} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(pair.min);
    });
  }
});
