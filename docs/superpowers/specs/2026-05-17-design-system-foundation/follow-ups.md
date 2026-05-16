# Follow-ups — design system foundation

Standing record of work that was **deliberately deferred** during the 2026-05-17 design-system brainstorm. Each item is a candidate future spec. When picking one up, brainstorm it fresh — the notes here are seeds, not decisions.

> **Why this file exists:** the parent spec ([../2026-05-17-design-system-foundation.md](../2026-05-17-design-system-foundation.md)) is intentionally narrow. This file holds everything we explicitly chose *not* to do, so nothing falls on the floor.

## The 4-slice plan (from the original brainstorm)

The original ask ("mobile app design") decomposed into four slices. We shipped slice A only.

| Slice                                          | Status              | Depends on |
| ---------------------------------------------- | ------------------- | ---------- |
| **A — Design system foundation**               | This spec           | —          |
| **B — Maid-tailored persona UX**               | Deferred (see B)    | A          |
| **C — i18n infrastructure**                    | Deferred (see C)    | —          |
| **D — Mizo + Manipuri translated content**     | Deferred (see D)    | C          |

Suggested next pickup: **B**, then **C** (can run in parallel with B), then **D** once C lands.

---

## B — Maid-tailored persona UX

**Premise.** Maids and owners are at "two distant ends of society" (user's words). Today they share the same screens and same nav, with role-gated actions. A persona-tailored experience would give them different home screens, different nav choices, and tone/density tuned to each.

**Seeds for the brainstorm:**

- What the maid actually *does* today in the app — already write-enabled for bills, recipes, inventory, shopping (see `grep "role.*maid"` results). What's missing is workflow shaping, not permissions.
- Maid home screen vs owner dashboard: probably task-of-the-day forward for maids; status overview for owners.
- Big-button, icon-forward navigation for the maid persona (still inside the Tier 1 design tokens — but using `btn-lg` defaults instead of `btn-md`).
- Voice/photo-first inputs where typing is friction (logging a bill amount, marking a meal cooked).
- Tabs the maid sees may not match the tabs the owner sees. Implement via a role-aware `TabBar` config rather than a separate component.
- Tone of voice (microcopy) is part of this spec, not the i18n one.

**Probable scope:** persona-specific home screen, role-aware `TabBar`, possibly persona-specific defaults for button sizing / density. New components are unlikely — this is mostly composition.

**Brainstorm this when:** the new design system has been in production long enough that the team is tired of "but the maid wouldn't tap that" comments.

---

## C — i18n infrastructure

**Premise.** Add the framework, locale persistence, formatting, and string-extraction tooling. Ships zero translated content — that's slice D.

**Seeds:**

- **Library candidates:** `next-intl` (Next.js-native, server-component friendly), `react-i18next` (mature, larger), `lingui` (compile-time, smallest runtime). For Next 16 + RSC, lean toward `next-intl` unless there's a reason not to.
- **Locale on user vs household:** maid in a Manipuri-speaking household with an English-speaking owner — does the household have a locale or each member? Strongly suggest **per-user**, stored on `profiles` (the table at [supabase/migrations/20260510_001_profiles.sql](../../../../supabase/migrations/20260510_001_profiles.sql)).
- **URL strategy:** path prefix (`/mz/dashboard`) vs cookie-driven. Cookie-driven is simpler for a PWA; path prefix is friendlier to share links and SEO (less relevant for an app-shell PWA).
- **Date/number/currency formatting** via `Intl.*` APIs.
- **Plural rules** — English has 2 plural forms, Bengali has 2, Mizo has 2, Manipuri has 1. CLDR data handles all of this.
- **Build-time vs runtime catalog loading** — split-by-route at minimum; lazy-load less-used locales.
- **Server-component support** — locale must resolve on the server for the initial render.

**Out-of-scope-of-C:** Mizo / Manipuri content itself (that's D), font fallback for Meitei Mayek (handled when content needs it).

---

## D — Mizo + Manipuri translated content

**Premise.** Actual translated strings. Low-resource languages — needs native speakers, a glossary, and a review process. Mostly a content/people problem, not engineering.

**Seeds:**

- **Script + font for Manipuri — open question owned by this slice.** Slice A locks IBM Plex Sans for Latin (English, Mizo) and IBM Plex Sans Devanagari for Hindi, but does **not** cover Bengali script. Two paths to evaluate when this slice is brainstormed:
  - **Manipuri in Bengali script** (Eastern Nagari, broader browser font support, common written form). Requires pairing Noto Sans Bengali with IBM Plex — accept the known rhythm mismatch between the two families.
  - **Manipuri in Meitei Mayek** (traditional script, increasingly used officially). Requires bundling Noto Sans Meetei Mayek and a per-user script toggle if some users want Bengali instead.
  Decide *before* translation work begins — the choice affects which strings can be reused vs. retranslated.
- **Mizo script:** confirmed Latin with diacritics (â, ê, î, ô, û) — covered by Plex, no extra font needed.
- **Translator workflow:** identify native speakers, decide between a hosted TMS (Crowdin, Lokalise) or a flat-file PR workflow.
- **Domain glossary:** cooking, household, money terms. Get this right *before* bulk translation — fixing terminology drift afterwards is painful.
- **String extraction baseline** from English UI (slice C's tooling).
- **QA / review process** — review by a second native speaker before merge.

---

## Smaller deferred items (not slices, but spec-worthy when revisited)

### Dark mode

The existing `.dark` block in `globals.css` will be **removed** by slice A (it was half-broken). When dark mode is prioritized:
- Define dark equivalents for every token in the spec (`--surface-0-dark`, etc.).
- Re-run the contrast registry against the dark pairs.
- Decide `auto` (system preference) vs user toggle.
- Confirm primitives still meet visual hierarchy in dark (cards on dark surfaces need a different border treatment).

### Page-level redesign (slice "c" of refactor depth)

Slice A audits primitives only. Page-level layout / hierarchy / density is untouched. Almost certainly absorbed into slice B (persona UX) — when redesigning pages from persona needs, the layout follows. If it doesn't, do it as its own pass.

### Icon system

Today: `lucide-react` is installed but no rules around variants / sizing / color usage. A future micro-spec should:
- Decide stroke weight (1.5 vs 2).
- Standard sizes (16 / 20 / 24).
- Color rules (always `currentColor`; never pass `color` prop).
- Whether to ship a curated subset to keep bundle size down.

### Motion / animation tokens

Slice A ships one rule: 150ms ease for hover, 200ms ease-out for entering, 120ms ease-in for exiting. A real motion system (page transitions, microinteractions, gestural feedback) is its own ~half-day spec when needed.

### Storybook (or alternative)

Decided against in slice A in favor of colocated `*.examples.tsx` + `/dev/primitives` dev page. Revisit if the primitive count grows past ~25 or design-handoff to a non-engineer becomes a workflow.

### Touch-target tier upgrade

Slice A is Tier 1 (44px). If maid-persona feedback during B indicates the floor is too tight on real-world devices, consider Tier 2 (48px) — would require auditing button heights but tokens are designed to make this a single-number change.

### RTL / bidirectional text

No app strings are RTL today, but Urdu (and Arabic-script Urdu) could be a future locale. Primitives currently use `left`/`right` rather than `start`/`end`. Switching to logical properties (`padding-inline-start`, etc.) is a mechanical refactor — small spec when first RTL locale is committed to.

### Avatar image uploads

`Avatar` ships with initials-only in slice A. The image variant exists in the API but no upload flow. Likely picked up alongside profile editing.
