# Design System Foundation

- **Date:** 2026-05-17
- **Status:** Draft (pending implementation)
- **Slice:** A of 4 in the mobile-app design effort. See [follow-ups](./2026-05-17-design-system-foundation/follow-ups.md).
- **Brainstorm artifacts:** [`./2026-05-17-design-system-foundation/brainstorm/`](./2026-05-17-design-system-foundation/brainstorm/)

## Why this spec exists

The PWA today uses shadcn defaults with an all-neutral grayscale palette (`oklch(* 0 0)`) and Geist Sans. There is no brand presence, no enforced touch-target floor, no semantic color scale, and the half-defined `.dark` block in `globals.css` is just grayscale shifted. Before we tackle persona-tailored UX, multilingual content, or any redesign of pages, the visual foundation has to be load-bearing — concrete tokens, audited primitives, and CI gates that prevent regression. That's this spec.

## Goals

- Replace the placeholder neutral palette with a deliberate "trust utility" identity (indigo on warm cream).
- Replace Geist with IBM Plex Sans so Latin scripts (English, Mizo) and Devanagari (Hindi) share one design rhythm — chosen now so the i18n slice (D) doesn't trigger a typography redo for these scripts. Bengali script (relevant to Manipuri) is **not** covered by Plex; that fallback is deferred to slice D.
- Define every token (color, type, spacing, sizing, radius) once, in `globals.css`, exposed to Tailwind via the existing `@theme inline` block.
- Audit and refit the 8 existing UI primitives against the new tokens and a 44px touch-target floor.
- Add 6 new primitives (`TabBar`, `TopAppBar`, `ListRow`, `IconButton`, `Banner`, `Avatar`) that the existing app needs but doesn't have.
- Make violations of the system fail CI, not silently rot.

## Non-goals (deferred — see [follow-ups](./2026-05-17-design-system-foundation/follow-ups.md))

- Dark mode.
- Page-level redesign (layout / structure of existing pages).
- Maid-tailored UX (slice B).
- i18n infrastructure (slice C) and translated content (slice D).
- Icon system / icon library decisions.
- Motion / animation tokens beyond a one-line default.
- RTL or other i18n-aware component behavior.

## Decision log

Each decision below was made during the 2026-05-17 brainstorm. Mockups for each are in [`./2026-05-17-design-system-foundation/brainstorm/`](./2026-05-17-design-system-foundation/brainstorm/).

### D1 — Slice to tackle first

- **Options:** A (design system) · B (persona UX) · C (i18n infra) · D (translations).
- **Chosen:** **A (design system).**
- **Why:** Unblocks B; can ship without knowing the final i18n library; the rest of the work is sitting on placeholder visual today.
- **Mockup:** [`brainstorm/scope.html`](./2026-05-17-design-system-foundation/brainstorm/scope.html)

### D2 — Visual direction

- **Options:** Warm Home · Calm Modern · Vibrant India · Trust Utility.
- **Chosen:** **Trust Utility.**
- **Why:** The user wants the app read as dependable and serious (essential tool) rather than as a cheerful consumer app. The chassis is utility; warmth is added selectively via cream surfaces.
- **Mockup:** [`brainstorm/direction.html`](./2026-05-17-design-system-foundation/brainstorm/direction.html)

### D3 — Primary color + neutral temperature

- **Options:** Civic Blue cool · Deep Teal balanced · Indigo + warm neutrals · Forest + warm neutrals.
- **Chosen:** **Indigo + warm neutrals.** Primary `#3949AB` on surface `#FAF7F2`.
- **Why:** Indigo carries the bank-grade trust signal; cream surfaces let cooking/recipe content coexist with bills without feeling out of place.
- **Mockup:** [`brainstorm/palette.html`](./2026-05-17-design-system-foundation/brainstorm/palette.html)

### D4 — Typography

- **Options:** IBM Plex Sans (covering Latin + Devanagari, with Bengali deferred to slice D) · Geist + Noto Sans Bengali (paired) · Inter + Noto Sans Bengali (paired).
- **Chosen:** **IBM Plex Sans** (replaces Geist as `--font-sans`). One sibling family loaded later for Hindi: IBM Plex Sans Devanagari.
- **Why:** Coherent design rhythm across English, Mizo (both Latin), and Hindi (Devanagari) — all three covered by Plex siblings from the same designer. Trust-context fit (IBM brand origin).
- **Honest caveat (corrected post-brainstorm):** During the brainstorm I incorrectly claimed IBM Plex covers Bengali script. It does not. The Bengali samples on the comparison page rendered via browser system fallback, not Plex. The user reconfirmed this choice on 2026-05-17 with full awareness: Bengali-script support (for Manipuri) is **out of scope for this spec** and becomes a slice D decision — likely either Noto Sans Bengali as a fallback or Meitei Mayek via Noto Sans Meetei Mayek, sidestepping Bengali script entirely.
- **Mockup:** [`brainstorm/typography.html`](./2026-05-17-design-system-foundation/brainstorm/typography.html) (Bengali rendering on that page is browser-fallback, not the actual proposed result.)

### D5 — Accessibility tier

- **Options:** Standard (44px / AA / 130% scaling) · Inclusive (48px / AA / 150%) · Maximum (56px / AAA / 200%).
- **Chosen:** **Standard (Tier 1).** WCAG AA, 44×44px minimum touch targets, 14px minimum body, OS text scaling honored to 130%, reduce-motion respected, visible focus indicators.
- **Why:** Matches iOS HIG baseline, keeps designs polished and dense. User accepts the tradeoff of relying on younger thumbs and good light over the more inclusive Tier 2.
- **Mockup:** [`brainstorm/a11y.html`](./2026-05-17-design-system-foundation/brainstorm/a11y.html)

### D6 — Dark mode strategy

- **Options:** Light-only V1 · Auto (system preference) · User toggle.
- **Chosen:** **Light-only V1.** The existing half-defined `.dark` block in `globals.css` is removed (better no dark mode than a half-broken one).
- **Why:** Smaller scope. Dark gets its own future spec when prioritized.

### D7 — Refactor depth

- **Options:** Tokens only · Tokens + primitives audit · Tokens + primitives + page refit.
- **Chosen:** **Tokens + primitives audit.** Page refit is a deliberate follow-on.
- **Why:** Tokens-only ships a system the app doesn't actually conform to. Page refit duplicates work slice B will redo. This option ships a real foundation that B can build on.

## Foundation tokens

All tokens are CSS custom properties on `:root` in [src/app/globals.css](../../../src/app/globals.css), exposed to Tailwind v4 via the existing `@theme inline` block. New token names extend the shadcn convention already in place.

### Color tokens (light only)

```text
# Primary
--primary-subtle:   #E8EAF6     /* indigo 50  — subtle backgrounds */
--primary-soft:     #5C6BC0     /* indigo 400 — hover/secondary surfaces */
--primary:          #3949AB     /* indigo 600 — primary brand & CTA */
--primary-pressed:  #283593     /* indigo 800 — active/pressed state */
--primary-foreground: #FFFFFF

# Surfaces & borders
--surface-0:        #FAF7F2     /* page background — warm cream */
--surface-1:        #FFFFFF     /* card / sheet / elevated */
--border:           #EFE9E1     /* default border */
--border-strong:    #D9D2C5     /* dividers, emphasized borders */

# Text
--text-primary:     #111111     /* ~16:1 on surface-0, AAA */
--text-secondary:   #555555     /* ~8:1, AA+ */
--text-muted:       #767676     /* ~4.6:1, AA body (NOT lighter) */
--text-disabled:    #B0AFAA     /* non-text-content only */

# Semantic
--success:          #1F7A3B    --success-subtle: #E9F8EE
--warning:          #B26100    --warning-subtle: #FFF1E0
--danger:           #C62828    --danger-subtle:  #FEEAEA
--info:             #1859D1    --info-subtle:    #E8F3FF
```

**Contrast registry.** Every foreground/background token *pair* that the design uses lives in `src/lib/design/color-pairs.ts`. A vitest test reads that registry and asserts ≥ 4.5:1 (or ≥ 3:1 for large text marked as such). Adding a new pair without registering it fails CI.

### Typography tokens

- **Font family:** `'IBM Plex Sans', system-ui, -apple-system, sans-serif`. Weights 400, 500, 600, 700. Loaded via `next/font/google` in [src/app/layout.tsx](../../../src/app/layout.tsx) (replaces the current `Geist` import).
- **Latin scripts (English, Mizo):** covered natively by IBM Plex Sans, including the diacritics Mizo uses (â, ê, î, ô, û).
- **Devanagari (Hindi):** when added by slice D, load IBM Plex Sans Devanagari as a sibling family. Combined font-family declaration: `'IBM Plex Sans', 'IBM Plex Sans Devanagari', system-ui, …`. Coherent rhythm because both are designed by the same team.
- **Bengali script and Meitei Mayek (Manipuri):** **not covered by this spec.** IBM Plex does not include Bengali. Slice D will decide whether Manipuri ships in Bengali script (likely Noto Sans Bengali fallback, with explicit acceptance of the rhythm mismatch) or Meitei Mayek (Noto Sans Meetei Mayek). Neither font is loaded in this spec.
- **Numeric variant:** A `.tabular` utility applies `font-variant-numeric: tabular-nums`. Required for money and dates.

| Token       | Size / line-height | Weight | Notes                                       |
| ----------- | ------------------ | ------ | ------------------------------------------- |
| `display`   | 32 / 38            | 700    | Letter-spacing −0.01em                       |
| `h1`        | 24 / 30            | 700    | Letter-spacing −0.005em                      |
| `h2`        | 20 / 26            | 600    |                                             |
| `h3`        | 17 / 24            | 600    |                                             |
| `body-lg`   | 16 / 24            | 400    |                                             |
| `body`      | 15 / 22            | 400    | **Default body.** Above Tier 1 minimum (14). |
| `body-sm`   | 13 / 18            | 400    | Meta / captions only — not main content.    |
| `label`     | 11 / 14            | 600    | Uppercase, letter-spacing +0.08em            |
| `numeric`   | 15 / 22            | 600    | `font-variant-numeric: tabular-nums`         |

### Spacing scale (4px base)

| Token | Px |
| ----- | -- |
| `1`   | 4  |
| `2`   | 8  |
| `3`   | 12 |
| `4`   | 16  *(default page padding)* |
| `5`   | 20 |
| `6`   | 24  *(default card-to-card gap)* |
| `7`   | 32 |
| `8`   | 40 |
| `9`   | 48 |
| `10`  | 64 |

Anything not a multiple of 4 gets pushed back at review.

### Sizing & touch targets

| Token             | Value                        | Notes                                                    |
| ----------------- | ---------------------------- | -------------------------------------------------------- |
| `tap-min`         | 44px                         | Tier 1 floor. Any interactive element must meet this.    |
| `btn-sm`          | 36px height                  | Only allowed when wrapped in a row that gives 44px effective tap area via vertical spacing. Marked `data-tap-extends-row` to exempt from the CI check. |
| `btn-md`          | 44px height                  | **Default button.**                                       |
| `btn-lg`          | 52px height                  | Reserved for primary on-page CTAs.                       |
| `input-height`    | 44px                         |                                                          |
| `icon-btn`        | 44 × 44                      | `aria-label` required (lint-enforced).                    |
| `list-row-min`    | 56px                         | Room for two lines of body text.                          |
| `top-app-bar`     | 52px + safe-area inset top   |                                                          |
| `bottom-tab-bar`  | 56px + safe-area inset bottom|                                                          |

### Radius scale

| Token  | Px    | Default usage                |
| ------ | ----- | ---------------------------- |
| `xs`   | 2     |                              |
| `sm-1` | 4     |                              |
| `sm`   | 6     | **Buttons, inputs.**         |
| `md`   | 8     | **Cards.**                   |
| `lg`   | 12    | **Sheets, dialogs, modals.** |
| `full` | 9999  | Avatars, pill chips.         |

Direction D dictates restraint — defaults sit at the small end.

## Primitive components

### Audit + refit (existing 8 in [src/components/ui/](../../../src/components/ui/))

| File                  | Changes                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `button.tsx`          | Three sizes (36 / 44 / 52). Four variants (primary / secondary / ghost / destructive). Focus ring 2px `--primary`, offset 2px. Loading and disabled states formalized. |
| `card.tsx`            | `surface-1` fill, 1px `border`, radius `md` (8), default padding 16, no shadow by default.                                                                |
| `dialog.tsx`          | Radius `lg` (12), bounded max-w, safe-area inset, mobile centered.                                                                                       |
| `input.tsx`           | 44px height, radius `sm` (6), 2px focus ring. Error variant: border `--danger` + helper text slot.                                                       |
| `label.tsx`           | Adopts the `label` token (11 / 14 / 600 uppercase / +0.08em tracking).                                                                                    |
| `pending-button.tsx`  | **Deleted.** Folded into `button` as `loading={true}`.                                                                                                   |
| `sheet.tsx`           | Top radius `lg`, drag handle, safe-area inset bottom, full-width on mobile.                                                                              |
| `textarea.tsx`        | Matches input visual rules. Min-height 88, max-height optional.                                                                                          |

### Retired

- **[src/components/site/main-nav.tsx](../../../src/components/site/main-nav.tsx)** — replaced by the new bottom `TabBar`. Branding/title moves into `TopAppBar` per route.
- The 5 bespoke prompt cards in [src/components/site/](../../../src/components/site/) (`pending-scans-banner`, `task-setup-prompt-card`, `inventory-prompt-card`, `owner-invite-maid-card`, `household-mode-card`) **keep their files, content, and call sites** but stop owning visual styling — each becomes a thin shell over `<Banner tone="…">`.

### New (6, in [src/components/ui/](../../../src/components/ui/))

#### 1. `TabBar` — bottom navigation
- Height 56px + safe-area inset bottom. Background `surface-1`, top border `border`.
- Each tab: icon (~18px) above 11px/600 label. Active tab uses `--primary`; inactive uses `--text-muted`.
- Variants: 4-tab (default) or 5-tab (max). No icon-only mode.
- A11y: each tab is a `<button>` (or `<Link>` rendered as tab) with `aria-current="page"` when active.

#### 2. `TopAppBar`
- Height 52px + safe-area inset top. Background `surface-1`, bottom border `border`.
- Slots: leading (back button or none), title (17px/600), trailing actions (up to 2 × `IconButton`).
- Optional `subtitle` slot (13px / `--text-muted`).
- Sticky `top: 0` by default.

#### 3. `ListRow`
- Min-height 56px. Padding 10px / 14px.
- Slots: leading (icon, avatar, or none), body (title + optional subtitle), trailing (value / chevron / icon button).
- Modes: `navigational` (chevron, whole row tappable), `static` (display only), `actionable` (trailing icon button).
- A11y: `navigational` renders as `<a>` or `<button>`, full row is tap target.

#### 4. `IconButton`
- 44 × 44. Radius `sm` (6).
- Variants: `filled` (background `--primary`, foreground white) · `tonal` (background `--primary-subtle`, foreground `--primary`) · `ghost` (transparent, foreground `--primary`).
- `aria-label` required — enforced via custom ESLint rule.

#### 5. `Banner` — inline notification
- Padding 12 / 14. Radius `md` (8). 1px border in the tone color.
- Slots: leading icon (24×24 chip), optional `<strong>` title, body text, optional action link.
- Tones: `info` · `success` · `warning` · `danger` · `neutral`. Each maps to its `--{tone}` + `--{tone}-subtle` token pair.
- Used by the 5 retired prompt cards as their visual layer.

#### 6. `Avatar`
- Three sizes: `sm` 24 · `md` 32 · `lg` 48. Radius `full`.
- Initials fallback. Background derived deterministically from `hash(name) % palette` — same person, same color, always. The hash palette is six saturated indigo/teal/forest variants tuned for 4.5:1 contrast against white initials.
- `image` variant for the eventual avatar upload feature.

### Variants and states — coverage rules

Every primitive ships with: `default`, `hover` (desktop only via `@media (hover: hover)`), `active/pressed`, `focus-visible`, `disabled` (40% opacity, `cursor: not-allowed`), and `loading` (where applicable). A colocated `*.examples.tsx` file under each primitive renders every variant × state on one page. Mounted at `/dev/primitives` in development only (gated by `process.env.NODE_ENV === 'development'`).

## Enforcement

- **ESLint rule** banning arbitrary Tailwind color/size values (`bg-[#…]`, `text-[##px]`, raw `oklch()`, hex literals in `className`) outside [src/app/globals.css](../../../src/app/globals.css) and [src/components/ui/](../../../src/components/ui/). Lint failures break CI.
- **ESLint rule** requiring `aria-label` on `<IconButton>` (and any `<button>` with no text children).
- **Contrast vitest test** under [tests/](../../../tests/) iterates over `src/lib/design/color-pairs.ts` and asserts the WCAG ratio for each pair.
- **Touch-target vitest test** renders each interactive primitive into jsdom and asserts computed `min-height` ≥ 44px (or the row-extends exemption is set).
- **No Storybook.** Overkill for 14 primitives. The colocated `*.examples.tsx` files + the `/dev/primitives` page serve the same purpose at ~5% of the maintenance cost.
- **Spec referenced from agent instructions.** This file is added to [AGENTS.md](../../../AGENTS.md) so future agent work doesn't reinvent tokens.

## File map (created / modified)

```text
# Created
src/lib/design/color-pairs.ts            — contrast registry
src/components/ui/tab-bar.tsx            — new primitive
src/components/ui/top-app-bar.tsx        — new primitive
src/components/ui/list-row.tsx           — new primitive
src/components/ui/icon-button.tsx        — new primitive
src/components/ui/banner.tsx             — new primitive
src/components/ui/avatar.tsx             — new primitive
src/components/ui/*.examples.tsx         — per-primitive variant catalog (~14 files)
src/app/dev/primitives/page.tsx          — dev-only catalog page
tests/design/contrast.test.ts            — CI gate
tests/design/touch-targets.test.tsx      — CI gate
eslint-rules/no-arbitrary-design-values.js
eslint-rules/icon-button-needs-label.js

# Modified
src/app/globals.css                      — tokens rewritten; .dark removed
src/app/layout.tsx                       — Geist → IBM Plex Sans
src/components/ui/button.tsx             — refit
src/components/ui/card.tsx               — refit
src/components/ui/dialog.tsx             — refit
src/components/ui/input.tsx              — refit
src/components/ui/label.tsx              — refit
src/components/ui/sheet.tsx              — refit
src/components/ui/textarea.tsx           — refit
src/components/site/*.tsx                — bespoke prompt cards thinned to Banner shells
eslint.config.mjs                        — wire up the two new rules
AGENTS.md                                — link to this spec

# Deleted
src/components/ui/pending-button.tsx     — folds into button(loading={true})
src/components/site/main-nav.tsx         — replaced by TabBar
```

## Out of scope — see [follow-ups.md](./2026-05-17-design-system-foundation/follow-ups.md)

Dark mode, page-level redesign, persona-tailored UX (slice B), i18n infrastructure (slice C), Mizo + Manipuri translations (slice D), icon system, motion tokens beyond a 150–200ms default, RTL/locale-aware components.
