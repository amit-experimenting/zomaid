# Slice 2b — Shopping List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement slice 2b end-to-end: a standing per-household shopping list with manual + auto-pull-from-plans items, owner+maid-edit / family-read-only RLS, mark-bought-with-history, and a `/shopping` route with a new 3-link header nav.

**Architecture:** One new table (`shopping_list_items`) alongside slice 2a tables, with the same RLS pattern (`has_active_membership` / `is_active_owner_or_maid`). One Postgres function (`shopping_auto_add_from_plans`) aggregates next-7-days plan ingredients into the list with case-insensitive name+unit dedupe. Six server actions wrap the table + function with Zod validation. UI: one new page (`/shopping`), five small components, plus a shared 3-link header nav inserted into `/plan/[date]`, `/recipes`, and `/shopping`.

**Tech Stack:** Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 · `@base-ui/react` · Supabase (`@supabase/ssr`, `@supabase/supabase-js` v2) · Postgres 17 · Zod · Vitest + `pg` (DB/integration tests) · Playwright (E2E) · pnpm.

**Spec reference:** [`docs/specs/2026-05-11-slice-2b-shopping-list-design.md`](../specs/2026-05-11-slice-2b-shopping-list-design.md) (commit `76d81e1`).

**Depends on:** Slice 2a (recipes + meal plan + suggestion engine). All 9 slice 2a migrations are applied locally; the local DB schema is at `20260525_001_starter_pack_seed.sql`. Next migration starts at `20260526_001`.

---

## Pre-flight

- [ ] **A. Confirm slice 2a migrations are present.** Run `psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "\dt public.*"`. Expected: tables include `recipes`, `recipe_ingredients`, `recipe_steps`, `household_recipe_hides`, `meal_plans` alongside the foundations tables. If any missing, run `pnpm db:reset` to apply.

- [ ] **B. Confirm helpers exist.** Run `psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "\df public.is_active_owner_or_maid; \df public.current_household_id_for_caller; \df public.current_profile_id;"`. Expected: 3 functions printed (the slice 2a helpers we reuse). If missing, `pnpm db:reset` to apply.

- [ ] **C. Foundations verification still green.** Run `pnpm typecheck && pnpm test tests/db`. Expected: typecheck clean; 18 DB tests pass.

If A–C are green, start Task 1.

---

## File-structure recap

```
supabase/migrations/
  20260526_001_shopping_list_items.sql   (Task 1)
  20260527_001_shopping_auto_add_fn.sql  (Task 2)

src/lib/db/types.ts                       (extended in Task 3)

src/app/shopping/actions.ts               (Task 4)

src/components/shopping/
  item-row.tsx                            (Task 5)
  quick-add.tsx                           (Task 5)
  edit-item-sheet.tsx                     (Task 5)
  auto-add-button.tsx                     (Task 5)
  bought-history.tsx                      (Task 5)

src/components/site/main-nav.tsx          (Task 6)

src/app/shopping/page.tsx                 (Task 6)
src/app/plan/[date]/page.tsx              (modified in Task 6 — insert MainNav)
src/app/recipes/page.tsx                  (modified in Task 6 — insert MainNav)

tests/e2e/shopping.spec.ts                (Task 7)

docs/HANDOFF.md                           (modified in Task 8)
```

> **Note on test tasks.** The user has indicated tests are deferred. The plan still describes test coverage; at execution time, test-writing steps may be skipped task-by-task. Implementation steps stand on their own — do not skip the implementation steps just because you skipped the test.

---

## Task 1: Migration — `shopping_list_items` table + RLS + indexes

**Files:**

- Create: `supabase/migrations/20260526_001_shopping_list_items.sql`
- (Tests deferred) Skipped: `tests/factories.ts` extension, `tests/db/shopping-list-items.test.ts`.

- [ ] **Step 1: Write the migration**

  Create `supabase/migrations/20260526_001_shopping_list_items.sql`:

  ```sql
  -- Slice 2b — Shopping list (standing list per household, manual + auto-pulled).
  -- See docs/specs/2026-05-11-slice-2b-shopping-list-design.md §4.

  create table public.shopping_list_items (
    id                     uuid primary key default gen_random_uuid(),
    household_id           uuid not null references public.households(id) on delete cascade,
    item_name              text not null check (length(item_name) between 1 and 120),
    quantity               numeric check (quantity is null or quantity > 0),
    unit                   text check (unit is null or length(unit) between 1 and 24),
    notes                  text check (notes is null or length(notes) <= 500),
    bought_at              timestamptz,
    bought_by_profile_id   uuid references public.profiles(id) on delete set null,
    created_by_profile_id  uuid not null references public.profiles(id) on delete set null,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    -- "bought_by may only be set if bought_at is set"
    constraint sli_bought_consistency check (
      (bought_at is null  and bought_by_profile_id is null)
      or
      (bought_at is not null)
    )
  );

  -- Foundations migrations (20260516) defined created_by_profile_id as NOT NULL on
  -- audit-bearing tables. Same here. We accept ON DELETE SET NULL despite the NOT
  -- NULL constraint by relying on the FK's behaviour: if the profile is deleted,
  -- Postgres needs to coerce the column to NULL, but the NOT NULL would reject it.
  -- To match foundations' pattern: drop NOT NULL on created_by so the SET NULL works
  -- when a profile is hard-deleted. The application always supplies a non-null
  -- value on insert, so this is purely an integrity-vs-history trade-off.
  alter table public.shopping_list_items
    alter column created_by_profile_id drop not null;

  create index sli_household_unbought_idx
    on public.shopping_list_items (household_id, created_at desc)
    where bought_at is null;

  create index sli_household_bought_idx
    on public.shopping_list_items (household_id, bought_at desc)
    where bought_at is not null;

  create trigger sli_touch_updated_at
    before update on public.shopping_list_items
    for each row execute function public.touch_updated_at();

  alter table public.shopping_list_items enable row level security;

  create policy sli_read on public.shopping_list_items
    for select to authenticated
    using (public.has_active_membership(household_id));

  create policy sli_insert on public.shopping_list_items
    for insert to authenticated
    with check (public.is_active_owner_or_maid(household_id));

  create policy sli_update on public.shopping_list_items
    for update to authenticated
    using (public.is_active_owner_or_maid(household_id))
    with check (public.is_active_owner_or_maid(household_id));

  create policy sli_delete on public.shopping_list_items
    for delete to authenticated
    using (public.is_active_owner_or_maid(household_id));
  ```

- [ ] **Step 2: Apply the migration**

  Run:

  ```bash
  pnpm db:reset
  ```

  Expected: prints applied migration filenames including `20260526_001_shopping_list_items.sql`. On error, fix the SQL from the message and retry.

- [ ] **Step 3: Verify the table exists**

  Run:

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "\d public.shopping_list_items"
  ```

  Expected: the table is listed with all columns, the partial indexes, the CHECK constraint, and RLS enabled.

- [ ] **Step 4: Run existing tests to make sure nothing regressed**

  ```bash
  pnpm typecheck && pnpm test tests/db
  ```

  Expected: typecheck clean, 18 foundations DB tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/20260526_001_shopping_list_items.sql
  git commit -m "$(cat <<'EOF'
  Add shopping_list_items table + owner/maid-write RLS

  Standing per-household shopping list. Partial indexes split the two access
  patterns (unbought first, bought history). CHECK constraint enforces that
  bought_by_profile_id can only be set when bought_at is set.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 2: Migration — `shopping_auto_add_from_plans()` function

**Files:**

- Create: `supabase/migrations/20260527_001_shopping_auto_add_fn.sql`

- [ ] **Step 1: Write the migration**

  Create `supabase/migrations/20260527_001_shopping_auto_add_fn.sql`:

  ```sql
  -- Slice 2b — Aggregate next 7 days of plan ingredients into the shopping list.
  -- Case-insensitive dedupe on (item_name, unit). Sums quantities for matching
  -- pairs; if any contributing ingredient has NULL quantity, the inserted row
  -- has NULL quantity. Skips pairs already unbought in the list.

  create or replace function public.shopping_auto_add_from_plans()
    returns setof public.shopping_list_items
    language plpgsql security invoker
    set search_path = public
    as $$
    declare
      v_household uuid := public.current_household_id_for_caller();
      v_profile   uuid := public.current_profile_id();
    begin
      if v_household is null then
        raise exception 'no active household' using errcode = 'P0001';
      end if;

      return query
      with candidates as (
        select
          lower(ri.item_name)                                      as key_name,
          ri.unit                                                  as unit,
          min(ri.item_name)                                        as display_name,
          bool_or(ri.quantity is null)                             as has_null_qty,
          sum(ri.quantity) filter (where ri.quantity is not null)  as qty_sum
        from public.meal_plans mp
        join public.recipe_ingredients ri on ri.recipe_id = mp.recipe_id
        where mp.household_id = v_household
          and mp.plan_date between current_date and current_date + 6
          and mp.recipe_id is not null
        group by lower(ri.item_name), ri.unit
      ),
      to_insert as (
        select c.*
        from candidates c
        where not exists (
          select 1 from public.shopping_list_items s
          where s.household_id = v_household
            and s.bought_at is null
            and lower(s.item_name) = c.key_name
            and coalesce(s.unit, '') = coalesce(c.unit, '')
        )
      )
      insert into public.shopping_list_items
        (household_id, item_name, quantity, unit, created_by_profile_id, bought_at)
      select
        v_household,
        t.display_name,
        case when t.has_null_qty then null else t.qty_sum end,
        t.unit,
        v_profile,
        null
      from to_insert t
      returning *;
    end;
    $$;

  revoke execute on function public.shopping_auto_add_from_plans() from public;
  grant  execute on function public.shopping_auto_add_from_plans() to authenticated;
  ```

- [ ] **Step 2: Apply**

  ```bash
  pnpm db:reset
  ```

  Expected: applies cleanly.

- [ ] **Step 3: Smoke-check the function exists**

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "\df public.shopping_auto_add_from_plans"
  ```

  Expected: 1 row.

- [ ] **Step 4: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/20260527_001_shopping_auto_add_fn.sql
  git commit -m "$(cat <<'EOF'
  Add shopping_auto_add_from_plans() RPC

  Aggregates next 7 days of meal plan ingredients into the shopping list with
  case-insensitive (item_name, unit) dedupe, sum-on-match, and skip-existing.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3: Extend `src/lib/db/types.ts` with slice 2b types

**Files:**

- Modify: `src/lib/db/types.ts`

- [ ] **Step 1: Read the existing file shape**

  ```bash
  grep -n "Tables\|Enums\|Functions" src/lib/db/types.ts | head -20
  ```

  Locate where slice 2a tables were added so the same pattern can be reused.

- [ ] **Step 2: Add the new table entry to `Database["public"]["Tables"]`**

  Insert this block in the Tables object (placement: alongside slice 2a tables; alphabetical or sequential is fine — match foundations' style):

  ```ts
  shopping_list_items: {
    Row: {
      id: string;
      household_id: string;
      item_name: string;
      quantity: number | null;
      unit: string | null;
      notes: string | null;
      bought_at: string | null;
      bought_by_profile_id: string | null;
      created_by_profile_id: string | null;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      household_id: string;
      item_name: string;
      quantity?: number | null;
      unit?: string | null;
      notes?: string | null;
      bought_at?: string | null;
      bought_by_profile_id?: string | null;
      created_by_profile_id?: string | null;
      created_at?: string;
      updated_at?: string;
    };
    Update: Partial<Database["public"]["Tables"]["shopping_list_items"]["Insert"]>;
    Relationships: [];
  };
  ```

- [ ] **Step 3: Add the function to `Database["public"]["Functions"]`**

  ```ts
  shopping_auto_add_from_plans: {
    Args: Record<string, never>;
    Returns: Database["public"]["Tables"]["shopping_list_items"]["Row"][];
  };
  ```

- [ ] **Step 4: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean. If errors, common causes are a missing trailing semicolon or a misplaced comma in the Tables object.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/db/types.ts
  git commit -m "$(cat <<'EOF'
  Extend Database types for shopping_list_items + auto-add RPC

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4: Server actions — `src/app/shopping/actions.ts`

**Files:**

- Create: `src/app/shopping/actions.ts`
- (Tests deferred) Skipped: `tests/actions/shopping-actions.test.ts`.

- [ ] **Step 1: Write the actions file**

  Create `src/app/shopping/actions.ts`:

  ```ts
  "use server";

  import { revalidatePath } from "next/cache";
  import { z } from "zod";
  import { createClient } from "@/lib/supabase/server";
  import { requireHousehold } from "@/lib/auth/require";

  export type ShoppingActionResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string> } };

  const NameSchema = z.string().trim().min(1).max(120);
  const QuantitySchema = z.number().positive().optional().nullable();
  const UnitSchema = z.string().trim().min(1).max(24).optional().nullable();
  const NotesSchema = z.string().max(500).optional().nullable();
  const ItemIdSchema = z.string().uuid();

  const AddInput = z.object({
    name: NameSchema,
    quantity: QuantitySchema,
    unit: UnitSchema,
    notes: NotesSchema,
  });

  export async function addShoppingItem(input: z.infer<typeof AddInput>): Promise<ShoppingActionResult<{ itemId: string }>> {
    const parsed = AddInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: { code: "SHOPPING_INVALID", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string> } };
    }
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("shopping_list_items")
      .insert({
        household_id: ctx.household.id,
        item_name: parsed.data.name,
        quantity: parsed.data.quantity ?? null,
        unit: parsed.data.unit ?? null,
        notes: parsed.data.notes ?? null,
        created_by_profile_id: ctx.profile.id,
      })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, error: { code: "SHOPPING_FORBIDDEN", message: error?.message ?? "Insert failed" } };
    }
    revalidatePath("/shopping");
    return { ok: true, data: { itemId: data.id } };
  }

  const UpdateInput = z.object({
    itemId: ItemIdSchema,
    name: NameSchema.optional(),
    quantity: QuantitySchema,
    unit: UnitSchema,
    notes: NotesSchema,
  });

  export async function updateShoppingItem(input: z.infer<typeof UpdateInput>): Promise<ShoppingActionResult<{ itemId: string }>> {
    const parsed = UpdateInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: { code: "SHOPPING_INVALID", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string> } };
    }
    await requireHousehold();
    const supabase = await createClient();

    // Check the row exists and is unbought (bought rows are history-read-only).
    const { data: existing, error: readErr } = await supabase
      .from("shopping_list_items")
      .select("id, bought_at")
      .eq("id", parsed.data.itemId)
      .maybeSingle();
    if (readErr) return { ok: false, error: { code: "SHOPPING_FORBIDDEN", message: readErr.message } };
    if (!existing) return { ok: false, error: { code: "SHOPPING_NOT_FOUND", message: "Item not found" } };
    if (existing.bought_at !== null) {
      return { ok: false, error: { code: "SHOPPING_ITEM_BOUGHT_IMMUTABLE", message: "Bought items can't be edited — undo first." } };
    }

    const patch: Database["public"]["Tables"]["shopping_list_items"]["Update"] = {};
    if (parsed.data.name !== undefined)     patch.item_name = parsed.data.name;
    if (parsed.data.quantity !== undefined) patch.quantity  = parsed.data.quantity ?? null;
    if (parsed.data.unit !== undefined)     patch.unit      = parsed.data.unit ?? null;
    if (parsed.data.notes !== undefined)    patch.notes     = parsed.data.notes ?? null;

    const { error } = await supabase
      .from("shopping_list_items")
      .update(patch)
      .eq("id", parsed.data.itemId);
    if (error) return { ok: false, error: { code: "SHOPPING_FORBIDDEN", message: error.message } };

    revalidatePath("/shopping");
    return { ok: true, data: { itemId: parsed.data.itemId } };
  }

  export async function markShoppingItemBought(input: { itemId: string }): Promise<ShoppingActionResult<{ itemId: string }>> {
    const parsed = z.object({ itemId: ItemIdSchema }).safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "SHOPPING_INVALID", message: "Invalid input" } };
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase
      .from("shopping_list_items")
      .update({ bought_at: new Date().toISOString(), bought_by_profile_id: ctx.profile.id })
      .eq("id", parsed.data.itemId)
      .is("bought_at", null);
    if (error) return { ok: false, error: { code: "SHOPPING_FORBIDDEN", message: error.message } };
    revalidatePath("/shopping");
    return { ok: true, data: { itemId: parsed.data.itemId } };
  }

  export async function unmarkShoppingItemBought(input: { itemId: string }): Promise<ShoppingActionResult<{ itemId: string }>> {
    const parsed = z.object({ itemId: ItemIdSchema }).safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "SHOPPING_INVALID", message: "Invalid input" } };
    await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase
      .from("shopping_list_items")
      .update({ bought_at: null, bought_by_profile_id: null })
      .eq("id", parsed.data.itemId);
    if (error) return { ok: false, error: { code: "SHOPPING_FORBIDDEN", message: error.message } };
    revalidatePath("/shopping");
    return { ok: true, data: { itemId: parsed.data.itemId } };
  }

  export async function deleteShoppingItem(input: { itemId: string }): Promise<ShoppingActionResult<{ itemId: string }>> {
    const parsed = z.object({ itemId: ItemIdSchema }).safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "SHOPPING_INVALID", message: "Invalid input" } };
    await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase
      .from("shopping_list_items")
      .delete()
      .eq("id", parsed.data.itemId);
    if (error) return { ok: false, error: { code: "SHOPPING_FORBIDDEN", message: error.message } };
    revalidatePath("/shopping");
    return { ok: true, data: { itemId: parsed.data.itemId } };
  }

  export async function autoAddFromPlans(): Promise<ShoppingActionResult<{ insertedCount: number; insertedNames: string[] }>> {
    await requireHousehold();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("shopping_auto_add_from_plans");
    if (error) return { ok: false, error: { code: "SHOPPING_FORBIDDEN", message: error.message } };
    const rows = data ?? [];
    revalidatePath("/shopping");
    return { ok: true, data: { insertedCount: rows.length, insertedNames: rows.map((r) => r.item_name) } };
  }

  // Type imported at the bottom to keep the Zod schemas at the top scannable.
  import type { Database } from "@/lib/db/types";
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean. If TS complains about `as Record<string, string>` on `fieldErrors`, change to `as unknown as Record<string, string>` (same idiom slice 2a used).

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/shopping/actions.ts
  git commit -m "$(cat <<'EOF'
  Add shopping list server actions

  Six actions: add/update/markBought/unmarkBought/delete + autoAddFromPlans
  (wraps the RPC). Bought rows are immutable to updates; delete still works
  so users can clean up history rows.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5: Shopping UI components

**Files:**

- Create: `src/components/shopping/item-row.tsx`
- Create: `src/components/shopping/quick-add.tsx`
- Create: `src/components/shopping/auto-add-button.tsx`
- Create: `src/components/shopping/edit-item-sheet.tsx`
- Create: `src/components/shopping/bought-history.tsx`

- [ ] **Step 1: Write `item-row.tsx`**

  ```tsx
  "use client";
  import { useTransition } from "react";
  import { cn } from "@/lib/utils";
  import { markShoppingItemBought, unmarkShoppingItemBought } from "@/app/shopping/actions";

  export type ItemRowProps = {
    itemId: string;
    name: string;
    quantity: number | null;
    unit: string | null;
    notes: string | null;
    bought: boolean;
    boughtAt: string | null;
    readOnly: boolean;
    onEdit?: () => void;
  };

  function metaLine(quantity: number | null, unit: string | null, notes: string | null, boughtAt: string | null): string {
    const parts: string[] = [];
    if (quantity !== null && unit) parts.push(`${quantity} ${unit}`);
    else if (quantity !== null)    parts.push(String(quantity));
    else if (unit)                 parts.push(unit);
    if (notes) parts.push(notes);
    if (boughtAt) parts.push(`bought ${new Date(boughtAt).toLocaleString("en-SG", { dateStyle: "short", timeStyle: "short" })}`);
    return parts.join(" · ");
  }

  export function ItemRow(p: ItemRowProps) {
    const [pending, start] = useTransition();
    const onToggle = () => {
      if (p.readOnly) return;
      start(async () => {
        if (p.bought) await unmarkShoppingItemBought({ itemId: p.itemId });
        else          await markShoppingItemBought({ itemId: p.itemId });
      });
    };
    return (
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          aria-label={p.bought ? "Mark unbought" : "Mark bought"}
          disabled={p.readOnly || pending}
          onClick={onToggle}
          className={cn(
            "size-5 shrink-0 rounded border-2 transition",
            p.bought ? "border-primary bg-primary" : "border-border bg-transparent",
            p.readOnly && "opacity-50",
          )}
        >
          {p.bought && (
            <svg viewBox="0 0 16 16" className="size-full text-primary-foreground"><path d="M4 8l3 3 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          )}
        </button>
        <button
          type="button"
          disabled={p.readOnly}
          onClick={() => p.onEdit?.()}
          className={cn("min-w-0 flex-1 text-left", p.readOnly && "cursor-default")}
        >
          <div className={cn("truncate font-medium", p.bought && "line-through text-muted-foreground")}>{p.name}</div>
          {metaLine(p.quantity, p.unit, p.notes, p.boughtAt) && (
            <div className="text-xs text-muted-foreground">{metaLine(p.quantity, p.unit, p.notes, p.boughtAt)}</div>
          )}
        </button>
      </div>
    );
  }
  ```

- [ ] **Step 2: Write `quick-add.tsx`**

  ```tsx
  "use client";
  import { useState, useTransition } from "react";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { addShoppingItem } from "@/app/shopping/actions";

  export function QuickAdd() {
    const [name, setName] = useState("");
    const [pending, start] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const submit = () => {
      const trimmed = name.trim();
      if (!trimmed) return;
      start(async () => {
        const res = await addShoppingItem({ name: trimmed });
        if (!res.ok) { setError(res.error.message); return; }
        setName("");
        setError(null);
      });
    };
    return (
      <div className="px-4 py-3 border-b border-border">
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Add an item…"
            maxLength={120}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
            disabled={pending}
          />
          <Button type="button" onClick={submit} disabled={pending || !name.trim()}>+</Button>
        </div>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
    );
  }
  ```

- [ ] **Step 3: Write `auto-add-button.tsx`**

  ```tsx
  "use client";
  import { useState, useTransition } from "react";
  import { Button } from "@/components/ui/button";
  import { autoAddFromPlans } from "@/app/shopping/actions";

  export function AutoAddButton() {
    const [pending, start] = useTransition();
    const [toast, setToast] = useState<string | null>(null);
    const onClick = () => {
      start(async () => {
        const res = await autoAddFromPlans();
        if (!res.ok) { setToast(res.error.message); return; }
        if (res.data.insertedCount === 0) {
          setToast("Nothing new to add from this week's plans.");
        } else {
          setToast(`Added ${res.data.insertedCount} item${res.data.insertedCount === 1 ? "" : "s"} from this week's plans.`);
        }
        setTimeout(() => setToast(null), 4000);
      });
    };
    return (
      <>
        <Button type="button" onClick={onClick} disabled={pending} size="sm">
          {pending ? "Pulling…" : "+ Auto-add 7d"}
        </Button>
        {toast && (
          <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-foreground px-3 py-2 text-sm text-background shadow">
            {toast}
          </div>
        )}
      </>
    );
  }
  ```

- [ ] **Step 4: Write `edit-item-sheet.tsx`**

  ```tsx
  "use client";
  import { useState, useTransition } from "react";
  import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { Textarea } from "@/components/ui/textarea";
  import { deleteShoppingItem, updateShoppingItem } from "@/app/shopping/actions";

  export type EditItemSheetProps = {
    itemId: string;
    initial: { name: string; quantity: number | null; unit: string | null; notes: string | null };
    open: boolean;
    onOpenChange: (open: boolean) => void;
  };

  export function EditItemSheet(p: EditItemSheetProps) {
    const [name, setName] = useState(p.initial.name);
    const [quantity, setQuantity] = useState<string>(p.initial.quantity?.toString() ?? "");
    const [unit, setUnit] = useState(p.initial.unit ?? "");
    const [notes, setNotes] = useState(p.initial.notes ?? "");
    const [error, setError] = useState<string | null>(null);
    const [pending, start] = useTransition();

    const save = () => {
      setError(null);
      start(async () => {
        const res = await updateShoppingItem({
          itemId: p.itemId,
          name: name.trim() || undefined,
          quantity: quantity ? Number(quantity) : null,
          unit: unit.trim() || null,
          notes: notes.trim() || null,
        });
        if (!res.ok) { setError(res.error.message); return; }
        p.onOpenChange(false);
      });
    };
    const remove = () => {
      setError(null);
      start(async () => {
        const res = await deleteShoppingItem({ itemId: p.itemId });
        if (!res.ok) { setError(res.error.message); return; }
        p.onOpenChange(false);
      });
    };

    return (
      <Sheet open={p.open} onOpenChange={p.onOpenChange}>
        <SheetContent side="bottom">
          <SheetHeader><SheetTitle>Edit item</SheetTitle></SheetHeader>
          <div className="flex flex-col gap-3 py-4">
            <div>
              <Label htmlFor="sli-name">Name</Label>
              <Input id="sli-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </div>
            <div className="grid grid-cols-[1fr_1fr] gap-2">
              <div>
                <Label htmlFor="sli-qty">Quantity</Label>
                <Input id="sli-qty" type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="sli-unit">Unit</Label>
                <Input id="sli-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={24} />
              </div>
            </div>
            <div>
              <Label htmlFor="sli-notes">Notes</Label>
              <Textarea id="sli-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2 pt-2">
              <Button type="button" onClick={save} disabled={pending || !name.trim()} className="flex-1">Save</Button>
              <Button type="button" variant="ghost" onClick={remove} disabled={pending}>Delete</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }
  ```

- [ ] **Step 5: Write `bought-history.tsx`**

  ```tsx
  "use client";
  import { useState } from "react";
  import { ItemRow } from "./item-row";

  export type BoughtItem = {
    id: string;
    name: string;
    quantity: number | null;
    unit: string | null;
    notes: string | null;
    boughtAt: string;
  };

  export function BoughtHistory({ items, readOnly }: { items: BoughtItem[]; readOnly: boolean }) {
    const [open, setOpen] = useState(false);
    if (items.length === 0) return null;
    return (
      <section className="mt-4 border-t border-dashed border-border">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:bg-muted/30"
        >
          <span>Show bought (last 7d) · {items.length} item{items.length === 1 ? "" : "s"}</span>
          <span aria-hidden>{open ? "▴" : "▾"}</span>
        </button>
        {open && (
          <div>
            {items.map((it) => (
              <ItemRow
                key={it.id}
                itemId={it.id}
                name={it.name}
                quantity={it.quantity}
                unit={it.unit}
                notes={it.notes}
                bought
                boughtAt={it.boughtAt}
                readOnly={readOnly}
              />
            ))}
          </div>
        )}
      </section>
    );
  }
  ```

- [ ] **Step 6: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean. Likely friction: shadcn primitives' base-ui `render={}` patterns. The Sheet/Dialog primitives from Task 12 of slice 2a are reused as-is — no `asChild`.

- [ ] **Step 7: Commit**

  ```bash
  git add src/components/shopping
  git commit -m "$(cat <<'EOF'
  Add shopping UI components (item-row, quick-add, auto-add, edit-sheet, history)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6: `/shopping` page + `MainNav` + nav into `/plan` and `/recipes`

**Files:**

- Create: `src/components/site/main-nav.tsx`
- Create: `src/app/shopping/page.tsx`
- Modify: `src/app/plan/[date]/page.tsx` (insert MainNav at the top of the returned JSX)
- Modify: `src/app/recipes/page.tsx` (insert MainNav at the top of the returned JSX)

- [ ] **Step 1: Write `main-nav.tsx`**

  Create `src/components/site/main-nav.tsx`:

  ```tsx
  import Link from "next/link";
  import { cn } from "@/lib/utils";

  type Route = "plan" | "recipes" | "shopping";

  export function MainNav({ active }: { active: Route }) {
    const links: { route: Route; href: string; label: string }[] = [
      { route: "plan",     href: "/plan",     label: "Plan" },
      { route: "recipes",  href: "/recipes",  label: "Recipes" },
      { route: "shopping", href: "/shopping", label: "Shopping" },
    ];
    return (
      <nav aria-label="Main" className="flex gap-4 border-b border-border px-4 py-2 text-sm">
        {links.map((l) => (
          <Link
            key={l.route}
            href={l.href}
            className={cn(
              "hover:underline",
              active === l.route ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    );
  }
  ```

- [ ] **Step 2: Write `src/app/shopping/page.tsx`**

  ```tsx
  "use client";
  import { useEffect, useState, useTransition } from "react";
  import { createClient } from "@/lib/supabase/client";
  import { MainNav } from "@/components/site/main-nav";
  import { QuickAdd } from "@/components/shopping/quick-add";
  import { AutoAddButton } from "@/components/shopping/auto-add-button";
  import { ItemRow } from "@/components/shopping/item-row";
  import { EditItemSheet } from "@/components/shopping/edit-item-sheet";
  import { BoughtHistory, type BoughtItem } from "@/components/shopping/bought-history";

  type ShoppingItem = {
    id: string;
    item_name: string;
    quantity: number | null;
    unit: string | null;
    notes: string | null;
    bought_at: string | null;
    created_at: string;
  };

  type Role = "owner" | "maid" | "family_member";

  export default function ShoppingPage() {
    // Note: this page is client-side because the user needs interactive checkboxes
    // and quick-add without a full server round-trip per keystroke. RLS still
    // gates every action server-side.
    const [unbought, setUnbought] = useState<ShoppingItem[]>([]);
    const [bought, setBought] = useState<ShoppingItem[]>([]);
    const [role, setRole] = useState<Role | null>(null);
    const [editTarget, setEditTarget] = useState<ShoppingItem | null>(null);
    const [pending, start] = useTransition();

    const refresh = () => {
      start(async () => {
        const supabase = createClient();
        const { data: u } = await supabase
          .from("shopping_list_items")
          .select("id,item_name,quantity,unit,notes,bought_at,created_at")
          .is("bought_at", null)
          .order("created_at", { ascending: false });
        const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
        const { data: b } = await supabase
          .from("shopping_list_items")
          .select("id,item_name,quantity,unit,notes,bought_at,created_at")
          .gte("bought_at", sevenDaysAgo)
          .order("bought_at", { ascending: false });
        setUnbought((u ?? []) as ShoppingItem[]);
        setBought((b ?? []) as ShoppingItem[]);
      });
    };

    useEffect(() => {
      // Pull role and initial data on mount. We can't call requireHousehold from a
      // client component, so we fetch the membership via Supabase directly.
      start(async () => {
        const supabase = createClient();
        const { data: meRows } = await supabase
          .from("household_memberships")
          .select("role")
          .eq("status", "active")
          .order("joined_at", { ascending: false })
          .limit(1);
        setRole(((meRows?.[0]?.role) ?? null) as Role | null);
        // initial fetch
        const { data: u } = await supabase
          .from("shopping_list_items")
          .select("id,item_name,quantity,unit,notes,bought_at,created_at")
          .is("bought_at", null)
          .order("created_at", { ascending: false });
        const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
        const { data: bRows } = await supabase
          .from("shopping_list_items")
          .select("id,item_name,quantity,unit,notes,bought_at,created_at")
          .gte("bought_at", sevenDaysAgo)
          .order("bought_at", { ascending: false });
        setUnbought((u ?? []) as ShoppingItem[]);
        setBought((bRows ?? []) as ShoppingItem[]);
      });
    }, []);

    const readOnly = role === "family_member" || role === null;
    const bHistory: BoughtItem[] = bought.map((b) => ({
      id: b.id,
      name: b.item_name,
      quantity: b.quantity,
      unit: b.unit,
      notes: b.notes,
      boughtAt: b.bought_at!,
    }));

    return (
      <main className="mx-auto max-w-md">
        <MainNav active="shopping" />
        <header className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h1 className="text-lg font-semibold">Shopping</h1>
          {!readOnly && <AutoAddButton />}
        </header>
        {!readOnly && <QuickAdd />}
        {unbought.length === 0 && bought.length === 0 && (
          <p className="px-4 py-12 text-center text-muted-foreground">
            Nothing on the list. {readOnly ? "Wait for an owner or maid to add something." : "Add an item or pull from this week's plans."}
          </p>
        )}
        {unbought.map((it) => (
          <ItemRow
            key={it.id}
            itemId={it.id}
            name={it.item_name}
            quantity={it.quantity}
            unit={it.unit}
            notes={it.notes}
            bought={false}
            boughtAt={null}
            readOnly={readOnly}
            onEdit={readOnly ? undefined : () => setEditTarget(it)}
          />
        ))}
        <BoughtHistory items={bHistory} readOnly={readOnly} />
        {editTarget && (
          <EditItemSheet
            itemId={editTarget.id}
            initial={{
              name: editTarget.item_name,
              quantity: editTarget.quantity,
              unit: editTarget.unit,
              notes: editTarget.notes,
            }}
            open={editTarget !== null}
            onOpenChange={(open) => {
              if (!open) {
                setEditTarget(null);
                refresh();
              }
            }}
          />
        )}
      </main>
    );
  }
  ```

  > **Why this page is client-side.** A server component would re-render the entire page on every check-off, which is too slow for the optimistic-feel we want. Auth/authorization still happens at the row level via RLS. If the user is unauthenticated, `proxy.ts` redirects them to `/` (added in Step 5 below) — they never reach this page.

- [ ] **Step 3: Add the route to `proxy.ts`'s gated matcher**

  Open `src/proxy.ts` and add `"/shopping(.*)"` to `isAuthGated` (alongside `/plan(.*)` and `/recipes(.*)` from slice 2a):

  ```ts
  const isAuthGated = createRouteMatcher([
    "/dashboard(.*)",
    "/household(.*)",
    "/onboarding(.*)",
    "/plan(.*)",
    "/recipes(.*)",
    "/shopping(.*)",
  ]);
  ```

- [ ] **Step 4: Insert `<MainNav active="plan" />` into `src/app/plan/[date]/page.tsx`**

  Open the file. Find the `<main className="mx-auto max-w-md">` opening tag. Insert `<MainNav active="plan" />` as the **first** child, before the existing `<header>`. Add the import at the top:

  ```tsx
  import { MainNav } from "@/components/site/main-nav";
  ```

- [ ] **Step 5: Insert `<MainNav active="recipes" />` into `src/app/recipes/page.tsx`**

  Same pattern. Open the file, add the import, insert `<MainNav active="recipes" />` as the first child of the page's top-level `<main>` (or equivalent root element). The existing layout structure (search + filter + grid) follows.

- [ ] **Step 6: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean.

- [ ] **Step 7: Don't start dev server.** `.env.local` already has Clerk dev keys — but skipping the smoke step here is fine since Task 7 below runs Playwright which boots the dev server.

- [ ] **Step 8: Commit**

  ```bash
  git add src/components/site/main-nav.tsx src/app/shopping/page.tsx src/proxy.ts src/app/plan/\[date\]/page.tsx src/app/recipes/page.tsx
  git commit -m "$(cat <<'EOF'
  Add /shopping page + MainNav; gate /shopping in proxy; wire nav into /plan + /recipes

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7: Playwright smoke for `/shopping`

**Files:**

- Create: `tests/e2e/shopping.spec.ts`

- [ ] **Step 1: Write the smoke**

  ```ts
  import { test, expect } from "@playwright/test";

  test.describe("slice 2b smoke (unauthenticated)", () => {
    test("/shopping redirects unauthenticated users to /", async ({ page }) => {
      await page.goto("/shopping");
      await expect(page).toHaveURL("http://localhost:3000/");
    });
  });
  ```

- [ ] **Step 2: Run the full E2E suite**

  ```bash
  pnpm test:e2e 2>&1 | tail -10
  ```

  Expected: all foundations + slice 2a tests still pass, plus the new slice 2b test. Two test projects (chromium + mobile/WebKit) = 2 new passes. Skipped tests stay at 2 (the auth-required manual case from slice 2a).

  If `/shopping` is reachable instead of redirecting, double-check `proxy.ts`'s `isAuthGated` includes `"/shopping(.*)"`.

- [ ] **Step 3: Commit**

  ```bash
  git add tests/e2e/shopping.spec.ts
  git commit -m "$(cat <<'EOF'
  Add Playwright smoke for /shopping route gating

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 8: HANDOFF update + final verification

**Files:**

- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Run the full local verification gate**

  ```bash
  pnpm db:reset && pnpm typecheck && pnpm test tests/db && pnpm test:e2e
  ```

  Expected:
  - `pnpm db:reset`: all 18 migrations apply (7 foundations + 9 slice 2a + 2 slice 2b).
  - `pnpm typecheck`: clean.
  - `pnpm test tests/db`: 18 passing (no slice 2b DB tests added per "skip tests" instruction).
  - `pnpm test:e2e`: 12 pass (10 existing + 2 slice 2b chromium/mobile) + 2 expected skips.

- [ ] **Step 2: Manual walkthrough**

  This is interactive in the browser (`pnpm dev`). Verify:

  1. Owner signs in. Visit `/dashboard`. Click into `/plan` or `/recipes` — confirm the new 3-link header nav shows (Plan · Recipes · Shopping) with the right link highlighted.
  2. Click **Shopping** in the nav. Land on `/shopping`. Empty state shows.
  3. Quick-add 2 items by name (e.g., "milk", "bread"). They appear at the top.
  4. Tap one of them — the **Edit item** sheet opens with the name pre-filled. Add quantity (1) and unit ("loaf"), save.
  5. Set a meal plan slot with a recipe that has ingredients (use a starter recipe with ingredients populated, or add a custom recipe with ingredients).
  6. Click **+ Auto-add 7d**. A toast shows "Added N items from this week's plans." The new items appear in the list.
  7. Tap an item's checkbox — it strikes through and disappears from the unbought list. The "Show bought (last 7d)" footer appears with `N items`.
  8. Expand the bought section. The item appears with `bought <time>` in its meta. Tap its checkbox — it unmarks and jumps back to the unbought list.
  9. Sign in as a family member (different test user). Same household. Visit `/shopping`. Confirm: no **+ Auto-add 7d** button, no quick-add row, no edit sheet on tap, no checkboxes interactive.
  10. Run `psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "select count(*) from shopping_list_items where household_id='<your hh id>'"`. Confirm a sensible count.

- [ ] **Step 3: Update `docs/HANDOFF.md`**

  Append a new section under "Status" after the slice 2a entries. Template:

  ```markdown
  ### Done — Slice 2b (Shopping list)

  Spec: [`docs/specs/2026-05-11-slice-2b-shopping-list-design.md`](specs/2026-05-11-slice-2b-shopping-list-design.md). Plan: [`docs/plans/2026-05-11-slice-2b-shopping-list.md`](plans/2026-05-11-slice-2b-shopping-list.md). 8 tasks executed.

  - **Migrations (2):** `20260526_001_shopping_list_items.sql` (table + RLS + partial indexes + CHECK), `20260527_001_shopping_auto_add_fn.sql` (the RPC).
  - **Server actions:** `src/app/shopping/actions.ts` — addShoppingItem, updateShoppingItem (bought rows immutable), markShoppingItemBought, unmarkShoppingItemBought, deleteShoppingItem (also allowed for bought rows), autoAddFromPlans.
  - **UI:** `/shopping` page (client component) with QuickAdd + AutoAddButton + ItemRow + EditItemSheet + BoughtHistory. New MainNav component rendered atop `/plan/[date]`, `/recipes`, and `/shopping`.
  - **`proxy.ts`:** `/shopping(.*)` added to the gated matcher.
  - **Family is read-only.** Auto-add, quick-add, checkboxes, edit sheet are all hidden for `family_member` role.

  Verified on 2026-MM-DD: full E2E suite green (12 passed + 2 expected skips).
  ```

  Add a "Deferred from slice 2b" block:

  ```markdown
  ### Deferred from slice 2b

  - **All vitest tests** (DB + action coverage) — same "we'll come back to tests" instruction as slice 2a. The action file uses the same patterns as `recipes/actions.ts`; tests will follow the foundations action-test helpers from `tests/helpers/`.
  - **Dashboard "Shopping" card.** Spec opted to surface shopping via the header nav only in v1; can promote to a dashboard card later if usage data justifies it.
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add docs/HANDOFF.md
  git commit -m "$(cat <<'EOF'
  Update HANDOFF for slice 2b completion

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

- [ ] **Step 5: Push (when ready)**

  ```bash
  git push origin main
  ```

---

## Final verification gate

- [ ] **`pnpm db:reset && pnpm typecheck && pnpm test tests/db && pnpm test:e2e`** all green.
- [ ] **`pnpm build`** completes cleanly (no production-build surprises from the new client component).
- [ ] **Manual walkthrough** complete (Task 8 Step 2).
- [ ] **Push** complete.

When all four are checked, slice 2b is ready to call done.
