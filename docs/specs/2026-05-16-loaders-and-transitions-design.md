# Loaders and transitions

> **Superseded as living documentation by [`features/dashboard.md`](features/dashboard.md).** This dated spec is retained for historical context.

Date: 2026-05-16

## Problem

The app currently offers no perceived-performance feedback during route
navigation or server-action submissions. When the user taps a nav link in
[`MainNav`](../../src/components/site/main-nav.tsx) the previous page sits
fully rendered until the new RSC payload streams in, and when they tap an
action button (slot pick, "+ add" on shopping, save in inventory, etc.) the
button gives no visible signal that anything is happening. The user
literally reported "no loaders when I switch menu or take any action".

The fix is two coarse strokes:

1. Per-route `loading.tsx` skeletons that match each page's actual shell, so
   navigation feels instant.
2. A `PendingButton` wrapper that shows a small spinner + disables while a
   `useTransition` is pending or while a parent `<form action={...}>` is
   submitting (via `useFormStatus`). Apply selectively to the
   highest-traffic action surfaces.

## Scope

In scope:

- One `loading.tsx` per top-level navigated route: `/dashboard`, `/plan`,
  `/recipes`, `/shopping`, `/inventory`, `/bills`, `/tasks`, and
  `/household/settings`. Each skeleton renders `MainNav` (with the correct
  `active` slot) plus a layout-matching pulse for the page body.
- New component `src/components/ui/pending-button.tsx`. Same prop surface as
  the existing `Button`. Adds an internal spinner; auto-disables when (a)
  the parent form is submitting (`useFormStatus().pending`) or (b) a
  caller-supplied `pending` prop is true (for `useTransition` callers).
- Swap to `PendingButton` on the following action surfaces:
  - Meal-plan slot pick + regenerate + clear ([slot-action-sheet.tsx](../../src/components/plan/slot-action-sheet.tsx))
  - Recipe-picker per-recipe pick button ([recipe-picker.tsx](../../src/components/plan/recipe-picker.tsx))
  - Shopping QuickAdd "+" + dropdown actions ([quick-add.tsx](../../src/components/shopping/quick-add.tsx))
  - Bill upload submit ([upload-form.tsx](../../src/components/bills/upload-form.tsx))
  - Recipe form submit ([recipe-form.tsx](../../src/components/recipes/recipe-form.tsx))
  - Inventory adjust Add/Subtract ([adjust-form.tsx](../../src/components/inventory/adjust-form.tsx))
  - Inventory onboarding "Save inventory" + single-item Save
    ([inventory new page](../../src/app/inventory/new/page.tsx),
    [\_onboarding-form.tsx](../../src/app/inventory/new/_onboarding-form.tsx))
  - Household settings Save / Update / Remove buttons
    ([household settings page](../../src/app/household/settings/page.tsx))

Out of scope (deferred):

- View Transitions API. Cross-page morph animations are not in v1.
- Page-data prefetching changes. Next.js 16 prefetches `loading.tsx` itself
  on link hover by default — we rely on that without configuration.
- Route-segment `error.tsx` boundaries. Existing throws remain unchanged.
- Swapping every button. Low-traffic surfaces (filter buttons, "× remove"
  ghost icons, the recipe-form +Add row/step buttons that mutate local
  state only) keep the plain `Button`.
- Skeleton shimmer animations beyond `animate-pulse` — no gradient sweep,
  no staggered timings.
- Re-architecting any component. PendingButton is a wrapper; we don't
  change action signatures.
- Adding tests. The existing suite must stay green; no new tests required.
- Replacing shadcn / Base UI primitives.

## Changes

### `PendingButton` (new)

File: [src/components/ui/pending-button.tsx](../../src/components/ui/pending-button.tsx)

```tsx
"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ButtonProps = React.ComponentProps<typeof Button>;

export type PendingButtonProps = ButtonProps & {
  /** External pending signal (e.g. from useTransition). OR'd with form status. */
  pending?: boolean;
  /** Optional label shown next to the spinner while pending. Defaults to children. */
  pendingLabel?: React.ReactNode;
};

export function PendingButton({
  pending: pendingProp,
  pendingLabel,
  disabled,
  children,
  className,
  ...rest
}: PendingButtonProps) {
  const status = useFormStatus();
  const pending = pendingProp || status.pending;
  return (
    <Button
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(className)}
    >
      {pending ? <Spinner /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="animate-spin"
      width={12}
      height={12}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}
```

Notes:

- `useFormStatus()` only reports pending when the button is rendered
  *inside* a `<form action={…}>` whose action is currently running. Outside
  a form (e.g. plain onClick + useTransition), `status.pending` is always
  `false`, so the caller-supplied `pending` prop drives the spinner.
- The Base-UI Button already styles the in-button SVG via the
  `[&_svg]:size-4` / `[&_svg:not([class*='size-'])]:size-4` selectors in
  `buttonVariants`. Our spinner is explicitly `size-3` via width/height
  attrs to stay subtle.
- `aria-busy` lets screen readers know the control is working.
- The component is a Client Component because `useFormStatus` and
  `useTransition` both require a client boundary.

### `loading.tsx` per route (new)

One file per route. Each renders `MainNav` (correct `active`) plus pulsing
blocks shaped like the real page — never a generic spinner full-screen.

Targets and skeleton shape:

| Route                  | File                                                   | Shape                                                       |
|------------------------|--------------------------------------------------------|-------------------------------------------------------------|
| `/dashboard`           | `src/app/dashboard/loading.tsx`                        | Header h1 block, sub-text block, one card block.            |
| `/plan`                | `src/app/plan/loading.tsx`                             | Header block, 4 slot-row blocks, week strip block.          |
| `/recipes`             | `src/app/recipes/loading.tsx`                          | Header + Add button block, search row block, 4 card blocks. |
| `/shopping`            | `src/app/shopping/loading.tsx`                         | Header block, quick-add block, 6 row blocks.                |
| `/inventory`           | `src/app/inventory/loading.tsx`                        | Header + Add button block, 6 item-card blocks.              |
| `/bills`               | `src/app/bills/loading.tsx`                            | Header + New button block, 3 bill-card blocks.              |
| `/tasks`               | `src/app/tasks/loading.tsx`                            | Header + New button block, "Today" heading + 3 row blocks, "Upcoming" heading + 3 row blocks. |
| `/household/settings`  | `src/app/household/settings/loading.tsx`               | Header + sub-text block, Members card with 2 row blocks, Invites card with 2 row blocks. |

The shared idiom in each block:

```tsx
<div className="h-4 w-32 rounded bg-muted animate-pulse" />
```

No new shared `Skeleton` component is introduced — duplication is cheap and
keeps each loading.tsx readable.

### Button swaps

For each of the surfaces listed under Scope, replace `<Button …>` with
`<PendingButton …>` and remove the manual `disabled={pending}` where the
PendingButton's internal pending logic now covers it. The local `pending`
from `useTransition` is forwarded via `pending={pending}` so the spinner
appears.

Forms with server-action submit (`<form action={serverAction}>`) get
`<PendingButton type="submit">…</PendingButton>` with **no** `pending`
prop — `useFormStatus` handles it.

## Data flow

```
Click <Link href="/plan">
       │
       ▼
Next.js navigates ─► loading.tsx renders MainNav skeleton ─► RSC streams in ─► page swaps
```

```
Click <PendingButton onClick={start(...)}>
       │ pending=true via useTransition
       ▼
Spinner + disabled until server action resolves
       │
       ▼
Local state updates; pending=false; spinner gone
```

## Validation

- `npm run typecheck` clean.
- `npm run lint -- src/components/ui src/app` no new errors. (Existing
  recipes `no-explicit-any` warnings stay as-is.)
- `npm run build` succeeds.
- Manual: `npm run dev`, `curl -sI http://localhost:3000/plan` returns 307
  (auth redirect; confirms the route + its loading.tsx compile).

## Risks / open questions

- **`useFormStatus` race.** If a parent form submits and the user is also
  inside a `useTransition`, both signals OR — we show the spinner once. No
  flicker. The Button's `disabled` state subsumes both.
- **Server-action forms that redirect.** `useFormStatus` will report
  pending until the redirect navigation begins; `loading.tsx` then takes
  over. Two distinct loaders chained — that's the desired UX.
- **Layout shift.** Adding the 12px spinner inside a button widens it by
  ~16px (icon + gap). On fixed-width buttons (e.g. icon-only) this would
  shift content. We do not apply PendingButton to icon-only buttons in v1.
- **Skeleton drift.** If a page's layout changes substantially the
  skeleton will visibly mismatch. Acceptable cost for now — each
  loading.tsx is ~30 lines.

## Testing

- `npm test`: existing suite must stay green.
- Manual: navigate between every top-nav route; confirm a skeleton flashes
  on the slow ones. Tap "+" on shopping with an empty input → button is
  disabled (existing behavior). Tap with a value → spinner shows.
- Manual: open `/plan/<today>`, tap a slot → action sheet, tap "Pick
  different", pick a recipe → spinner on the picked row.
