<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

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
