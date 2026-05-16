# Design System Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land slice A of the mobile-app design effort — replace the placeholder grayscale palette with deliberate indigo + warm-cream tokens, swap Geist for IBM Plex Sans, audit/refit the 8 existing UI primitives against a 44px touch-target floor, ship 6 new primitives the app needs (`TabBar`, `TopAppBar`, `ListRow`, `IconButton`, `Banner`, `Avatar`), and gate all of it behind CI.

**Architecture:** Tokens are CSS custom properties on `:root` in [src/app/globals.css](../../../src/app/globals.css), exposed to Tailwind v4 via the existing `@theme inline` block. Each primitive lives in `src/components/ui/`, exports a `sizes` data object so structural CI tests can assert touch-target compliance without needing jsdom. Enforcement is two custom ESLint rules + two vitest tests (node-only, no DOM rendering). Brainstorm decisions and rationale are in [the spec](../specs/2026-05-17-design-system-foundation.md).

**Tech Stack:** Next.js 16, React 19, Tailwind v4, shadcn-style primitives over `@base-ui/react`, `class-variance-authority`, vitest (node), ESLint flat config.

**Branch:** `design-system-foundation` (already cut; spec committed at a2a6dbe). All work below stays on this branch — no push, no merge until the user has tested locally.

---

## File structure

### Created

| Path | Responsibility |
|---|---|
| `src/lib/design/color-pairs.ts` | Registry of every foreground/background token pair the design uses, plus WCAG-required minimum ratio. Imported by the contrast test. |
| `src/lib/design/sizes.ts` | Re-exports `sizes` objects from each primitive so the touch-target test has a single import surface. |
| `src/components/ui/icon-button.tsx` | New primitive — 44×44 icon-only button, 3 variants, requires aria-label. |
| `src/components/ui/banner.tsx` | New primitive — inline notification (5 tones). |
| `src/components/ui/avatar.tsx` | New primitive — initials/image avatar with deterministic color hash. |
| `src/components/ui/list-row.tsx` | New primitive — 56px-min list row, 3 modes (nav / static / actionable). |
| `src/components/ui/top-app-bar.tsx` | New primitive — 52px sticky page header. |
| `src/components/ui/tab-bar.tsx` | New primitive — 56px bottom navigation. |
| `src/components/ui/*.examples.tsx` | One file per primitive (14 total): renders every variant × state on one page. Dev only. |
| `src/app/dev/primitives/page.tsx` | Dev-only catalog page that mounts all `.examples.tsx`. Gated by `NODE_ENV !== 'production'`. |
| `tests/design/contrast.test.ts` | CI gate — reads `color-pairs.ts`, asserts each pair meets WCAG. |
| `tests/design/touch-targets.test.ts` | CI gate — reads `sizes.ts`, asserts every variant height ≥ 44px unless flagged. |
| `tests/design/eslint-rules.test.ts` | Tests both custom ESLint rules using `RuleTester`. |
| `eslint-rules/no-arbitrary-design-values.js` | Bans `bg-[#…]`, `text-[##px]`, raw `oklch()`, hex literals in `className`, outside allowlisted paths. |
| `eslint-rules/icon-button-needs-label.js` | Requires `aria-label` on `<IconButton>` and on `<button>` with no text children. |

### Modified

| Path | Changes |
|---|---|
| `src/app/globals.css` | Replace all `--*` color tokens with the indigo + warm-cream palette; remove the `.dark` block. |
| `src/app/layout.tsx` | Swap `Geist` import for `IBM_Plex_Sans` from `next/font/google`. |
| `src/components/ui/button.tsx` | Collapse sizes to `sm`/`md`/`lg`; map variants to new tokens; add `loading` prop; strip `dark:` classes; export `sizes` object. |
| `src/components/ui/card.tsx` | Refit to `surface-1`, `border`, `md` radius, 16px padding. |
| `src/components/ui/dialog.tsx` | Refit to `lg` radius, safe-area inset, replace `size="icon-sm"` with `<IconButton variant="ghost">`. |
| `src/components/ui/input.tsx` | 44px height, focus ring, error variant, strip `dark:` classes; export `sizes` object. |
| `src/components/ui/label.tsx` | Adopt `label` typography token. |
| `src/components/ui/sheet.tsx` | Top `lg` radius, drag handle, safe-area, replace `size="icon-sm"` close button. |
| `src/components/ui/textarea.tsx` | Match input rules, min-height 88; strip `dark:` classes. |
| `src/components/site/pending-scans-banner.tsx` | Thin to `<Banner tone="warning">` shell. |
| `src/components/site/task-setup-prompt-card.tsx` | Thin to `<Banner tone="info">` shell. |
| `src/components/site/inventory-prompt-card.tsx` | Thin to `<Banner tone="info">` shell. |
| `src/components/site/owner-invite-maid-card.tsx` | Thin to `<Banner tone="neutral">` shell. |
| `src/components/site/household-mode-card.tsx` | Thin to `<Banner tone="info">` shell. |
| `src/app/layout.tsx` | Add `<TabBar>` to the root layout (sticky bottom). |
| `eslint.config.mjs` | Wire in both custom rules. |
| `vitest.config.ts` | Add `tests/design/**/*.test.ts` to includes (currently only `tests/**/*.test.ts` — already matches; no change unless we move). |
| `AGENTS.md` | Add link to the design system spec. |
| 17 call sites of `PendingButton` | Replace `<PendingButton …>` with `<Button loading …>`. |
| 23 page files that imported `main-nav` | Remove the old `<MainNav>` (now provided by root layout's TopAppBar slot). |

### Deleted

| Path | Reason |
|---|---|
| `src/components/ui/pending-button.tsx` | Folds into `Button` as `loading={true}`. |
| `src/components/site/main-nav.tsx` | Replaced by new `TabBar` + per-route `TopAppBar`. |

---

## Phase 1 — Token foundation

### Task 1.1: Verify branch and install IBM Plex font dependency

**Files:** none (env check + verify `next/font/google` already available — it is, since Geist is loaded from there).

- [ ] **Step 1: Verify branch**

```bash
git rev-parse --abbrev-ref HEAD
```

Expected output: `design-system-foundation`

- [ ] **Step 2: Verify next/font/google is available**

```bash
grep -E "next/font/google" src/app/layout.tsx
```

Expected: matches the existing `Geist` import (`import { Geist } from "next/font/google"`). No install needed — `next/font/google` ships with Next.js.

---

### Task 1.2: Write the failing contrast registry test

**Files:**
- Create: `src/lib/design/color-pairs.ts` (stub)
- Create: `tests/design/contrast.test.ts`

- [ ] **Step 1: Create empty registry stub**

```ts
// src/lib/design/color-pairs.ts
export type ColorPair = {
  /** Hex foreground (e.g. "#111111"). */
  fg: string;
  /** Hex background (e.g. "#FAF7F2"). */
  bg: string;
  /** WCAG ratio required. 4.5 = AA body, 3.0 = AA large text / non-text. */
  min: 4.5 | 3.0;
  /** Human label used in failure messages. */
  label: string;
};

export const colorPairs: ColorPair[] = [];
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/design/contrast.test.ts
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
```

- [ ] **Step 3: Run the test — should fail**

```bash
pnpm test tests/design/contrast.test.ts
```

Expected: 1 failure — `contains at least one pair` (empty registry).

- [ ] **Step 4: Commit**

```bash
git add src/lib/design/color-pairs.ts tests/design/contrast.test.ts
git commit -m "test(design): add failing contrast registry test"
```

---

### Task 1.3: Populate the contrast registry — turns test green

**Files:**
- Modify: `src/lib/design/color-pairs.ts`

- [ ] **Step 1: Fill in every token pair the design uses**

```ts
// src/lib/design/color-pairs.ts
export type ColorPair = {
  fg: string;
  bg: string;
  min: 4.5 | 3.0;
  label: string;
};

export const colorPairs: ColorPair[] = [
  // Text on page surface
  { fg: "#111111", bg: "#FAF7F2", min: 4.5, label: "text-primary on surface-0" },
  { fg: "#555555", bg: "#FAF7F2", min: 4.5, label: "text-secondary on surface-0" },
  { fg: "#767676", bg: "#FAF7F2", min: 4.5, label: "text-muted on surface-0" },

  // Text on card surface
  { fg: "#111111", bg: "#FFFFFF", min: 4.5, label: "text-primary on surface-1" },
  { fg: "#555555", bg: "#FFFFFF", min: 4.5, label: "text-secondary on surface-1" },
  { fg: "#767676", bg: "#FFFFFF", min: 4.5, label: "text-muted on surface-1" },

  // Primary CTA
  { fg: "#FFFFFF", bg: "#3949AB", min: 4.5, label: "primary-foreground on primary" },
  { fg: "#FFFFFF", bg: "#283593", min: 4.5, label: "primary-foreground on primary-pressed" },

  // Tonal (primary-subtle backgrounds with primary text)
  { fg: "#3949AB", bg: "#E8EAF6", min: 4.5, label: "primary on primary-subtle (tonal icon-button)" },

  // Semantic on subtle backgrounds (banner inner text)
  { fg: "#1F7A3B", bg: "#E9F8EE", min: 4.5, label: "success on success-subtle" },
  { fg: "#B26100", bg: "#FFF1E0", min: 4.5, label: "warning on warning-subtle" },
  { fg: "#C62828", bg: "#FEEAEA", min: 4.5, label: "danger on danger-subtle" },
  { fg: "#1859D1", bg: "#E8F3FF", min: 4.5, label: "info on info-subtle" },

  // Semantic foreground on white (icon chip foregrounds — large/non-text)
  { fg: "#FFFFFF", bg: "#1F7A3B", min: 4.5, label: "white on success" },
  { fg: "#FFFFFF", bg: "#B26100", min: 4.5, label: "white on warning" },
  { fg: "#FFFFFF", bg: "#C62828", min: 4.5, label: "white on danger" },
  { fg: "#FFFFFF", bg: "#1859D1", min: 4.5, label: "white on info" },

  // Borders on surface — non-text (3:1 ok)
  { fg: "#EFE9E1", bg: "#FAF7F2", min: 3.0, label: "border on surface-0" },
  { fg: "#D9D2C5", bg: "#FAF7F2", min: 3.0, label: "border-strong on surface-0" },
];
```

- [ ] **Step 2: Run test — should pass; investigate any failure**

```bash
pnpm test tests/design/contrast.test.ts
```

Expected: all pairs pass. If any fails, the hex needs tweaking — the most likely failure is the border pair (border on surface differ by little). If `#EFE9E1` on `#FAF7F2` is below 3:1, darken `border` to `#E5DDD0` and re-run.

- [ ] **Step 3: Commit**

```bash
git add src/lib/design/color-pairs.ts
git commit -m "feat(design): populate contrast registry, turn test green"
```

---

### Task 1.4: Rewrite `globals.css` tokens

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Replace the `:root` block and delete the `.dark` block**

Replace the entire body of [src/app/globals.css](../../../src/app/globals.css) (keep the `@import` and `@theme inline` blocks unchanged, but delete the `@custom-variant dark` line) with:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@theme inline {
    --font-heading: var(--font-sans);
    --font-sans: var(--font-sans);
    --color-background: var(--background);
    --color-foreground: var(--foreground);
    --color-card: var(--card);
    --color-card-foreground: var(--card-foreground);
    --color-popover: var(--popover);
    --color-popover-foreground: var(--popover-foreground);
    --color-primary: var(--primary);
    --color-primary-foreground: var(--primary-foreground);
    --color-primary-subtle: var(--primary-subtle);
    --color-primary-soft: var(--primary-soft);
    --color-primary-pressed: var(--primary-pressed);
    --color-secondary: var(--secondary);
    --color-secondary-foreground: var(--secondary-foreground);
    --color-muted: var(--muted);
    --color-muted-foreground: var(--muted-foreground);
    --color-accent: var(--accent);
    --color-accent-foreground: var(--accent-foreground);
    --color-destructive: var(--destructive);
    --color-border: var(--border);
    --color-border-strong: var(--border-strong);
    --color-input: var(--input);
    --color-ring: var(--ring);
    --color-surface-0: var(--surface-0);
    --color-surface-1: var(--surface-1);
    --color-text-primary: var(--text-primary);
    --color-text-secondary: var(--text-secondary);
    --color-text-muted: var(--text-muted);
    --color-text-disabled: var(--text-disabled);
    --color-success: var(--success);
    --color-success-subtle: var(--success-subtle);
    --color-warning: var(--warning);
    --color-warning-subtle: var(--warning-subtle);
    --color-danger: var(--danger);
    --color-danger-subtle: var(--danger-subtle);
    --color-info: var(--info);
    --color-info-subtle: var(--info-subtle);
    --radius-xs: 2px;
    --radius-sm: 6px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --radius-full: 9999px;
}

:root {
    /* Surfaces & borders */
    --background: #FAF7F2;
    --foreground: #111111;
    --surface-0: #FAF7F2;
    --surface-1: #FFFFFF;
    --card: #FFFFFF;
    --card-foreground: #111111;
    --popover: #FFFFFF;
    --popover-foreground: #111111;
    --border: #EFE9E1;
    --border-strong: #D9D2C5;
    --input: #EFE9E1;
    --ring: #3949AB;

    /* Primary */
    --primary: #3949AB;
    --primary-foreground: #FFFFFF;
    --primary-subtle: #E8EAF6;
    --primary-soft: #5C6BC0;
    --primary-pressed: #283593;

    /* Secondary / muted / accent (shadcn compatibility — point at neutrals) */
    --secondary: #EFE9E1;
    --secondary-foreground: #111111;
    --muted: #EFE9E1;
    --muted-foreground: #767676;
    --accent: #E8EAF6;
    --accent-foreground: #3949AB;

    /* Text */
    --text-primary: #111111;
    --text-secondary: #555555;
    --text-muted: #767676;
    --text-disabled: #B0AFAA;

    /* Semantic */
    --destructive: #C62828;
    --success: #1F7A3B;
    --success-subtle: #E9F8EE;
    --warning: #B26100;
    --warning-subtle: #FFF1E0;
    --danger: #C62828;
    --danger-subtle: #FEEAEA;
    --info: #1859D1;
    --info-subtle: #E8F3FF;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
}
```

Note: shadcn-compatibility tokens (`secondary`, `muted`, `accent`, `popover`, `card`) are preserved so existing components don't break — they just point at the new palette.

- [ ] **Step 2: Verify no `.dark` block remains and no leftover token references**

```bash
grep -n "\.dark\b\|--chart-\|--sidebar" src/app/globals.css
```

Expected: empty output. (Chart and sidebar tokens removed — none used in app per `grep -rn "chart-\|sidebar-" src/` from spec-time inspection. If grep finds usages, restore the relevant tokens.)

```bash
grep -rln "chart-\|sidebar-" src/
```

Expected: empty output. If matches appear, add the relevant `--chart-*` / `--sidebar-*` tokens back to `:root` so the build doesn't break.

- [ ] **Step 3: Run typecheck + build to surface broken references**

```bash
pnpm typecheck
```

Expected: clean — `tsc` doesn't read CSS so this should pass. Any failures are pre-existing.

```bash
pnpm build
```

Expected: build succeeds. If Tailwind reports an unknown utility (e.g. `bg-sidebar`), that's a file still referencing a removed token — search for it and either restore the token or refactor the file.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(design): rewrite color tokens (indigo + warm cream); remove dark"
```

---

### Task 1.5: Swap Geist for IBM Plex Sans

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Replace the font import**

In [src/app/layout.tsx](../../../src/app/layout.tsx), change:

```tsx
import { Geist } from "next/font/google";
…
const geist = Geist({subsets:['latin'],variable:'--font-sans'});
```

to:

```tsx
import { IBM_Plex_Sans } from "next/font/google";
…
const plex = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});
```

Then update the `<html>` className reference:

```tsx
<html lang="en" className={cn("font-sans", plex.variable)}>
```

- [ ] **Step 2: Run dev server + visually verify**

```bash
pnpm dev
```

Open <http://localhost:3000>. Headings should be IBM Plex (humanist, slightly mechanical), surfaces should be cream, primary CTA should be indigo. If the font still looks like Geist, hard-refresh (Next caches the font CSS).

- [ ] **Step 3: Stop dev server, commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(design): swap Geist for IBM Plex Sans"
```

---

## Phase 2 — Touch-target test infrastructure

### Task 2.1: Write failing touch-target test

**Files:**
- Create: `src/lib/design/sizes.ts`
- Create: `tests/design/touch-targets.test.ts`

- [ ] **Step 1: Create the sizes aggregator stub**

```ts
// src/lib/design/sizes.ts
export type PrimitiveSize = {
  height: number;
  /** True if this size is allowed because the surrounding row gives 44px effective tap area. */
  extendsRow?: boolean;
};

export type PrimitiveSizeMap = Record<string, PrimitiveSize>;

/** Aggregated sizes for every interactive primitive. Each primitive contributes its own map. */
export const primitiveSizes: Record<string, PrimitiveSizeMap> = {};
```

- [ ] **Step 2: Write the failing touch-target test**

```ts
// tests/design/touch-targets.test.ts
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
```

- [ ] **Step 3: Run — expect failure**

```bash
pnpm test tests/design/touch-targets.test.ts
```

Expected: 1 failure — `at least one primitive registered` (empty map).

- [ ] **Step 4: Commit**

```bash
git add src/lib/design/sizes.ts tests/design/touch-targets.test.ts
git commit -m "test(design): add failing touch-target test"
```

The sizes map fills in as each primitive is refit in Phases 4 and 7. The test will keep failing until at least one primitive registers; that's expected and intentional — the test stays red until the first refit.

---

## Phase 3 — ESLint enforcement rules

### Task 3.1: Write the no-arbitrary-design-values rule + tests

**Files:**
- Create: `eslint-rules/no-arbitrary-design-values.js`
- Create: `tests/design/eslint-rules.test.ts`

- [ ] **Step 1: Write the rule**

```js
// eslint-rules/no-arbitrary-design-values.js
"use strict";

/**
 * Bans arbitrary color/size values in className strings:
 *   - bg-[#…], text-[##px], border-[…hex…]
 *   - raw hex (#abc, #aabbcc) appearing inside JSX className attribute strings
 *   - raw oklch(…) inside className
 * Files in allowlistedPaths are exempt because they DEFINE the system.
 */

const ARBITRARY_PATTERN = /\b(?:bg|text|border|fill|stroke|ring|from|to|via|outline|divide|placeholder)-\[(#[0-9a-f]+|oklch\([^\]]+\))\]/i;
const SIZE_ARBITRARY_PATTERN = /\b(?:h|w|min-h|min-w|max-h|max-w|p[xytrbl]?|m[xytrbl]?|gap|space-[xy]|text|leading|tracking)-\[\d+(\.\d+)?(px|rem|em)\]/;
const HEX_IN_STRING = /#[0-9a-fA-F]{3,8}\b/;
const OKLCH_IN_STRING = /oklch\s*\(/i;

const DEFAULT_ALLOWLIST = [
  "src/app/globals.css",
  "src/components/ui/",
  "src/lib/design/",
  "eslint-rules/",
  "tests/design/",
];

function isAllowlisted(filename, allowlist) {
  const norm = filename.replace(/\\/g, "/");
  return allowlist.some(p => norm.includes(p));
}

module.exports = {
  meta: {
    type: "problem",
    docs: { description: "Disallow arbitrary design values outside the design system" },
    schema: [
      {
        type: "object",
        properties: { allowlist: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      arbitrary: "Arbitrary design value '{{match}}' — use a design token instead.",
      hex: "Hex literal '{{match}}' in className — use a design token instead.",
      oklch: "Raw oklch() in className — use a design token instead.",
    },
  },
  create(context) {
    const opts = context.options[0] || {};
    const allowlist = opts.allowlist || DEFAULT_ALLOWLIST;
    if (isAllowlisted(context.getFilename(), allowlist)) return {};

    function check(node, value) {
      if (typeof value !== "string") return;
      const arb = value.match(ARBITRARY_PATTERN) || value.match(SIZE_ARBITRARY_PATTERN);
      if (arb) { context.report({ node, messageId: "arbitrary", data: { match: arb[0] } }); return; }
      const hex = value.match(HEX_IN_STRING);
      if (hex) { context.report({ node, messageId: "hex", data: { match: hex[0] } }); return; }
      if (OKLCH_IN_STRING.test(value)) { context.report({ node, messageId: "oklch", data: { match: "oklch(" } }); return; }
    }

    return {
      JSXAttribute(node) {
        if (node.name.name !== "className") return;
        if (node.value && node.value.type === "Literal") check(node, node.value.value);
        if (node.value && node.value.type === "JSXExpressionContainer") {
          const e = node.value.expression;
          if (e.type === "Literal") check(node, e.value);
          if (e.type === "TemplateLiteral") {
            for (const q of e.quasis) check(node, q.value.cooked);
          }
        }
      },
    };
  },
};
```

- [ ] **Step 2: Write tests for the rule**

```ts
// tests/design/eslint-rules.test.ts
import { describe, it } from "vitest";
import { RuleTester } from "eslint";
// @ts-expect-error – plain JS rule, no types
import noArbitrary from "../../eslint-rules/no-arbitrary-design-values.js";
// @ts-expect-error – plain JS rule, no types
import iconBtnLabel from "../../eslint-rules/icon-button-needs-label.js";

const tsxParserOptions = {
  ecmaVersion: 2024 as const,
  sourceType: "module" as const,
  ecmaFeatures: { jsx: true },
};

const rt = new RuleTester({ languageOptions: { parserOptions: tsxParserOptions } });

describe("no-arbitrary-design-values", () => {
  it("rule tests", () => {
    rt.run("no-arbitrary-design-values", noArbitrary, {
      valid: [
        { code: `const x = <div className="bg-primary text-foreground p-4" />`, filename: "src/app/page.tsx" },
        { code: `const x = <div className="bg-[#123456]" />`, filename: "src/components/ui/button.tsx" }, // allowlisted
      ],
      invalid: [
        {
          code: `const x = <div className="bg-[#abcdef]" />`,
          filename: "src/app/page.tsx",
          errors: [{ messageId: "arbitrary" }],
        },
        {
          code: `const x = <div className="text-[#111]" />`,
          filename: "src/app/page.tsx",
          errors: [{ messageId: "arbitrary" }],
        },
        {
          code: `const x = <div className="h-[42px]" />`,
          filename: "src/app/page.tsx",
          errors: [{ messageId: "arbitrary" }],
        },
        {
          code: "const x = <div className={`text-[${dyn}]`} />",
          filename: "src/app/page.tsx",
          errors: [{ messageId: "arbitrary" }],
        },
      ],
    });
  });
});

describe("icon-button-needs-label", () => {
  it("rule tests", () => {
    rt.run("icon-button-needs-label", iconBtnLabel, {
      valid: [
        { code: `const x = <IconButton aria-label="Add" />`, filename: "src/app/page.tsx" },
        { code: `const x = <IconButton aria-labelledby="x" />`, filename: "src/app/page.tsx" },
        { code: `const x = <button>Save</button>`, filename: "src/app/page.tsx" },
        { code: `const x = <button aria-label="Close"><span>x</span></button>`, filename: "src/app/page.tsx" },
      ],
      invalid: [
        { code: `const x = <IconButton />`, filename: "src/app/page.tsx", errors: [{ messageId: "missing" }] },
        { code: `const x = <button><span /></button>`, filename: "src/app/page.tsx", errors: [{ messageId: "missing" }] },
      ],
    });
  });
});
```

- [ ] **Step 3: Run rule tests — should fail (icon-btn rule not written yet)**

```bash
pnpm test tests/design/eslint-rules.test.ts
```

Expected: `no-arbitrary-design-values` tests pass; `icon-button-needs-label` tests fail with module not found.

- [ ] **Step 4: Commit the first rule**

```bash
git add eslint-rules/no-arbitrary-design-values.js tests/design/eslint-rules.test.ts
git commit -m "feat(eslint): add no-arbitrary-design-values rule"
```

---

### Task 3.2: Write the icon-button-needs-label rule

**Files:**
- Create: `eslint-rules/icon-button-needs-label.js`

- [ ] **Step 1: Write the rule**

```js
// eslint-rules/icon-button-needs-label.js
"use strict";

const NAMED_AS_ICON_BUTTON = new Set(["IconButton"]);

function hasA11yLabel(node) {
  return node.attributes.some(attr => {
    if (attr.type !== "JSXAttribute") return false;
    const name = attr.name.name;
    return name === "aria-label" || name === "aria-labelledby" || name === "title";
  });
}

function hasTextChild(parent) {
  if (!parent || !parent.children) return false;
  return parent.children.some(child => {
    if (child.type === "JSXText" && child.value.trim()) return true;
    if (child.type === "JSXExpressionContainer") {
      const e = child.expression;
      if (e.type === "Literal" && typeof e.value === "string" && e.value.trim()) return true;
      if (e.type === "TemplateLiteral" && e.quasis.some(q => q.value.cooked.trim())) return true;
    }
    return false;
  });
}

module.exports = {
  meta: {
    type: "problem",
    docs: { description: "Require aria-label on icon-only buttons" },
    schema: [],
    messages: {
      missing: "Icon-only button needs an aria-label (or aria-labelledby / title).",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = node.name.type === "JSXIdentifier" ? node.name.name : null;
        if (!name) return;
        const isIconButton = NAMED_AS_ICON_BUTTON.has(name);
        const isPlainButton = name === "button";
        if (!isIconButton && !isPlainButton) return;
        if (hasA11yLabel(node)) return;
        if (isPlainButton) {
          // Plain <button> only fails if it has no text children.
          const parent = node.parent;
          if (hasTextChild(parent)) return;
        }
        context.report({ node, messageId: "missing" });
      },
    };
  },
};
```

- [ ] **Step 2: Run rule tests — both should pass now**

```bash
pnpm test tests/design/eslint-rules.test.ts
```

Expected: both rule test suites green.

- [ ] **Step 3: Commit**

```bash
git add eslint-rules/icon-button-needs-label.js
git commit -m "feat(eslint): add icon-button-needs-label rule"
```

---

### Task 3.3: Wire both rules into `eslint.config.mjs`

**Files:**
- Modify: `eslint.config.mjs`

- [ ] **Step 1: Wire rules into the flat config**

Replace [eslint.config.mjs](../../../eslint.config.mjs) with:

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noArbitraryDesignValues from "./eslint-rules/no-arbitrary-design-values.js";
import iconButtonNeedsLabel from "./eslint-rules/icon-button-needs-label.js";

const designPlugin = {
  rules: {
    "no-arbitrary-design-values": noArbitraryDesignValues,
    "icon-button-needs-label": iconButtonNeedsLabel,
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { design: designPlugin },
    rules: {
      "design/no-arbitrary-design-values": "error",
      "design/icon-button-needs-label": "error",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/sw.js",
  ]),
]);

export default eslintConfig;
```

- [ ] **Step 2: Run lint over the whole repo and capture violations**

```bash
pnpm lint
```

Expected: a list of existing arbitrary-value violations. Save the output for Task 3.4. Common offenders likely include any place using `bg-[…]`, `text-[…]`, or hardcoded hex.

- [ ] **Step 3: Commit the wiring (violations will be fixed in 3.4)**

```bash
git add eslint.config.mjs
git commit -m "feat(eslint): wire custom design rules into config"
```

---

### Task 3.4: Fix existing lint violations across the codebase

**Files:** whatever Task 3.3 step 2 listed.

- [ ] **Step 1: Re-run lint, get the list**

```bash
pnpm lint 2>&1 | grep -E "design/(no-arbitrary|icon-button)" | sort -u
```

- [ ] **Step 2: For each violation, replace with a token-based class**

Examples of typical fixes:

| Was | Becomes |
|---|---|
| `className="bg-[#3949AB]"` | `className="bg-primary"` |
| `className="text-[#888]"` | `className="text-muted"` |
| `className="h-[42px]"` | use a primitive that has the correct height; if not possible, justify with `// eslint-disable-next-line design/no-arbitrary-design-values` and a comment |

Anything that genuinely cannot be tokenised (e.g. a dynamic CSS-var-based color) should use `style={{ color: "var(--primary)" }}` instead of an arbitrary Tailwind class — that bypasses the rule cleanly because it isn't a `className` literal.

- [ ] **Step 3: Re-lint until clean**

```bash
pnpm lint
```

Expected: zero `design/*` violations. Pre-existing non-design warnings are out of scope and ignored.

- [ ] **Step 4: Commit**

```bash
git add -p   # stage only the design-fix hunks
git commit -m "refactor(design): replace arbitrary design values with tokens"
```

---

## Phase 4 — Refit existing primitives

### Task 4.1: Refit `Button` — collapse sizes, add `loading`, register sizes

**Files:**
- Modify: `src/components/ui/button.tsx`
- Modify: `src/lib/design/sizes.ts`

- [ ] **Step 1: Rewrite `button.tsx`**

Replace [src/components/ui/button.tsx](../../../src/components/ui/button.tsx) with:

```tsx
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center gap-2",
    "rounded-sm border border-transparent bg-clip-padding font-medium whitespace-nowrap",
    "transition-colors outline-none select-none",
    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-soft active:bg-primary-pressed",
        secondary: "bg-surface-1 text-text-primary border-border hover:bg-primary-subtle",
        ghost: "bg-transparent text-primary hover:bg-primary-subtle",
        destructive: "bg-danger-subtle text-danger hover:bg-danger hover:text-primary-foreground",
      },
      size: {
        sm: "h-9 px-4 text-sm",   // 36px — only allowed in toolbars (extendsRow)
        md: "h-11 px-5 text-sm",  // 44px — default
        lg: "h-[52px] px-6 text-base", // 52px — primary on-page CTAs (allowlisted file)
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** If true, shows a spinner and disables the button. */
    loading?: boolean;
  };

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

function Button({
  className,
  variant,
  size,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </ButtonPrimitive>
  );
}

/** Size manifest consumed by the touch-target CI test. */
export const buttonSizes = {
  sm: { height: 36, extendsRow: true },
  md: { height: 44 },
  lg: { height: 52 },
} as const;

export { Button, buttonVariants };
```

(Tailwind v4's default scale jumps from `h-12` (48px) to `h-14` (56px), so `h-13` doesn't exist. Using the bracket-notation `h-[52px]` is fine here — `src/components/ui/` is allowlisted by the design-values rule.)

- [ ] **Step 2: Register sizes in the aggregator**

```ts
// src/lib/design/sizes.ts
import { buttonSizes } from "@/components/ui/button";

export type PrimitiveSize = {
  height: number;
  extendsRow?: boolean;
};

export type PrimitiveSizeMap = Record<string, PrimitiveSize>;

export const primitiveSizes: Record<string, PrimitiveSizeMap> = {
  button: buttonSizes,
};
```

- [ ] **Step 3: Audit + migrate the 34 button call sites**

```bash
pnpm typecheck
```

Will fail for every call site using a removed size (`default`, `xs`, `lg`, `icon`, `icon-xs`, `icon-sm`, `icon-lg`) or variant (`outline`, `link`).

Migration rules:
- `size="default"` (no size set) → remove (md is default).
- `size="sm"` in a toolbar/row context (most existing usages) → keep as `size="sm"` (allowed via `extendsRow`).
- `size="lg"` → `size="lg"` (semantically aligns).
- `size="xs"` → `size="sm"` and review whether the row gives 44px.
- `size="icon-sm"` (2 sites: dialog.tsx, sheet.tsx) → will be replaced with `<IconButton variant="ghost">` in Tasks 4.3 and 4.6 respectively. For now, change to `variant="ghost"` and leave a `// TODO(IconButton)` — remove this TODO when Phase 7.2 lands.
- `variant="outline"` → `variant="secondary"`.
- `variant="link"` → not retained. Replace inline with `<a>` styled `text-primary underline-offset-4 hover:underline` in the call site (one-off, not a variant).

Walk each call site, fix, re-run typecheck after every few files. List of files from earlier grep:

```
src/app/scans/pending/_review-card.tsx
src/app/scans/pending/_failed-card.tsx
src/app/admin/tasks/_client.tsx
src/app/admin/bill-scans/_client.tsx
src/app/bills/[id]/_inventory-queue.tsx
src/app/household/settings/page.tsx
src/app/household/meal-times/page.tsx
src/components/tasks/notification-toggle.tsx
src/components/tasks/recurrence-picker.tsx
src/components/shopping/auto-add-button.tsx
src/components/shopping/quick-add.tsx
src/components/dashboard/day-view.tsx
src/components/ui/sheet.tsx       (icon-sm here)
src/components/ui/dialog.tsx      (icon-sm here)
(+ any others surfaced by typecheck)
```

- [ ] **Step 4: Run tests + lint**

```bash
pnpm test tests/design/touch-targets.test.ts && pnpm test tests/design/contrast.test.ts && pnpm typecheck && pnpm lint
```

Expected: touch-target test now passes for `button.*`. Contrast still green. Typecheck clean. Lint clean (or has only pre-existing non-design issues).

- [ ] **Step 5: Smoke test the dev server**

```bash
pnpm dev
```

Visit <http://localhost:3000/dashboard>, <http://localhost:3000/bills>, <http://localhost:3000/recipes>. Verify buttons render at sane heights, indigo primary is visible, no broken layouts. Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/button.tsx src/lib/design/sizes.ts \
        src/app/scans/ src/app/admin/ src/app/bills/ \
        src/app/household/ src/components/tasks/ src/components/shopping/ \
        src/components/dashboard/ src/components/ui/sheet.tsx src/components/ui/dialog.tsx
git commit -m "refactor(ui): refit Button to new size/variant system; migrate call sites"
```

---

### Task 4.2: Refit `Card`

**Files:**
- Modify: `src/components/ui/card.tsx`

- [ ] **Step 1: Read current card.tsx**

```bash
cat src/components/ui/card.tsx
```

- [ ] **Step 2: Replace its variants with tokenised values**

Rewrite the file so:
- Root container: `rounded-md border border-border bg-surface-1 p-4`
- Header / content / footer slots keep their existing API but use tokens (`text-text-primary`, `text-text-muted` for subtitle, etc.).
- No shadow by default. If the existing card has a `variant="elevated"`, keep it but make it `shadow-sm` only.
- Strip any `dark:` classes.

- [ ] **Step 3: Run typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 4: Smoke test**

```bash
pnpm dev
```

Visit a page that uses cards (dashboard). Stop server.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/card.tsx
git commit -m "refactor(ui): refit Card to design tokens"
```

---

### Task 4.3: Refit `Dialog`

**Files:**
- Modify: `src/components/ui/dialog.tsx`

- [ ] **Step 1: Read current dialog.tsx**

```bash
cat src/components/ui/dialog.tsx
```

- [ ] **Step 2: Apply token + a11y refit**

- Root content: `rounded-lg bg-surface-1 border-border max-w-md`.
- Mobile (`md:` not set): full-width with 16px page padding; safe-area inset bottom on `<DialogFooter>`.
- The close-button (currently `size="icon-sm"`) — leave as `<Button variant="ghost" size="sm">` with a `// TODO(IconButton): replace once IconButton lands` comment. Will be replaced in Task 7.2.
- Strip any `dark:` classes.

- [ ] **Step 3: typecheck + lint + smoke**

```bash
pnpm typecheck && pnpm lint && pnpm dev
```

Open any dialog-using flow (try `pnpm dev` → /tasks/new for the task form). Stop server.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/dialog.tsx
git commit -m "refactor(ui): refit Dialog to design tokens"
```

---

### Task 4.4: Refit `Input`

**Files:**
- Modify: `src/components/ui/input.tsx`
- Modify: `src/lib/design/sizes.ts`

- [ ] **Step 1: Rewrite input.tsx**

The new file should:
- Height: 44px (`h-11`).
- Padding: `px-3`.
- Radius: `rounded-sm`.
- Background: `bg-surface-1`, border `border-border`.
- Focus: `focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`.
- Error variant (`data-[invalid=true]`): `border-danger text-danger`.
- Strip all `dark:` classes.
- Export `inputSizes = { md: { height: 44 } } as const`.

- [ ] **Step 2: Register in sizes.ts**

```ts
// src/lib/design/sizes.ts (append)
import { inputSizes } from "@/components/ui/input";

// inside primitiveSizes:
//   input: inputSizes,
```

- [ ] **Step 3: typecheck + tests + lint**

```bash
pnpm typecheck && pnpm test tests/design/ && pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/input.tsx src/lib/design/sizes.ts
git commit -m "refactor(ui): refit Input to design tokens"
```

---

### Task 4.5: Refit `Label`, `Textarea`

**Files:**
- Modify: `src/components/ui/label.tsx`
- Modify: `src/components/ui/textarea.tsx`

- [ ] **Step 1: Refit `label.tsx`**

Apply: `text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted`. No `dark:` classes.

- [ ] **Step 2: Refit `textarea.tsx`**

Mirror input: `min-h-[88px] rounded-sm border-border bg-surface-1 px-3 py-2 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`. (`min-h-22` doesn't exist in Tailwind v4's default scale; bracket notation is allowed here because `src/components/ui/` is allowlisted.) Strip `dark:` classes.

- [ ] **Step 3: typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/label.tsx src/components/ui/textarea.tsx
git commit -m "refactor(ui): refit Label and Textarea to design tokens"
```

---

### Task 4.6: Refit `Sheet`

**Files:**
- Modify: `src/components/ui/sheet.tsx`

- [ ] **Step 1: Refit**

- Top radius `rounded-t-lg`.
- Background `bg-surface-1`, border `border-border` (top edge only).
- Full-width on mobile, max-width on `md:` (whatever the existing breakpoint convention is — keep it).
- Add a drag-handle visual element at the top: `<div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border-strong" />`.
- Safe-area inset bottom: `pb-[env(safe-area-inset-bottom)]`. Allowlist exempts `src/components/ui/` so the lint rule won't fire.
- Close-button (currently `size="icon-sm"`): same TODO as dialog.

- [ ] **Step 2: typecheck + lint + smoke**

```bash
pnpm typecheck && pnpm lint && pnpm dev
```

Open a flow that uses sheet (`/plan` uses slot-action-sheet). Verify drag handle and safe area. Stop server.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/sheet.tsx
git commit -m "refactor(ui): refit Sheet to design tokens (drag handle, safe area)"
```

---

## Phase 5 — Delete `PendingButton`, fold into `Button`

### Task 5.1: Migrate `PendingButton` call sites to `<Button loading>`

**Files:**
- 17 files listed earlier (every PendingButton import).

- [ ] **Step 1: Find every import**

```bash
grep -rln "from \"@/components/ui/pending-button\"\|from '@/components/ui/pending-button'" src/
```

- [ ] **Step 2: For each file, replace import and usage**

Before:
```tsx
import { PendingButton } from "@/components/ui/pending-button";
…
<PendingButton type="submit" size="sm" variant="outline">Save</PendingButton>
```

After:
```tsx
import { Button } from "@/components/ui/button";
import { useFormStatus } from "react-dom";
…
function SaveButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" size="sm" variant="secondary" loading={pending}>Save</Button>;
}
…
<SaveButton />
```

If `PendingButton` was just wrapping `useFormStatus` internally (read the file to confirm), define a small inline wrapper per call site as shown. To avoid copy-paste, you can create a tiny helper `src/components/ui/submit-button.tsx`:

```tsx
"use client";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";

export function SubmitButton(props: ButtonProps) {
  const { pending } = useFormStatus();
  return <Button type="submit" loading={pending} {...props} />;
}
```

Then call sites become:
```tsx
import { SubmitButton } from "@/components/ui/submit-button";
…
<SubmitButton size="sm" variant="secondary">Save</SubmitButton>
```

- [ ] **Step 3: Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/submit-button.tsx src/  # any migrated call sites
git commit -m "refactor(ui): migrate PendingButton call sites to Button + SubmitButton"
```

---

### Task 5.2: Delete `pending-button.tsx`

**Files:**
- Delete: `src/components/ui/pending-button.tsx`

- [ ] **Step 1: Confirm no references remain**

```bash
grep -rln "pending-button\|PendingButton" src/
```

Expected: empty.

- [ ] **Step 2: Delete + verify build**

```bash
rm src/components/ui/pending-button.tsx
pnpm typecheck && pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add -A src/components/ui/pending-button.tsx
git commit -m "refactor(ui): delete pending-button.tsx (folded into Button loading)"
```

---

## Phase 6 — New primitives

### Task 6.1: `Banner`

**Files:**
- Create: `src/components/ui/banner.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/ui/banner.tsx
import { type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const bannerVariants = cva(
  "flex gap-3 rounded-md border p-3",
  {
    variants: {
      tone: {
        info: "bg-info-subtle border-[color:var(--info)]/30",
        success: "bg-success-subtle border-[color:var(--success)]/30",
        warning: "bg-warning-subtle border-[color:var(--warning)]/30",
        danger: "bg-danger-subtle border-[color:var(--danger)]/30",
        neutral: "bg-surface-1 border-border",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

const iconChip = cva(
  "inline-flex size-6 shrink-0 items-center justify-center rounded text-[12px] font-bold text-white",
  {
    variants: {
      tone: {
        info: "bg-info",
        success: "bg-success",
        warning: "bg-warning",
        danger: "bg-danger",
        neutral: "bg-text-muted",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

type BannerProps = VariantProps<typeof bannerVariants> & {
  icon?: ReactNode;
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function Banner({ tone, icon, title, children, action, className }: BannerProps) {
  const defaultGlyph: Record<NonNullable<typeof tone>, string> = {
    info: "i", success: "✓", warning: "!", danger: "×", neutral: "•",
  };
  const t = tone ?? "neutral";
  return (
    <div className={cn(bannerVariants({ tone: t }), className)} role="status">
      <span className={iconChip({ tone: t })} aria-hidden>{icon ?? defaultGlyph[t]}</span>
      <div className="flex-1 text-sm text-text-secondary leading-snug">
        {title ? <div className="font-semibold text-text-primary mb-0.5">{title}</div> : null}
        {children}
        {action ? <div className="mt-1">{action}</div> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/banner.tsx
git commit -m "feat(ui): add Banner primitive"
```

---

### Task 6.2: `IconButton`

**Files:**
- Create: `src/components/ui/icon-button.tsx`
- Modify: `src/lib/design/sizes.ts`

- [ ] **Step 1: Implement**

```tsx
// src/components/ui/icon-button.tsx
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const iconButtonVariants = cva(
  [
    "inline-flex size-11 items-center justify-center rounded-sm",
    "transition-colors outline-none select-none",
    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:size-5",
  ].join(" "),
  {
    variants: {
      variant: {
        filled: "bg-primary text-primary-foreground hover:bg-primary-soft active:bg-primary-pressed",
        tonal: "bg-primary-subtle text-primary hover:bg-primary-subtle/70",
        ghost: "bg-transparent text-primary hover:bg-primary-subtle",
      },
    },
    defaultVariants: { variant: "ghost" },
  },
);

type IconButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof iconButtonVariants> & {
    "aria-label": string;  // required
  };

export function IconButton({ className, variant, ...props }: IconButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="icon-button"
      className={cn(iconButtonVariants({ variant, className }))}
      {...props}
    />
  );
}

export const iconButtonSizes = { default: { height: 44 } } as const;
```

- [ ] **Step 2: Register**

```ts
// src/lib/design/sizes.ts (append)
import { iconButtonSizes } from "@/components/ui/icon-button";
// in primitiveSizes:
//   iconButton: iconButtonSizes,
```

- [ ] **Step 3: Replace `// TODO(IconButton)` markers from Tasks 4.3 and 4.6**

```bash
grep -rln "TODO(IconButton)" src/
```

Update each (dialog close, sheet close) to use `<IconButton variant="ghost" aria-label="Close">…</IconButton>`.

- [ ] **Step 4: typecheck + tests + lint**

```bash
pnpm typecheck && pnpm test tests/design/ && pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/icon-button.tsx src/lib/design/sizes.ts src/components/ui/dialog.tsx src/components/ui/sheet.tsx
git commit -m "feat(ui): add IconButton, replace dialog/sheet close buttons"
```

---

### Task 6.3: `ListRow`

**Files:**
- Create: `src/components/ui/list-row.tsx`
- Modify: `src/lib/design/sizes.ts`

- [ ] **Step 1: Implement**

```tsx
// src/components/ui/list-row.tsx
import Link from "next/link";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Mode = "navigational" | "static" | "actionable";

type Common = {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  className?: string;
};

type NavRow = Common & { mode: "navigational"; href: string };
type StaticRow = Common & { mode?: "static" };
type ActionableRow = Common & { mode: "actionable"; action: ReactNode };

export type ListRowProps = NavRow | StaticRow | ActionableRow;

const rowBase =
  "flex min-h-14 items-center gap-3 px-4 py-2.5 border-b border-border last:border-0";
const rowInteractive = "hover:bg-primary-subtle/50 active:bg-primary-subtle";

function Body({ leading, title, subtitle, trailing }: Common) {
  return (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-text-primary">{title}</span>
        {subtitle ? (
          <span className="block truncate text-[13px] text-text-secondary">{subtitle}</span>
        ) : null}
      </span>
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </>
  );
}

export function ListRow(props: ListRowProps) {
  if (props.mode === "navigational") {
    const { href, leading, title, subtitle, trailing, className } = props;
    return (
      <Link href={href} className={cn(rowBase, rowInteractive, className)}>
        <Body leading={leading} title={title} subtitle={subtitle} trailing={trailing ?? <span aria-hidden className="text-text-disabled">›</span>} />
      </Link>
    );
  }
  if (props.mode === "actionable") {
    const { action, leading, title, subtitle, className } = props;
    return (
      <div className={cn(rowBase, className)}>
        <Body leading={leading} title={title} subtitle={subtitle} trailing={action} />
      </div>
    );
  }
  const { leading, title, subtitle, trailing, className } = props;
  return (
    <div className={cn(rowBase, className)}>
      <Body leading={leading} title={title} subtitle={subtitle} trailing={trailing} />
    </div>
  );
}

export const listRowSizes = { default: { height: 56 } } as const;
```

- [ ] **Step 2: Register sizes**

```ts
// src/lib/design/sizes.ts (append)
import { listRowSizes } from "@/components/ui/list-row";
// in primitiveSizes:
//   listRow: listRowSizes,
```

- [ ] **Step 3: typecheck + tests + lint**

```bash
pnpm typecheck && pnpm test tests/design/ && pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/list-row.tsx src/lib/design/sizes.ts
git commit -m "feat(ui): add ListRow primitive"
```

---

### Task 6.4: `Avatar`

**Files:**
- Create: `src/components/ui/avatar.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/ui/avatar.tsx
import { cn } from "@/lib/utils";

const SIZES = { sm: 24, md: 32, lg: 48 } as const;
type AvatarSize = keyof typeof SIZES;

// Six saturated backgrounds, all AA against white text (verified manually before merge).
const HASH_PALETTE = ["#3949AB", "#5C6BC0", "#1F7A3B", "#0E6E6E", "#B26100", "#6A1B9A"] as const;

function hashIndex(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % HASH_PALETTE.length;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
  return (parts[0][0]! + parts[parts.length - 1][0]!).toUpperCase();
}

type AvatarProps = {
  name: string;
  size?: AvatarSize;
  imageUrl?: string;
  className?: string;
};

export function Avatar({ name, size = "md", imageUrl, className }: AvatarProps) {
  const px = SIZES[size];
  const fontPx = size === "sm" ? 10 : size === "md" ? 12 : 16;
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={name}
        width={px}
        height={px}
        className={cn("rounded-full object-cover", className)}
      />
    );
  }
  const color = HASH_PALETTE[hashIndex(name)];
  return (
    <span
      aria-label={name}
      role="img"
      className={cn("inline-flex items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ width: px, height: px, fontSize: fontPx, background: color }}
    >
      {initials(name)}
    </span>
  );
}
```

- [ ] **Step 2: typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

The inline `style={{ background: color }}` is intentional — we cannot tokenise per-user color. The `eslint-disable-next-line` for `next/image` is acceptable because avatars are typically remote and bounded in size; if Next 16 prefers `next/image`, swap to `<Image>` and remove the disable.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/avatar.tsx
git commit -m "feat(ui): add Avatar primitive (initials + deterministic color)"
```

---

### Task 6.5: `TopAppBar`

**Files:**
- Create: `src/components/ui/top-app-bar.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/components/ui/top-app-bar.tsx
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  className?: string;
};

export function TopAppBar({ leading, title, subtitle, trailing, className }: Props) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex items-center gap-1 border-b border-border bg-surface-1",
        "h-[52px] px-1 pt-[env(safe-area-inset-top)]",
        className,
      )}
    >
      <span className="flex h-11 w-11 items-center justify-center">{leading}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] font-semibold text-text-primary">{title}</div>
        {subtitle ? <div className="truncate text-[13px] text-text-muted">{subtitle}</div> : null}
      </div>
      {trailing ? <div className="flex items-center gap-1">{trailing}</div> : null}
    </header>
  );
}
```

Note: `h-[52px]` is intentional — Tailwind v4's default scale jumps from `h-12` (48) to `h-14` (56), so bracket notation is required. Allowlisted by the design-values rule.

- [ ] **Step 2: typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/top-app-bar.tsx
git commit -m "feat(ui): add TopAppBar primitive"
```

---

### Task 6.6: `TabBar`

**Files:**
- Create: `src/components/ui/tab-bar.tsx`
- Modify: `src/lib/design/sizes.ts`

- [ ] **Step 1: Implement**

```tsx
// src/components/ui/tab-bar.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tab = {
  href: string;
  label: string;
  icon: ReactNode;
  /** When set, matches if pathname startsWith any of these prefixes. Defaults to [href]. */
  match?: string[];
};

type Props = { tabs: Tab[]; className?: string };

export function TabBar({ tabs, className }: Props) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className={cn(
        "sticky bottom-0 z-30 flex border-t border-border bg-surface-1",
        "h-14 pb-[env(safe-area-inset-bottom)]",
        className,
      )}
    >
      {tabs.map(tab => {
        const prefixes = tab.match ?? [tab.href];
        const active = prefixes.some(p => pathname === p || pathname.startsWith(p + "/"));
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold",
              active ? "text-primary" : "text-text-muted",
            )}
          >
            <span aria-hidden className="[&_svg]:size-[18px]">{tab.icon}</span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export const tabBarSizes = { default: { height: 56 } } as const;
```

- [ ] **Step 2: Register sizes**

```ts
// src/lib/design/sizes.ts (append)
import { tabBarSizes } from "@/components/ui/tab-bar";
// in primitiveSizes:
//   tabBar: tabBarSizes,
```

- [ ] **Step 3: typecheck + tests + lint**

```bash
pnpm typecheck && pnpm test tests/design/ && pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/tab-bar.tsx src/lib/design/sizes.ts
git commit -m "feat(ui): add TabBar primitive"
```

---

## Phase 7 — Integration

### Task 7.1: Thin the 5 prompt cards to `Banner` shells

**Files:**
- Modify: `src/components/site/pending-scans-banner.tsx`
- Modify: `src/components/site/task-setup-prompt-card.tsx`
- Modify: `src/components/site/inventory-prompt-card.tsx`
- Modify: `src/components/site/owner-invite-maid-card.tsx`
- Modify: `src/components/site/household-mode-card.tsx`

- [ ] **Step 1: For each file, replace bespoke markup with `<Banner>`**

Pattern, applied per file:

```tsx
// Before (paraphrased — keep the file's existing data/logic):
<div className="flex … bg-amber-50 border-amber-200 rounded-lg p-3">
  <span className="text-amber-700">!</span>
  <div>
    <div className="font-semibold">Electricity bill due in 3 days</div>
    <div>₹2,840 — Asha to log when paid.</div>
  </div>
</div>

// After:
import { Banner } from "@/components/ui/banner";

<Banner
  tone="warning"
  title="Electricity bill due in 3 days"
  action={<Link href="/bills" className="text-primary font-semibold">View →</Link>}
>
  ₹2,840 — Asha to log when paid.
</Banner>
```

Tones per file:
- `pending-scans-banner` → `tone="warning"`
- `task-setup-prompt-card` → `tone="info"`
- `inventory-prompt-card` → `tone="info"`
- `owner-invite-maid-card` → `tone="neutral"`
- `household-mode-card` → `tone="info"`

Keep each file's existing data fetching / conditional rendering / call-site API intact. The change is purely the rendered markup.

- [ ] **Step 2: typecheck + lint + smoke**

```bash
pnpm typecheck && pnpm lint && pnpm dev
```

Visit /dashboard — banners should render in the new style. Stop server.

- [ ] **Step 3: Commit**

```bash
git add src/components/site/
git commit -m "refactor(site): thin prompt cards to Banner shells"
```

---

### Task 7.2: Retire `main-nav.tsx`, integrate `TabBar` + per-route `TopAppBar`

**Files:**
- Modify: `src/app/layout.tsx`
- Delete: `src/components/site/main-nav.tsx`
- Modify: every page that imported `MainNav` (23 files, list from earlier).

This is the biggest single integration step. Approach it in three sub-steps.

- [ ] **Step 1: Add `TabBar` to root layout, define the tab set**

Add to [src/app/layout.tsx](../../../src/app/layout.tsx) inside `<body>` after `{children}`:

```tsx
import { TabBar, type Tab } from "@/components/ui/tab-bar";
// pick lucide icons (already a dep). e.g. Home, Utensils, Receipt, ShoppingCart
import { Home, Utensils, Receipt, ShoppingCart } from "lucide-react";

const TABS: Tab[] = [
  { href: "/dashboard", label: "Home", icon: <Home /> },
  { href: "/plan", label: "Meals", icon: <Utensils />, match: ["/plan", "/recipes"] },
  { href: "/bills", label: "Bills", icon: <Receipt /> },
  { href: "/shopping", label: "Shop", icon: <ShoppingCart /> },
];

// In the body:
<body className="min-h-dvh antialiased pb-14">
  …existing dev script…
  {children}
  <TabBar tabs={TABS} />
</body>
```

The `pb-14` reserves room for the tab bar so content isn't covered. Replace with `pb-[calc(56px+env(safe-area-inset-bottom))]` if the bar feels wrong on iOS.

- [ ] **Step 2: For each page that used `<MainNav>`, remove the import and replace with `<TopAppBar title="…">`**

The 23 page files:

```
src/app/tasks/edit/[id]/page.tsx
src/app/shopping/loading.tsx
src/app/tasks/new/page.tsx
src/app/shopping/page.tsx
src/app/scans/pending/page.tsx
src/app/dashboard/loading.tsx
src/app/dashboard/page.tsx
src/app/bills/[id]/page.tsx
src/app/recipes/loading.tsx
src/app/recipes/[id]/page.tsx
src/app/recipes/page.tsx
src/app/recipes/new/page.tsx
src/app/recipes/[id]/edit/page.tsx
src/app/inventory/loading.tsx
src/app/inventory/conversions/page.tsx
src/app/inventory/page.tsx
src/app/inventory/new/page.tsx
src/app/inventory/[id]/page.tsx
src/app/household/settings/loading.tsx
src/app/household/settings/page.tsx
src/app/household/meal-times/page.tsx
src/components/site/pending-scans-banner.tsx
src/components/site/main-nav.tsx
```

Pattern per file:
```tsx
// Before:
import { MainNav } from "@/components/site/main-nav";
…
<MainNav />
<main>…</main>

// After:
import { TopAppBar } from "@/components/ui/top-app-bar";
import { IconButton } from "@/components/ui/icon-button";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
…
<TopAppBar
  title="Bills"
  leading={
    <Link href="/dashboard" aria-label="Back">
      <IconButton variant="ghost" aria-label="Back"><ChevronLeft /></IconButton>
    </Link>
  }
/>
<main>…</main>
```

For loading.tsx files, render just `<TopAppBar title="…" />` and a skeleton in `<main>`.

- [ ] **Step 3: Delete `main-nav.tsx`**

```bash
grep -rln "main-nav\|MainNav" src/
```

Expected: empty (or only test files we removed in step 2). If empty:

```bash
rm src/components/site/main-nav.tsx
```

- [ ] **Step 4: Typecheck + lint + dev**

```bash
pnpm typecheck && pnpm lint && pnpm dev
```

Visit each top-level route (`/dashboard`, `/plan`, `/bills`, `/shopping`, `/recipes`, `/inventory`, `/household/settings`). Confirm: bottom tab bar visible everywhere, active tab highlighted, top app bar shows route title, back works on detail pages, content not obscured. Stop server.

- [ ] **Step 5: Commit**

```bash
git add -A src/app/ src/components/site/main-nav.tsx
git commit -m "refactor(layout): retire main-nav; integrate TabBar + TopAppBar"
```

---

## Phase 8 — Dev catalog (`/dev/primitives`)

### Task 8.1: Per-primitive `.examples.tsx` files

**Files:**
- Create: 14 files at `src/components/ui/<primitive>.examples.tsx` for each of: button, card, dialog, input, label, sheet, textarea, banner, icon-button, list-row, avatar, top-app-bar, tab-bar, submit-button.

Each file pattern:

- [ ] **Step 1: For each primitive, write `<primitive>.examples.tsx`**

```tsx
// src/components/ui/button.examples.tsx
import { Button } from "./button";

export function ButtonExamples() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Button</h2>
      <div className="flex flex-wrap gap-3">
        <Button size="sm">Small (extends row)</Button>
        <Button size="md">Medium (default)</Button>
        <Button size="lg">Large</Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button disabled>Disabled</Button>
        <Button loading>Loading</Button>
      </div>
    </section>
  );
}
```

Repeat the pattern for every primitive: render every variant × size × state. Keep each file short; copy-paste between files is fine — clarity > DRY for example pages.

- [ ] **Step 2: typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/*.examples.tsx
git commit -m "feat(dev): add .examples.tsx for every primitive"
```

---

### Task 8.2: `/dev/primitives` catalog page

**Files:**
- Create: `src/app/dev/primitives/page.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/app/dev/primitives/page.tsx
import { notFound } from "next/navigation";
import { ButtonExamples } from "@/components/ui/button.examples";
import { CardExamples } from "@/components/ui/card.examples";
import { DialogExamples } from "@/components/ui/dialog.examples";
import { InputExamples } from "@/components/ui/input.examples";
import { LabelExamples } from "@/components/ui/label.examples";
import { SheetExamples } from "@/components/ui/sheet.examples";
import { TextareaExamples } from "@/components/ui/textarea.examples";
import { BannerExamples } from "@/components/ui/banner.examples";
import { IconButtonExamples } from "@/components/ui/icon-button.examples";
import { ListRowExamples } from "@/components/ui/list-row.examples";
import { AvatarExamples } from "@/components/ui/avatar.examples";
import { TopAppBarExamples } from "@/components/ui/top-app-bar.examples";
import { TabBarExamples } from "@/components/ui/tab-bar.examples";
import { SubmitButtonExamples } from "@/components/ui/submit-button.examples";

export default function PrimitivesCatalog() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-10 p-4">
      <h1 className="text-2xl font-bold">Primitives</h1>
      <ButtonExamples />
      <SubmitButtonExamples />
      <CardExamples />
      <DialogExamples />
      <InputExamples />
      <LabelExamples />
      <SheetExamples />
      <TextareaExamples />
      <BannerExamples />
      <IconButtonExamples />
      <ListRowExamples />
      <AvatarExamples />
      <TopAppBarExamples />
      <TabBarExamples />
    </div>
  );
}
```

- [ ] **Step 2: Smoke test**

```bash
pnpm dev
```

Visit <http://localhost:3000/dev/primitives>. Every primitive should render. Stop server.

```bash
NODE_ENV=production pnpm build && NODE_ENV=production pnpm start &
sleep 4
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/dev/primitives
kill %1
```

Expected: `404` (production should hide the catalog).

- [ ] **Step 3: Commit**

```bash
git add src/app/dev/primitives/page.tsx
git commit -m "feat(dev): add /dev/primitives catalog page (dev-only)"
```

---

## Phase 9 — Documentation wire-up

### Task 9.1: Link the spec from `AGENTS.md`

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add a "Design system" section**

Append to [AGENTS.md](../../../AGENTS.md):

```markdown
## Design system

The visual foundation, tokens, primitives, and enforcement rules are defined in
[docs/superpowers/specs/2026-05-17-design-system-foundation.md](docs/superpowers/specs/2026-05-17-design-system-foundation.md).

When adding UI:
- Use tokens, never arbitrary hex / oklch / pixel values (enforced by ESLint).
- Every interactive element ≥ 44×44px (enforced by `tests/design/touch-targets.test.ts`).
- New foreground/background color pairs must be added to `src/lib/design/color-pairs.ts`.
- IconButton requires `aria-label` (enforced by ESLint).

Deferred follow-ups (dark mode, persona UX, i18n, etc.) live in
[docs/superpowers/specs/2026-05-17-design-system-foundation/follow-ups.md](docs/superpowers/specs/2026-05-17-design-system-foundation/follow-ups.md).
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: link design system spec from AGENTS.md"
```

---

## Phase 10 — Final verification

### Task 10.1: Full test suite, lint, build

**Files:** none.

- [ ] **Step 1: Run everything**

```bash
pnpm test && pnpm lint && pnpm typecheck && pnpm build
```

Expected: all green. If anything red, fix the root cause — do not commit work-arounds.

- [ ] **Step 2: Manual smoke pass**

```bash
pnpm dev
```

Walk through every top-level route on a mobile viewport (Chrome DevTools, iPhone 12 Pro):

- `/dashboard` — banners render, dashboard cards readable, primary CTAs indigo
- `/plan` — meal cards, slot action sheet opens cleanly
- `/bills` — list rows render, currency tabular-nums
- `/shopping` — quick-add input + button
- `/recipes` and `/recipes/[id]` — recipe form, add-to-today button
- `/inventory` — list, new flow
- `/household/settings` — form (SubmitButton)
- `/scans/pending` — review/failed cards
- `/dev/primitives` — every primitive renders

Confirm: tab bar always visible at bottom, top app bar shows correct title, no obvious contrast issues, no layout breaks. Stop server.

- [ ] **Step 3: Final commit if any tweaks were needed**

```bash
git status   # any uncommitted? commit them.
git log --oneline origin/main..HEAD
```

Expected log: ~25-30 commits, one per task. **Do not push. Do not merge.** Tell the user the branch is ready for them to test locally.

---

## Notes for the engineer

- **Frequent commits** — one per task. If a task is rolling back, prefer reverting the commit over rewriting history.
- **TDD** — Phase 1 + 2 + 3 establish failing tests before implementation. Honor that pattern in Phase 4+: write a small structural assertion before touching a primitive when feasible.
- **No `dark:` classes** — every refit step strips `dark:` classes. They will silently re-apply if anyone re-enables `class="dark"` on `<html>` in the future. Better to remove them.
- **`@base-ui/react`** — Button, Dialog, Sheet wrap base-ui primitives. Keep that pattern; do not roll your own focus/escape handling.
- **`pnpm test` runs everything under `tests/`** — including the slow DB-backed tests in `tests/actions` and `tests/db`. For fast iteration on design tests use `pnpm test tests/design/`.
- **No push, no merge.** The user explicitly asked to keep this branch local and test before integrating. The plan ends with the branch in a verified-locally state, awaiting their decision.
