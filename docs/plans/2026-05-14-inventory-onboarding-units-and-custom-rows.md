# Inventory Onboarding: Per-Item Default Units + Custom Rows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the uniform `kg` default on the `/inventory/new?onboarding=1` form with sensible per-item defaults, and let users append arbitrary free-text custom rows in the same Save action.

**Architecture:** Extract a pure FormData parser so the parsing logic is unit-testable in isolation. Move `submitOnboarding` from an inline server action in the page into [src/app/inventory/actions.ts](../../src/app/inventory/actions.ts) as `createInventoryItemsBulk`. Replace the inline onboarding `<form>` with a small `"use client"` component that holds the custom-rows state. Starter-items list (name + default unit) becomes a shared exported constant in `actions.ts`.

**Tech Stack:** Next.js 16 (App Router, React 19), TypeScript, Tailwind, Supabase, vitest, pnpm.

**Spec:** [docs/specs/2026-05-14-inventory-onboarding-units-and-custom-rows-design.md](../specs/2026-05-14-inventory-onboarding-units-and-custom-rows-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| [src/app/inventory/_onboarding-parse.ts](../../src/app/inventory/_onboarding-parse.ts) | Create | Pure `parseOnboardingFormData(formData, starterNames)` helper. No React, no DB, no auth — exists so parsing is unit-testable. |
| [tests/unit/inventory-onboarding-parse.test.ts](../../tests/unit/inventory-onboarding-parse.test.ts) | Create | Vitest tests for the parser. Covers starter rows, custom rows, validation skip-rules, and sparse indices. |
| [src/app/inventory/actions.ts](../../src/app/inventory/actions.ts) | Modify | Add `STARTER_ITEMS` exported constant and `createInventoryItemsBulk` server action. Existing actions unchanged. |
| [src/app/inventory/new/_onboarding-form.tsx](../../src/app/inventory/new/_onboarding-form.tsx) | Create | `"use client"` component. Renders starter rows from prop, holds custom-row React state, submits via `createInventoryItemsBulk`. |
| [src/app/inventory/new/page.tsx](../../src/app/inventory/new/page.tsx) | Modify | Drop inline `STARTER_ITEMS`, drop inline `submitOnboarding`, drop the inline onboarding `<form>`. Render `<OnboardingInventoryForm>` instead. Single-item path untouched. |

Why two new files instead of inlining into `page.tsx`:
- Parser must be pure (no `"use server"`/`"server-only"` directives) so vitest can import it.
- The client form needs `"use client"` while the page stays a server component for auth/role gating.

---

## Task 1: Parser tests (TDD red phase)

**Files:**
- Create: [tests/unit/inventory-onboarding-parse.test.ts](../../tests/unit/inventory-onboarding-parse.test.ts)

- [ ] **Step 1: Confirm the tests directory exists**

Run: `ls tests/unit 2>/dev/null || mkdir tests/unit`
Expected: either lists nothing (dir exists empty) or creates the dir silently.

- [ ] **Step 2: Write the failing test file**

```ts
// tests/unit/inventory-onboarding-parse.test.ts
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
```

- [ ] **Step 3: Run the test, confirm it fails because the parser module doesn't exist**

Run: `pnpm test tests/unit/inventory-onboarding-parse.test.ts`
Expected: FAIL — error message will say `Cannot find module '@/app/inventory/_onboarding-parse'` or `Failed to resolve import`.

- [ ] **Step 4: Commit the failing test**

```bash
git add tests/unit/inventory-onboarding-parse.test.ts
git commit -m "test(inventory): failing tests for onboarding FormData parser

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Implement the parser (TDD green phase)

**Files:**
- Create: [src/app/inventory/_onboarding-parse.ts](../../src/app/inventory/_onboarding-parse.ts)

- [ ] **Step 1: Write the parser**

```ts
// src/app/inventory/_onboarding-parse.ts
export type OnboardingRow = {
  name: string;
  quantity: number;
  unit: string;
};

const CUSTOM_NAME_RE = /^custom_name_(\d+)$/;

function asNonEmptyString(v: FormDataEntryValue | null): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function parseOnboardingFormData(
  formData: FormData,
  starterNames: readonly string[],
): OnboardingRow[] {
  const out: OnboardingRow[] = [];

  for (const name of starterNames) {
    const qtyRaw = formData.get(`qty_${name}`);
    const unitRaw = formData.get(`unit_${name}`);
    const unit = asNonEmptyString(unitRaw);
    if (qtyRaw == null || unit == null) continue;
    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    out.push({ name, quantity: qty, unit });
  }

  const customIndices: number[] = [];
  for (const key of formData.keys()) {
    const m = CUSTOM_NAME_RE.exec(key);
    if (m) customIndices.push(Number(m[1]));
  }
  customIndices.sort((a, b) => a - b);

  for (const i of customIndices) {
    const nameRaw = formData.get(`custom_name_${i}`);
    const qtyRaw = formData.get(`custom_qty_${i}`);
    const unitRaw = formData.get(`custom_unit_${i}`);
    const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
    const unit = asNonEmptyString(unitRaw);
    if (name.length === 0 || unit == null || qtyRaw == null) continue;
    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    out.push({ name, quantity: qty, unit });
  }

  return out;
}
```

- [ ] **Step 2: Run the test, confirm all cases pass**

Run: `pnpm test tests/unit/inventory-onboarding-parse.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/inventory/_onboarding-parse.ts
git commit -m "feat(inventory): pure parser for onboarding FormData

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Shared starter-items constant + bulk server action

**Files:**
- Modify: [src/app/inventory/actions.ts](../../src/app/inventory/actions.ts) (currently 120 lines, top of file)

- [ ] **Step 1: Read the current actions.ts header**

Run: `sed -n '1,10p' src/app/inventory/actions.ts`
Expected: shows the `"use server"` directive and existing imports.

- [ ] **Step 2: Add imports and the `STARTER_ITEMS` constant**

Edit [src/app/inventory/actions.ts](../../src/app/inventory/actions.ts): below the existing `import { requireHousehold } from "@/lib/auth/require";` line (line 6), add:

```ts
import { redirect } from "next/navigation";
import { parseOnboardingFormData } from "@/app/inventory/_onboarding-parse";

export const STARTER_ITEMS = [
  { name: "basmati rice",       defaultUnit: "kg" },
  { name: "toor dal",           defaultUnit: "kg" },
  { name: "urad dal",           defaultUnit: "kg" },
  { name: "whole wheat flour",  defaultUnit: "kg" },
  { name: "cooking oil",        defaultUnit: "l" },
  { name: "ghee",               defaultUnit: "g" },
  { name: "salt",               defaultUnit: "kg" },
  { name: "sugar",              defaultUnit: "kg" },
  { name: "milk",               defaultUnit: "l" },
  { name: "eggs",               defaultUnit: "piece" },
  { name: "onion",              defaultUnit: "kg" },
  { name: "tomato",             defaultUnit: "kg" },
  { name: "ginger",             defaultUnit: "g" },
  { name: "garlic",             defaultUnit: "g" },
  { name: "turmeric powder",    defaultUnit: "g" },
] as const satisfies ReadonlyArray<{ name: string; defaultUnit: string }>;
```

- [ ] **Step 3: Add the `createInventoryItemsBulk` server action**

Append at the end of [src/app/inventory/actions.ts](../../src/app/inventory/actions.ts):

```ts
export async function createInventoryItemsBulk(formData: FormData): Promise<void> {
  await requireHousehold();
  const rows = parseOnboardingFormData(
    formData,
    STARTER_ITEMS.map((i) => i.name),
  );
  for (const row of rows) {
    await createInventoryItem({
      item_name: row.name,
      quantity: row.quantity,
      unit: row.unit,
    });
  }
  redirect("/dashboard");
}
```

Notes for the implementer:
- `redirect()` throws internally — Next.js intercepts that throw. Don't wrap the loop in try/catch around it.
- `createInventoryItem` already does its own auth check via `requireHousehold`; the outer call is fine.
- Per-row failures are silently dropped, matching today's silent-skip posture on `q <= 0`.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 5: Run all vitest tests to confirm nothing regressed**

Run: `pnpm test`
Expected: PASS. The parser tests pass; existing db tests still pass (if a local Supabase is running) or are skipped (if not).

- [ ] **Step 6: Commit**

```bash
git add src/app/inventory/actions.ts
git commit -m "feat(inventory): STARTER_ITEMS constant + createInventoryItemsBulk action

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Onboarding form client component

**Files:**
- Create: [src/app/inventory/new/_onboarding-form.tsx](../../src/app/inventory/new/_onboarding-form.tsx)

- [ ] **Step 1: Write the client component**

```tsx
// src/app/inventory/new/_onboarding-form.tsx
"use client";

import { useId, useRef, useState } from "react";
import { createInventoryItemsBulk, STARTER_ITEMS } from "@/app/inventory/actions";
import { Button } from "@/components/ui/button";

const UNIT_OPTIONS = ["kg", "g", "l", "ml", "piece"] as const;

type CustomRow = { id: number };

export function OnboardingInventoryForm() {
  const [customRows, setCustomRows] = useState<CustomRow[]>([]);
  const nextIdRef = useRef(0);

  function addRow() {
    setCustomRows((rows) => [...rows, { id: nextIdRef.current++ }]);
  }

  function removeRow(id: number) {
    setCustomRows((rows) => rows.filter((r) => r.id !== id));
  }

  return (
    <form action={createInventoryItemsBulk} className="flex flex-col gap-3 px-4 py-2">
      {STARTER_ITEMS.map((item) => (
        <div key={item.name} className="grid grid-cols-[1fr_80px_80px] items-center gap-2">
          <label htmlFor={`qty_${item.name}`} className="text-sm">
            {item.name}
          </label>
          <input
            id={`qty_${item.name}`}
            name={`qty_${item.name}`}
            type="number"
            min="0"
            step="0.01"
            className="rounded border px-2 py-1 text-sm"
            placeholder="0"
          />
          <select
            name={`unit_${item.name}`}
            className="rounded border px-2 py-1 text-sm"
            defaultValue={item.defaultUnit}
          >
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      ))}

      {customRows.map((row, i) => (
        <CustomRowFields key={row.id} index={i} onRemove={() => removeRow(row.id)} />
      ))}

      <button
        type="button"
        onClick={addRow}
        className="self-start rounded border border-dashed px-3 py-1 text-sm text-muted-foreground hover:bg-muted"
      >
        + Add another item
      </button>

      <Button type="submit" className="mt-3">
        Save inventory
      </Button>
    </form>
  );
}

function CustomRowFields({
  index,
  onRemove,
}: {
  index: number;
  onRemove: () => void;
}) {
  const nameId = useId();
  return (
    <div className="grid grid-cols-[1fr_80px_80px_24px] items-center gap-2">
      <input
        id={nameId}
        name={`custom_name_${index}`}
        type="text"
        maxLength={120}
        placeholder="item name"
        className="rounded border px-2 py-1 text-sm"
      />
      <input
        name={`custom_qty_${index}`}
        type="number"
        min="0"
        step="0.01"
        className="rounded border px-2 py-1 text-sm"
        placeholder="0"
      />
      <select
        name={`custom_unit_${index}`}
        className="rounded border px-2 py-1 text-sm"
        defaultValue="kg"
      >
        {UNIT_OPTIONS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onRemove}
        aria-label="remove row"
        className="text-muted-foreground hover:text-foreground"
      >
        ×
      </button>
    </div>
  );
}
```

Notes:
- The 5-unit option list (`UNIT_OPTIONS`) matches what was inline today.
- `defaultValue` (not `value`) lets the user change the dropdown without React state.
- The `index` used in the FormData keys is the array index at render time; React's `key={row.id}` keeps the inputs stable across reorders, but the names re-key on each render. That's fine — the server scans for `custom_name_*` and doesn't require contiguity.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/inventory/new/_onboarding-form.tsx
git commit -m "feat(inventory): onboarding form client component with custom rows

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire the client component into the page

**Files:**
- Modify: [src/app/inventory/new/page.tsx](../../src/app/inventory/new/page.tsx) (replace the inline onboarding form and its inline server action)

- [ ] **Step 1: Replace the page's contents**

The full new file (overwrites the existing 123-line page):

```tsx
// src/app/inventory/new/page.tsx
import { redirect } from "next/navigation";
import { requireHousehold } from "@/lib/auth/require";
import { createInventoryItem } from "@/app/inventory/actions";
import { MainNav } from "@/components/site/main-nav";
import { Button } from "@/components/ui/button";
import { OnboardingInventoryForm } from "./_onboarding-form";

export default async function NewInventoryItemPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarding?: string }>;
}) {
  const ctx = await requireHousehold();
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "maid") {
    redirect("/inventory");
  }
  const sp = await searchParams;
  const isOnboarding = sp.onboarding === "1";

  async function submitSingle(formData: FormData) {
    "use server";
    const name = String(formData.get("item_name") ?? "").trim();
    const quantity = Number(formData.get("quantity") ?? 0);
    const unit = String(formData.get("unit") ?? "").trim();
    if (!name || !unit || quantity < 0) return;
    await createInventoryItem({ item_name: name, quantity, unit });
    redirect("/inventory");
  }

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="inventory" />
      <header className="px-4 py-3">
        <h1 className="text-lg font-semibold">
          {isOnboarding ? "Set up your inventory" : "Add an item"}
        </h1>
        {isOnboarding && (
          <p className="mt-1 text-sm text-muted-foreground">
            Fill in any quantities you have on hand. Skip items you don&apos;t track.
          </p>
        )}
      </header>

      {isOnboarding ? (
        <OnboardingInventoryForm />
      ) : (
        <form action={submitSingle} className="flex flex-col gap-3 px-4 py-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm">Name</span>
            <input
              name="item_name"
              required
              maxLength={120}
              className="rounded border px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm">Quantity</span>
            <input
              name="quantity"
              type="number"
              min="0"
              step="0.01"
              required
              className="rounded border px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm">Unit</span>
            <input
              name="unit"
              required
              maxLength={24}
              className="rounded border px-2 py-1 text-sm"
              placeholder="e.g. kg, g, l, ml, piece"
            />
          </label>
          <Button type="submit">Save</Button>
        </form>
      )}
    </main>
  );
}
```

What changed:
- Removed the inline `STARTER_ITEMS` constant (now in `actions.ts`).
- Removed the inline `submitOnboarding` server action (now `createInventoryItemsBulk` in `actions.ts`).
- Removed the inline onboarding `<form>` (replaced by `<OnboardingInventoryForm />`).
- Added the import of the new client component.
- `submitSingle`, non-onboarding form, auth check, header, role gate are all unchanged.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/inventory/new/page.tsx
git commit -m "feat(inventory): use OnboardingInventoryForm with per-item unit defaults

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Verification

- [ ] **Step 1: Full typecheck + lint + vitest**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all three exit 0. (Test suite: parser tests pass; if local Supabase is running, db tests also pass — they may skip otherwise. Either way, no failures.)

- [ ] **Step 2: Existing e2e smoke**

Run: `pnpm test:e2e tests/e2e/inventory.spec.ts`
Expected: all 4 unauthenticated-redirect tests pass. (Skip if a local dev server isn't ready and the user is OK with that.)

- [ ] **Step 3: Manual UI verification**

Run: `pnpm dev` (in another terminal if needed), open the URL printed to console, sign in as an owner of a household with no inventory items, visit `/inventory/new?onboarding=1`. Confirm:

- `cooking oil` and `milk` rows show `l` selected.
- `eggs` row shows `piece` selected.
- `ghee`, `ginger`, `garlic`, `turmeric powder` rows show `g` selected.
- All other starter rows show `kg` selected.
- Clicking `+ Add another item` adds a row with name/qty/unit/× controls.
- Filling a custom row (name=`paneer`, qty=`0.25`, unit=`kg`) and clicking Save redirects to `/dashboard`.
- Visiting `/inventory` shows `paneer` (0.25 kg).
- Clicking `×` on a custom row before Save removes that row.

If any of these fail, do NOT mark complete. Diagnose and fix.

- [ ] **Step 4: Stop the dev server and commit nothing**

No commit on this task — it's verification only.

---

## Self-Review Notes (filled during plan authoring)

- **Spec §3 (defaults per starter item):** Implemented in Task 3 Step 2 (the `STARTER_ITEMS` constant lists each item with its default unit) and consumed in Task 4 (the `<select defaultValue={item.defaultUnit}>` line).
- **Spec §4.1 (page.tsx changes):** Task 5 replaces the page; the single-item path is preserved verbatim.
- **Spec §4.2 (actions.ts bulk action):** Task 3.
- **Spec §4.3 (client component):** Task 4.
- **Spec §4.4 (parser helper):** Tasks 1–2.
- **Spec §5 (tests):** Parser unit tests in Task 1, manual verification in Task 6, existing e2e smoke in Task 6 Step 2.
- **Spec §6 (out of scope):** Honored — no autocomplete, no reorder, no persistence, no bulk import.
- **Type consistency:** `OnboardingRow` defined in `_onboarding-parse.ts` and consumed via the iterator in `createInventoryItemsBulk`. `STARTER_ITEMS` defined in `actions.ts` and consumed in `_onboarding-form.tsx`. Unit option list is hard-coded `UNIT_OPTIONS` in the client component (matches the 5 inline `<option>`s the old code had).
- **No placeholders:** all code blocks are complete and runnable.
