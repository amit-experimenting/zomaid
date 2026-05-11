# Slice 3 — Bill Scanning + GitHub-Mediated Claude OCR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement slice 3 end-to-end: bill image upload → GitHub Issue creation with `@claude` → Claude OCRs the receipt and posts JSON in an issue comment → Next.js webhook ingests the JSON, writes `bill_line_items`, fuzzy-matches against unbought `shopping_list_items` (marking matches bought), and closes the issue. Failed bills get a manual-entry fallback.

**Architecture:** Two new tables (`bills`, `bill_line_items`) + one Postgres function (`ingest_bill_ocr`) for the atomic webhook write. App talks to GitHub via REST API + a long-lived PAT (`GITHUB_TOKEN`); webhook verifies inbound GitHub events via HMAC-SHA256 against `GITHUB_WEBHOOK_SECRET`. Webhook handler uses a service-role Supabase client (no JWT context) since it isn't a user-authenticated request. New Storage bucket `bill-images` with the same RLS pattern as `recipe-images-household`. UI: `/bills`, `/bills/new`, `/bills/[id]`; MainNav grows to 4 links.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · Tailwind v4 · `@base-ui/react` · Supabase (`@supabase/ssr`, `@supabase/supabase-js` v2, Storage) · Postgres 17 · Zod · `browser-image-compression` · Vitest · Playwright · pnpm.

**Spec reference:** [`docs/specs/2026-05-11-slice-3-bill-scanning-ocr-design.md`](../specs/2026-05-11-slice-3-bill-scanning-ocr-design.md) (commit `e496a6a`).

**Depends on:** Slices 1, 2a, 2b (all done, all migrations applied through `20260527_001_shopping_auto_add_fn.sql`). The webhook write needs the slice 2b `shopping_list_items` table.

---

## Pre-flight checks (manual, one-time setup before Task 1)

These six steps mirror the spec's §13. They must be done before Task 1.

- [ ] **A. Install the Claude Code GitHub Action on `amit-experimenting/zomaid`.**
  Visit https://github.com/apps/claude → Install → pick the repo. The action is billed against your Claude subscription. Confirm it's installed: Repo → Settings → Integrations → "Claude" should appear.

- [ ] **B. Create or reuse a GitHub Personal Access Token with `repo` scope.**
  https://github.com/settings/tokens → Generate new (classic) → check `repo` → no expiry (or 1 year). Copy the value.

- [ ] **C. Generate a webhook secret locally.**
  ```bash
  openssl rand -hex 32
  ```
  Save the output — needed in D and F.

- [ ] **D. Add four env vars to `.env.local`** (and to Vercel Production + Preview when deploying):

  ```
  GITHUB_TOKEN=ghp_...                                      # from step B
  GITHUB_REPO_OWNER=amit-experimenting
  GITHUB_REPO_NAME=zomaid
  GITHUB_WEBHOOK_SECRET=<the openssl rand -hex 32 output>   # from step C
  ```

- [ ] **E. Start an ngrok tunnel for local webhook receiving** (only needed for local dev; Vercel exposes the route automatically in prod).
  ```bash
  ngrok http 3000
  ```
  Note the `https://<random>.ngrok-free.app` URL.

- [ ] **F. Register the webhook on the repo.**
  https://github.com/amit-experimenting/zomaid/settings/hooks → Add webhook.
  - Payload URL: `<ngrok-url>/api/webhooks/github` (or `<vercel-url>/api/webhooks/github` in prod).
  - Content type: `application/json`.
  - Secret: the value from step C.
  - SSL verification: Enable.
  - Events: "Let me select individual events" → tick **Issue comments** only. Untick everything else.
  - Active: ✔.
  - Save.

When A–F are all green, start Task 1.

---

## File-structure recap

```
supabase/migrations/
  20260528_001_bills_and_line_items.sql   (Task 2)
  20260529_001_bill_images_storage.sql    (Task 3)
  20260530_001_ingest_bill_ocr_fn.sql     (Task 4)

src/lib/db/types.ts                        (extended in Task 5)

src/lib/github/issues.ts                   (Task 6 — REST client)
src/lib/supabase/service.ts                (Task 6 — service-role helper)

src/app/bills/actions.ts                   (Task 7)
src/app/api/webhooks/github/route.ts       (Task 8)

src/components/bills/
  status-badge.tsx                         (Task 9)
  bill-card.tsx                            (Task 9)
  bill-detail-header.tsx                   (Task 9)
  line-item-row.tsx                        (Task 9)
  line-item-editor.tsx                     (Task 9)
  upload-form.tsx                          (Task 9)
  manual-entry-form.tsx                    (Task 9)

src/app/bills/page.tsx                     (Task 10)
src/app/bills/new/page.tsx                 (Task 10)
src/app/bills/[id]/page.tsx                (Task 10)

src/components/site/main-nav.tsx           (modified Task 11)
src/proxy.ts                               (modified Task 11)

.env.local.example                         (modified Task 1)

tests/e2e/bills.spec.ts                    (Task 12)

docs/HANDOFF.md                            (modified Task 13)
```

> **Note on test tasks.** The user has indicated tests are deferred. Tests appear here for completeness; at execution time, test-writing steps may be skipped per task.

---

## Task 1: Document env vars in `.env.local.example`

**Files:**

- Modify: `.env.local.example`

- [ ] **Step 1: Read existing `.env.local.example`**

  ```bash
  cat .env.local.example
  ```

- [ ] **Step 2: Add the four new entries**

  Append to `.env.local.example` (or insert in a sensible position alongside other secrets — match existing block structure):

  ```
  # ── GitHub OCR integration (slice 3) ────────────────────────────────
  # PAT with `repo` scope. Used to create issues on the target repo and
  # close them when OCR completes.
  GITHUB_TOKEN=ghp_replace_me

  # The repo the app creates bill-OCR issues on. Single-household v1.
  GITHUB_REPO_OWNER=amit-experimenting
  GITHUB_REPO_NAME=zomaid

  # 32-byte hex string. Set the SAME value on the repo's webhook config.
  # Generate with: openssl rand -hex 32
  GITHUB_WEBHOOK_SECRET=replace_me
  ```

- [ ] **Step 3: Confirm `.env.local` (untracked) has real values for these four vars**

  ```bash
  grep -E '^(GITHUB_TOKEN|GITHUB_REPO_OWNER|GITHUB_REPO_NAME|GITHUB_WEBHOOK_SECRET)=' .env.local | sed -E 's/=.*/=<set>/'
  ```

  Expected: 4 lines printed (all `<set>`). If any are missing, the spec's pre-flight A–F isn't complete — stop and finish pre-flight before continuing.

- [ ] **Step 4: Commit**

  ```bash
  git add .env.local.example
  git commit -m "$(cat <<'EOF'
  Document GitHub OCR env vars in .env.local.example

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 2: Migration — `bill_status` enum + `bills` + `bill_line_items` + RLS

**Files:**

- Create: `supabase/migrations/20260528_001_bills_and_line_items.sql`

- [ ] **Step 1: Write the migration**

  Create `supabase/migrations/20260528_001_bills_and_line_items.sql`:

  ```sql
  -- Slice 3 — Bills + line items.
  -- See docs/specs/2026-05-11-slice-3-bill-scanning-ocr-design.md §4 + §6.

  create type public.bill_status as enum ('pending', 'processing', 'processed', 'failed');

  create table public.bills (
    id                     uuid primary key default gen_random_uuid(),
    household_id           uuid not null references public.households(id) on delete cascade,
    uploaded_by_profile_id uuid references public.profiles(id) on delete set null,
    status                 public.bill_status not null default 'pending',
    status_reason          text,
    bill_date              date,
    store_name             text check (store_name is null or length(store_name) between 1 and 200),
    total_amount           numeric check (total_amount is null or total_amount >= 0),
    currency               text not null default 'SGD',
    image_storage_path     text not null,
    github_issue_number    int,
    github_issue_url       text,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    processed_at           timestamptz
  );

  create index bills_household_created_idx
    on public.bills (household_id, created_at desc);

  create index bills_status_idx
    on public.bills (status)
    where status in ('pending', 'processing');

  create index bills_github_issue_idx
    on public.bills (github_issue_number)
    where github_issue_number is not null;

  create trigger bills_touch_updated_at
    before update on public.bills
    for each row execute function public.touch_updated_at();

  alter table public.bills enable row level security;

  create policy bills_read on public.bills
    for select to authenticated
    using (public.has_active_membership(household_id));

  create policy bills_insert on public.bills
    for insert to authenticated
    with check (public.is_active_owner_or_maid(household_id));

  create policy bills_update on public.bills
    for update to authenticated
    using (public.is_active_owner_or_maid(household_id))
    with check (public.is_active_owner_or_maid(household_id));

  create policy bills_delete on public.bills
    for delete to authenticated
    using (public.is_active_owner_or_maid(household_id));

  -- Line items
  create table public.bill_line_items (
    id                        uuid primary key default gen_random_uuid(),
    bill_id                   uuid not null references public.bills(id) on delete cascade,
    position                  int not null check (position >= 1),
    item_name                 text not null check (length(item_name) between 1 and 120),
    quantity                  numeric check (quantity is null or quantity > 0),
    unit                      text check (unit is null or length(unit) between 1 and 24),
    unit_price                numeric check (unit_price is null or unit_price >= 0),
    line_total                numeric check (line_total is null or line_total >= 0),
    matched_shopping_item_id  uuid references public.shopping_list_items(id) on delete set null,
    created_at                timestamptz not null default now(),
    updated_at                timestamptz not null default now(),
    unique (bill_id, position)
  );

  create index bill_line_items_bill_id_idx on public.bill_line_items (bill_id);

  create trigger bill_line_items_touch_updated_at
    before update on public.bill_line_items
    for each row execute function public.touch_updated_at();

  alter table public.bill_line_items enable row level security;

  create policy bill_line_items_read on public.bill_line_items
    for select to authenticated
    using (
      exists (select 1 from public.bills b
              where b.id = bill_id
                and public.has_active_membership(b.household_id))
    );

  create policy bill_line_items_write on public.bill_line_items
    for all to authenticated
    using (
      exists (select 1 from public.bills b
              where b.id = bill_id
                and public.is_active_owner_or_maid(b.household_id))
    )
    with check (
      exists (select 1 from public.bills b
              where b.id = bill_id
                and public.is_active_owner_or_maid(b.household_id))
    );
  ```

- [ ] **Step 2: Apply the migration**

  ```bash
  pnpm db:reset
  ```

  Expected: prints applied migration filenames through `20260528_001_bills_and_line_items.sql`. On error, fix the SQL and retry.

- [ ] **Step 3: Smoke-check the tables exist**

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "\d public.bills" -c "\d public.bill_line_items"
  ```

  Expected: both tables listed with the right columns, indexes, RLS, and the `bill_status` enum on `bills.status`.

- [ ] **Step 4: Confirm nothing regressed**

  ```bash
  pnpm typecheck && pnpm test tests/db
  ```

  Expected: typecheck clean; 18 foundations DB tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add supabase/migrations/20260528_001_bills_and_line_items.sql
  git commit -m "$(cat <<'EOF'
  Add bills + bill_line_items tables + bill_status enum + RLS

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3: Migration — `bill-images` Storage bucket + RLS

**Files:**

- Create: `supabase/migrations/20260529_001_bill_images_storage.sql`

- [ ] **Step 1: Write the migration**

  ```sql
  -- Slice 3 — Storage bucket for bill images. Mirrors recipe-images-household RLS.

  insert into storage.buckets (id, name, public)
    values ('bill-images', 'bill-images', false)
    on conflict (id) do nothing;

  create policy storage_bills_read
    on storage.objects for select to authenticated
    using (
      bucket_id = 'bill-images'
      and public.has_active_membership((split_part(name, '/', 1))::uuid)
    );

  create policy storage_bills_insert
    on storage.objects for insert to authenticated
    with check (
      bucket_id = 'bill-images'
      and public.is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
    );

  create policy storage_bills_update
    on storage.objects for update to authenticated
    using (
      bucket_id = 'bill-images'
      and public.is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
    )
    with check (
      bucket_id = 'bill-images'
      and public.is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
    );

  create policy storage_bills_delete
    on storage.objects for delete to authenticated
    using (
      bucket_id = 'bill-images'
      and public.is_active_owner_or_maid((split_part(name, '/', 1))::uuid)
    );
  ```

- [ ] **Step 2: Apply**

  ```bash
  pnpm db:reset
  ```

  Expected: applies cleanly.

- [ ] **Step 3: Confirm the bucket exists**

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "select id, public from storage.buckets where id='bill-images';"
  ```

  Expected: 1 row, `public=false`.

- [ ] **Step 4: Commit**

  ```bash
  git add supabase/migrations/20260529_001_bill_images_storage.sql
  git commit -m "$(cat <<'EOF'
  Add bill-images Storage bucket with household-scoped RLS

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4: Migration — `ingest_bill_ocr()` Postgres function

**Files:**

- Create: `supabase/migrations/20260530_001_ingest_bill_ocr_fn.sql`

- [ ] **Step 1: Write the migration**

  ```sql
  -- Slice 3 — Atomic OCR ingest: insert line items, fuzzy-match against unbought
  -- shopping_list_items, mark matches bought, and finalize the bill row.
  --
  -- Called only by the webhook handler via the service-role client. The function
  -- is security definer so the access rules are explicit; EXECUTE is revoked from
  -- public and granted only to postgres + service_role.

  create or replace function public.ingest_bill_ocr(
    p_bill_id uuid,
    p_payload jsonb
  ) returns public.bills
    language plpgsql security definer
    set search_path = public
    as $$
    declare
      v_bill         public.bills;
      v_item         jsonb;
      v_position     int := 0;
      v_norm         text;
      v_match_id     uuid;
      v_match_count  int;
      v_line_item_id uuid;
      v_bill_date    date;
      v_uploader     uuid;
    begin
      -- Idempotency: if the bill is already 'processed', return as-is.
      select * into v_bill from public.bills where id = p_bill_id for update;
      if v_bill is null then
        raise exception 'bill % not found', p_bill_id using errcode = 'P0002';
      end if;
      if v_bill.status = 'processed' then
        return v_bill;
      end if;

      v_uploader  := v_bill.uploaded_by_profile_id;

      -- 1. Update the bill header.
      v_bill_date := nullif(p_payload->>'bill_date', '')::date;

      update public.bills
        set status        = 'processed',
            processed_at  = now(),
            store_name    = nullif(p_payload->>'store_name', ''),
            bill_date     = v_bill_date,
            total_amount  = (p_payload->>'total_amount')::numeric
        where id = p_bill_id
        returning * into v_bill;

      -- 2. Insert line items + fuzzy-match.
      for v_item in
        select * from jsonb_array_elements(coalesce(p_payload->'line_items', '[]'::jsonb))
      loop
        v_position := v_position + 1;

        insert into public.bill_line_items
          (bill_id, position, item_name, quantity, unit, unit_price, line_total)
        values (
          p_bill_id,
          v_position,
          v_item->>'item_name',
          nullif(v_item->>'quantity', '')::numeric,
          nullif(v_item->>'unit', ''),
          nullif(v_item->>'unit_price', '')::numeric,
          nullif(v_item->>'line_total', '')::numeric
        )
        returning id into v_line_item_id;

        v_norm := lower(trim(v_item->>'item_name'));

        -- Bi-directional substring match against unbought shopping items.
        select count(*), min(id) into v_match_count, v_match_id
        from public.shopping_list_items
        where household_id = v_bill.household_id
          and bought_at is null
          and (
            lower(trim(item_name)) like '%' || v_norm || '%'
            or
            v_norm like '%' || lower(trim(item_name)) || '%'
          );

        if v_match_count = 1 then
          update public.shopping_list_items
            set bought_at = coalesce(v_bill_date::timestamptz, now()),
                bought_by_profile_id = v_uploader
            where id = v_match_id;

          update public.bill_line_items
            set matched_shopping_item_id = v_match_id
            where id = v_line_item_id;
        end if;
      end loop;

      return v_bill;
    end;
    $$;

  revoke execute on function public.ingest_bill_ocr(uuid, jsonb) from public;
  grant  execute on function public.ingest_bill_ocr(uuid, jsonb) to postgres;
  grant  execute on function public.ingest_bill_ocr(uuid, jsonb) to service_role;
  ```

- [ ] **Step 2: Apply**

  ```bash
  pnpm db:reset
  ```

  Expected: applies cleanly. If `service_role` GRANT errors with "role does not exist", the function still gets the postgres grant — that's enough. Supabase creates `service_role` automatically; if missing locally, remove that line.

- [ ] **Step 3: Smoke-check the function exists**

  ```bash
  psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" -c "\df public.ingest_bill_ocr"
  ```

  Expected: 1 row.

- [ ] **Step 4: Commit**

  ```bash
  git add supabase/migrations/20260530_001_ingest_bill_ocr_fn.sql
  git commit -m "$(cat <<'EOF'
  Add ingest_bill_ocr() atomic OCR-write function

  Inserts bill_line_items, fuzzy-matches against unbought shopping_list_items
  (case-insensitive bi-directional substring), and marks exact-1 matches bought.
  Security definer; only callable by postgres + service_role.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5: Extend `src/lib/db/types.ts` with slice 3 types

**Files:**

- Modify: `src/lib/db/types.ts`

- [ ] **Step 1: Add the table entries to `Database["public"]["Tables"]`**

  Add these two entries alongside the existing slice 2b table (`shopping_list_items`):

  ```ts
  bills: {
    Row: {
      id: string;
      household_id: string;
      uploaded_by_profile_id: string | null;
      status: "pending" | "processing" | "processed" | "failed";
      status_reason: string | null;
      bill_date: string | null;
      store_name: string | null;
      total_amount: number | null;
      currency: string;
      image_storage_path: string;
      github_issue_number: number | null;
      github_issue_url: string | null;
      created_at: string;
      updated_at: string;
      processed_at: string | null;
    };
    Insert: {
      id?: string;
      household_id: string;
      uploaded_by_profile_id?: string | null;
      status?: "pending" | "processing" | "processed" | "failed";
      status_reason?: string | null;
      bill_date?: string | null;
      store_name?: string | null;
      total_amount?: number | null;
      currency?: string;
      image_storage_path: string;
      github_issue_number?: number | null;
      github_issue_url?: string | null;
      created_at?: string;
      updated_at?: string;
      processed_at?: string | null;
    };
    Update: Partial<Database["public"]["Tables"]["bills"]["Insert"]>;
    Relationships: [];
  };

  bill_line_items: {
    Row: {
      id: string;
      bill_id: string;
      position: number;
      item_name: string;
      quantity: number | null;
      unit: string | null;
      unit_price: number | null;
      line_total: number | null;
      matched_shopping_item_id: string | null;
      created_at: string;
      updated_at: string;
    };
    Insert: {
      id?: string;
      bill_id: string;
      position: number;
      item_name: string;
      quantity?: number | null;
      unit?: string | null;
      unit_price?: number | null;
      line_total?: number | null;
      matched_shopping_item_id?: string | null;
      created_at?: string;
      updated_at?: string;
    };
    Update: Partial<Database["public"]["Tables"]["bill_line_items"]["Insert"]>;
    Relationships: [];
  };
  ```

- [ ] **Step 2: Add the enum to `Database["public"]["Enums"]`**

  ```ts
  bill_status: "pending" | "processing" | "processed" | "failed";
  ```

- [ ] **Step 3: Add the function to `Database["public"]["Functions"]`**

  ```ts
  ingest_bill_ocr: {
    Args: { p_bill_id: string; p_payload: Record<string, unknown> };
    Returns: Database["public"]["Tables"]["bills"]["Row"];
  };
  ```

- [ ] **Step 4: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/db/types.ts
  git commit -m "$(cat <<'EOF'
  Extend Database types for bills + bill_line_items + ingest_bill_ocr

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6: GitHub REST client + service-role Supabase helper

**Files:**

- Create: `src/lib/github/issues.ts`
- Create: `src/lib/supabase/service.ts`

- [ ] **Step 1: Write `src/lib/github/issues.ts`**

  ```ts
  // Thin GitHub REST client for bill-OCR ticket lifecycle. Uses a PAT in
  // GITHUB_TOKEN with `repo` scope. No SDK dependency — just fetch.

  const GH_API = "https://api.github.com";

  type IssueRef = { issueNumber: number; issueUrl: string };

  function ghHeaders(): HeadersInit {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN not set");
    return {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  function ghRepo(): { owner: string; name: string } {
    const owner = process.env.GITHUB_REPO_OWNER;
    const name = process.env.GITHUB_REPO_NAME;
    if (!owner || !name) throw new Error("GITHUB_REPO_OWNER / GITHUB_REPO_NAME not set");
    return { owner, name };
  }

  export type CreateBillIssueArgs = {
    billId: string;
    householdId: string;
    signedImageUrl: string;
    storeHint: string | null;
    uploadedAtIso: string;
  };

  /**
   * Creates a GitHub Issue with the bill image embedded and an @claude prompt.
   * The body contains a sentinel <!-- zomaid-bill --> the webhook uses to filter
   * comments to the ones it owns.
   */
  export async function createBillIssue(args: CreateBillIssueArgs): Promise<IssueRef> {
    const { owner, name } = ghRepo();
    const body = `<!-- zomaid-bill -->
**Bill ID:** \`${args.billId}\`
**Household:** \`${args.householdId}\`
**Uploaded:** ${args.uploadedAtIso}
**Store hint (user-provided):** ${args.storeHint ? args.storeHint : "_(none)_"}

![bill](${args.signedImageUrl})

---

@claude please read the attached receipt image and reply **only** with a single fenced JSON code block matching this schema. Use SGD. Use ISO date \`YYYY-MM-DD\`. If a value isn't visible, use \`null\`.

\`\`\`json
{
  "store_name": "string or null",
  "bill_date": "YYYY-MM-DD or null",
  "total_amount": 0.00,
  "line_items": [
    { "item_name": "string", "quantity": 0, "unit": "string or null", "unit_price": 0.00, "line_total": 0.00 }
  ]
}
\`\`\`

Do not include any prose; the parser reads only the JSON code block.
`;

    const res = await fetch(`${GH_API}/repos/${owner}/${name}/issues`, {
      method: "POST",
      headers: ghHeaders(),
      body: JSON.stringify({
        title: `Bill OCR: ${args.billId}`,
        body,
        labels: ["bill-ocr"],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub createIssue ${res.status}: ${text}`);
    }
    const json = (await res.json()) as { number: number; html_url: string };
    return { issueNumber: json.number, issueUrl: json.html_url };
  }

  export type CloseBillIssueArgs = {
    issueNumber: number;
    completionComment: string;
  };

  export async function closeBillIssue(args: CloseBillIssueArgs): Promise<void> {
    const { owner, name } = ghRepo();
    // 1. Post completion comment.
    const commentRes = await fetch(
      `${GH_API}/repos/${owner}/${name}/issues/${args.issueNumber}/comments`,
      {
        method: "POST",
        headers: ghHeaders(),
        body: JSON.stringify({ body: args.completionComment }),
      },
    );
    if (!commentRes.ok) {
      const text = await commentRes.text();
      throw new Error(`GitHub addComment ${commentRes.status}: ${text}`);
    }
    // 2. Close the issue.
    const closeRes = await fetch(
      `${GH_API}/repos/${owner}/${name}/issues/${args.issueNumber}`,
      {
        method: "PATCH",
        headers: ghHeaders(),
        body: JSON.stringify({ state: "closed" }),
      },
    );
    if (!closeRes.ok) {
      const text = await closeRes.text();
      throw new Error(`GitHub closeIssue ${closeRes.status}: ${text}`);
    }
  }
  ```

- [ ] **Step 2: Write `src/lib/supabase/service.ts`**

  ```ts
  // Service-role Supabase client. Bypasses RLS. Use ONLY in trusted server
  // contexts (webhook handlers, boot tasks). Never expose to client components.

  import { createClient as createSupabaseClient } from "@supabase/supabase-js";
  import type { Database } from "@/lib/db/types";

  export function createServiceClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
    }
    return createSupabaseClient<Database>(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean.

- [ ] **Step 4: Commit**

  ```bash
  git add src/lib/github/issues.ts src/lib/supabase/service.ts
  git commit -m "$(cat <<'EOF'
  Add GitHub REST client + service-role Supabase helper

  - src/lib/github/issues.ts: createBillIssue + closeBillIssue via plain fetch.
  - src/lib/supabase/service.ts: service-role client for the webhook handler.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7: Bill server actions

**Files:**

- Create: `src/app/bills/actions.ts`

- [ ] **Step 1: Write the actions**

  ```ts
  "use server";

  import { revalidatePath } from "next/cache";
  import { z } from "zod";
  import { createClient } from "@/lib/supabase/server";
  import { requireHousehold } from "@/lib/auth/require";
  import { closeBillIssue, createBillIssue } from "@/lib/github/issues";
  import type { Database } from "@/lib/db/types";

  export type BillActionResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string> } };

  const PhotoConstraints = {
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: ["image/jpeg", "image/png", "image/webp"] as const,
  };

  function validatePhoto(file: File | null):
    | { ok: true }
    | { ok: false; code: "BILL_INVALID_FILE"; message: string }
  {
    if (!file) return { ok: false, code: "BILL_INVALID_FILE", message: "No file provided." };
    if (file.size === 0) return { ok: false, code: "BILL_INVALID_FILE", message: "Empty file." };
    if (file.size > PhotoConstraints.maxBytes) {
      return { ok: false, code: "BILL_INVALID_FILE", message: "Photo exceeds 5 MB." };
    }
    if (!(PhotoConstraints.mimeTypes as readonly string[]).includes(file.type)) {
      return { ok: false, code: "BILL_INVALID_FILE", message: "Only JPEG, PNG, or WebP." };
    }
    return { ok: true };
  }

  function extFor(mime: string): "jpg" | "png" | "webp" {
    if (mime === "image/png") return "png";
    if (mime === "image/webp") return "webp";
    return "jpg";
  }

  /** Internal helper: uploads to Storage, returns the path + a 24h signed URL. */
  async function uploadImageAndSignUrl(
    supabase: Awaited<ReturnType<typeof createClient>>,
    householdId: string,
    billId: string,
    file: File,
  ): Promise<{ path: string; signedUrl: string }> {
    const path = `${householdId}/${billId}.${extFor(file.type)}`;
    const up = await supabase.storage.from("bill-images").upload(path, file, {
      upsert: true,
      contentType: file.type,
    });
    if (up.error) throw new Error(`Storage upload: ${up.error.message}`);
    const signed = await supabase.storage
      .from("bill-images")
      .createSignedUrl(path, 60 * 60 * 24);
    if (signed.error || !signed.data?.signedUrl) {
      throw new Error(`Signed URL: ${signed.error?.message ?? "no URL"}`);
    }
    return { path, signedUrl: signed.data.signedUrl };
  }

  export async function uploadBill(formData: FormData): Promise<BillActionResult<{ billId: string }>> {
    const file = formData.get("file") as File | null;
    const storeHint = ((formData.get("storeHint") as string | null) ?? "").trim() || null;
    const check = validatePhoto(file);
    if (!check.ok) return { ok: false, error: { code: check.code, message: check.message } };
    const ctx = await requireHousehold();
    const supabase = await createClient();

    // 1. Insert the bills row first (pending) so we have an ID for the storage path.
    const { data: billRow, error: insertErr } = await supabase
      .from("bills")
      .insert({
        household_id: ctx.household.id,
        uploaded_by_profile_id: ctx.profile.id,
        status: "pending",
        image_storage_path: "pending", // placeholder; updated below
      })
      .select("id")
      .single();
    if (insertErr || !billRow) {
      return { ok: false, error: { code: "BILL_FORBIDDEN", message: insertErr?.message ?? "Insert failed" } };
    }

    // 2. Upload image, generate signed URL.
    let path: string;
    let signedUrl: string;
    try {
      ({ path, signedUrl } = await uploadImageAndSignUrl(supabase, ctx.household.id, billRow.id, file!));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Upload failed";
      await supabase.from("bills").update({ status: "failed", status_reason: message }).eq("id", billRow.id);
      return { ok: false, error: { code: "BILL_INVALID_FILE", message } };
    }
    await supabase.from("bills").update({ image_storage_path: path }).eq("id", billRow.id);

    // 3. Create the GitHub issue.
    try {
      const issue = await createBillIssue({
        billId: billRow.id,
        householdId: ctx.household.id,
        signedImageUrl: signedUrl,
        storeHint,
        uploadedAtIso: new Date().toISOString(),
      });
      await supabase
        .from("bills")
        .update({
          status: "processing",
          github_issue_number: issue.issueNumber,
          github_issue_url: issue.issueUrl,
        })
        .eq("id", billRow.id);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "GitHub issue create failed";
      await supabase.from("bills").update({ status: "failed", status_reason: message }).eq("id", billRow.id);
      return { ok: false, error: { code: "BILL_GITHUB_CREATE_FAILED", message } };
    }

    revalidatePath("/bills");
    return { ok: true, data: { billId: billRow.id } };
  }

  const UpdateLineItemInput = z.object({
    lineItemId: z.string().uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    quantity: z.number().positive().nullable().optional(),
    unit: z.string().trim().min(1).max(24).nullable().optional(),
    unitPrice: z.number().nonnegative().nullable().optional(),
    lineTotal: z.number().nonnegative().nullable().optional(),
  });

  export async function updateBillLineItem(input: z.infer<typeof UpdateLineItemInput>): Promise<BillActionResult<{ lineItemId: string }>> {
    const parsed = UpdateLineItemInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: { code: "BILL_INVALID_FILE", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as unknown as Record<string, string> } };
    }
    await requireHousehold();
    const supabase = await createClient();
    const patch: Database["public"]["Tables"]["bill_line_items"]["Update"] = {};
    if (parsed.data.name !== undefined)      patch.item_name = parsed.data.name;
    if (parsed.data.quantity !== undefined)  patch.quantity = parsed.data.quantity ?? null;
    if (parsed.data.unit !== undefined)      patch.unit = parsed.data.unit ?? null;
    if (parsed.data.unitPrice !== undefined) patch.unit_price = parsed.data.unitPrice ?? null;
    if (parsed.data.lineTotal !== undefined) patch.line_total = parsed.data.lineTotal ?? null;
    const { error } = await supabase
      .from("bill_line_items")
      .update(patch)
      .eq("id", parsed.data.lineItemId);
    if (error) return { ok: false, error: { code: "BILL_FORBIDDEN", message: error.message } };
    revalidatePath("/bills");
    return { ok: true, data: { lineItemId: parsed.data.lineItemId } };
  }

  export async function deleteBill(input: { billId: string }): Promise<BillActionResult<{ billId: string }>> {
    const parsed = z.object({ billId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "BILL_INVALID_FILE", message: "Invalid input" } };
    await requireHousehold();
    const supabase = await createClient();
    const { error } = await supabase.from("bills").delete().eq("id", parsed.data.billId);
    if (error) return { ok: false, error: { code: "BILL_FORBIDDEN", message: error.message } };
    revalidatePath("/bills");
    return { ok: true, data: { billId: parsed.data.billId } };
  }

  export async function retryBill(input: { billId: string }): Promise<BillActionResult<{ billId: string }>> {
    const parsed = z.object({ billId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { ok: false, error: { code: "BILL_INVALID_FILE", message: "Invalid input" } };
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { data: bill, error: readErr } = await supabase
      .from("bills")
      .select("id, household_id, status, image_storage_path")
      .eq("id", parsed.data.billId)
      .maybeSingle();
    if (readErr) return { ok: false, error: { code: "BILL_FORBIDDEN", message: readErr.message } };
    if (!bill) return { ok: false, error: { code: "BILL_NOT_FOUND", message: "Bill not found" } };
    if (bill.status === "processed") {
      return { ok: false, error: { code: "BILL_ALREADY_PROCESSED", message: "Bill is already processed." } };
    }
    // Regenerate signed URL.
    const signed = await supabase.storage
      .from("bill-images")
      .createSignedUrl(bill.image_storage_path, 60 * 60 * 24);
    if (signed.error || !signed.data?.signedUrl) {
      return { ok: false, error: { code: "BILL_FORBIDDEN", message: signed.error?.message ?? "Signed URL failed" } };
    }
    try {
      const issue = await createBillIssue({
        billId: bill.id,
        householdId: bill.household_id,
        signedImageUrl: signed.data.signedUrl,
        storeHint: null,
        uploadedAtIso: new Date().toISOString(),
      });
      await supabase
        .from("bills")
        .update({
          status: "processing",
          status_reason: null,
          github_issue_number: issue.issueNumber,
          github_issue_url: issue.issueUrl,
        })
        .eq("id", bill.id);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "GitHub issue create failed";
      await supabase.from("bills").update({ status: "failed", status_reason: message }).eq("id", bill.id);
      return { ok: false, error: { code: "BILL_GITHUB_CREATE_FAILED", message } };
    }
    revalidatePath("/bills");
    revalidatePath(`/bills/${bill.id}`);
    return { ok: true, data: { billId: bill.id } };
  }

  const ManualLineSchema = z.object({
    item_name: z.string().trim().min(1).max(120),
    quantity: z.number().positive().nullable().optional(),
    unit: z.string().trim().min(1).max(24).nullable().optional(),
    unit_price: z.number().nonnegative().nullable().optional(),
    line_total: z.number().nonnegative().nullable().optional(),
  });

  const ManualInput = z.object({
    billId: z.string().uuid(),
    billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    storeName: z.string().trim().min(1).max(200).nullable().optional(),
    totalAmount: z.number().nonnegative().nullable().optional(),
    lineItems: z.array(ManualLineSchema).min(1),
  });

  export async function markBillManuallyProcessed(input: z.infer<typeof ManualInput>): Promise<BillActionResult<{ billId: string }>> {
    const parsed = ManualInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: { code: "BILL_INVALID_FILE", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as unknown as Record<string, string> } };
    }
    await requireHousehold();
    const supabase = await createClient();

    // Build the same payload shape ingest_bill_ocr expects.
    const payload: Record<string, unknown> = {
      store_name: parsed.data.storeName ?? null,
      bill_date: parsed.data.billDate ?? null,
      total_amount: parsed.data.totalAmount ?? null,
      line_items: parsed.data.lineItems,
    };
    const { error } = await supabase.rpc("ingest_bill_ocr", {
      p_bill_id: parsed.data.billId,
      p_payload: payload,
    });
    if (error) return { ok: false, error: { code: "BILL_FORBIDDEN", message: error.message } };

    // Close the GH issue (best-effort; ignore failures).
    const { data: bill } = await supabase.from("bills").select("github_issue_number").eq("id", parsed.data.billId).maybeSingle();
    if (bill?.github_issue_number) {
      try {
        await closeBillIssue({
          issueNumber: bill.github_issue_number,
          completionComment: `✅ Manually processed by household member → bill \`${parsed.data.billId}\``,
        });
      } catch { /* ignore — DB is the source of truth */ }
    }

    revalidatePath("/bills");
    revalidatePath(`/bills/${parsed.data.billId}`);
    return { ok: true, data: { billId: parsed.data.billId } };
  }
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean.

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/bills/actions.ts
  git commit -m "$(cat <<'EOF'
  Add bill server actions (upload, update line, delete, retry, manual-process)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 8: GitHub webhook handler

**Files:**

- Create: `src/app/api/webhooks/github/route.ts`

- [ ] **Step 1: Write the webhook**

  ```ts
  // Handles GitHub issue_comment.created events for bill-OCR issues.
  // Verifies HMAC against GITHUB_WEBHOOK_SECRET, then calls ingest_bill_ocr.

  import { createHmac, timingSafeEqual } from "node:crypto";
  import { NextResponse } from "next/server";
  import { z } from "zod";
  import { createServiceClient } from "@/lib/supabase/service";
  import { closeBillIssue } from "@/lib/github/issues";

  // Schema Claude is expected to return inside a fenced ```json code block.
  const PayloadSchema = z.object({
    store_name: z.string().nullable(),
    bill_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    total_amount: z.number().nullable(),
    line_items: z
      .array(
        z.object({
          item_name: z.string().min(1).max(120),
          quantity: z.number().nullable(),
          unit: z.string().nullable(),
          unit_price: z.number().nullable(),
          line_total: z.number().nullable(),
        }),
      )
      .min(0),
  });

  function verifyHmac(rawBody: string, signatureHeader: string | null): boolean {
    if (!signatureHeader) return false;
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) return false;
    const expected = "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  function extractJsonBlock(commentBody: string): unknown | null {
    // Find the first fenced ```json ... ``` code block.
    const match = commentBody.match(/```json\s*\n([\s\S]*?)\n```/);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }

  export async function POST(request: Request) {
    const rawBody = await request.text();
    const sig = request.headers.get("x-hub-signature-256");
    if (!verifyHmac(rawBody, sig)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    const event = request.headers.get("x-github-event");
    if (event !== "issue_comment") {
      return NextResponse.json({ ok: true, ignored: "non-comment event" });
    }
    const payload = JSON.parse(rawBody) as {
      action: string;
      issue?: { number: number; body?: string };
      comment?: { body?: string };
      repository?: { full_name: string };
    };
    if (payload.action !== "created") {
      return NextResponse.json({ ok: true, ignored: "non-create action" });
    }
    // Sentinel filter: only act on issues with the zomaid-bill sentinel.
    if (!payload.issue?.body?.includes("<!-- zomaid-bill -->")) {
      return NextResponse.json({ ok: true, ignored: "not a zomaid-bill issue" });
    }
    const issueNumber = payload.issue.number;
    const commentBody = payload.comment?.body ?? "";
    const supabase = createServiceClient();

    // Look up the bill by issue_number.
    const { data: bill, error: lookupErr } = await supabase
      .from("bills")
      .select("id, status, github_issue_number")
      .eq("github_issue_number", issueNumber)
      .maybeSingle();
    if (lookupErr) {
      return NextResponse.json({ error: lookupErr.message }, { status: 500 });
    }
    if (!bill) {
      return NextResponse.json({ ok: true, ignored: "no matching bill" });
    }
    // Idempotency: if already processed, no-op.
    if (bill.status === "processed") {
      return NextResponse.json({ ok: true, idempotent: true });
    }

    // Skip our own completion comments (start with ✅).
    if (commentBody.trim().startsWith("✅")) {
      return NextResponse.json({ ok: true, ignored: "completion comment" });
    }

    // Extract + validate JSON.
    const raw = extractJsonBlock(commentBody);
    if (raw === null) {
      await supabase
        .from("bills")
        .update({ status: "failed", status_reason: "Claude response missing JSON block" })
        .eq("id", bill.id);
      return NextResponse.json({ ok: true, failed: "missing JSON" });
    }
    const parsed = PayloadSchema.safeParse(raw);
    if (!parsed.success) {
      await supabase
        .from("bills")
        .update({ status: "failed", status_reason: "JSON schema invalid: " + parsed.error.message.slice(0, 200) })
        .eq("id", bill.id);
      return NextResponse.json({ ok: true, failed: "schema invalid" });
    }

    // Ingest atomically.
    const { error: ingestErr } = await supabase.rpc("ingest_bill_ocr", {
      p_bill_id: bill.id,
      p_payload: parsed.data as unknown as Record<string, unknown>,
    });
    if (ingestErr) {
      await supabase
        .from("bills")
        .update({ status: "failed", status_reason: "ingest_bill_ocr error: " + ingestErr.message.slice(0, 200) })
        .eq("id", bill.id);
      return NextResponse.json({ error: ingestErr.message }, { status: 500 });
    }

    // Close the issue (best-effort).
    try {
      await closeBillIssue({
        issueNumber,
        completionComment: `✅ Processed → bill \`${bill.id}\``,
      });
    } catch { /* ignore */ }

    return NextResponse.json({ ok: true, processed: bill.id });
  }
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean.

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/api/webhooks/github/route.ts
  git commit -m "$(cat <<'EOF'
  Add /api/webhooks/github handler for bill-OCR ingest

  Verifies HMAC, filters to zomaid-bill issues, extracts the JSON code block
  from Claude's comment, validates with Zod, calls ingest_bill_ocr atomically,
  and closes the issue on success. Marks bill as 'failed' (with reason) on
  parse/schema errors.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 9: UI components for bills

**Files:**

- Create: `src/components/bills/status-badge.tsx`
- Create: `src/components/bills/bill-card.tsx`
- Create: `src/components/bills/bill-detail-header.tsx`
- Create: `src/components/bills/line-item-row.tsx`
- Create: `src/components/bills/line-item-editor.tsx`
- Create: `src/components/bills/upload-form.tsx`
- Create: `src/components/bills/manual-entry-form.tsx`

- [ ] **Step 1: Write `status-badge.tsx`**

  ```tsx
  import { cn } from "@/lib/utils";

  export type BillStatus = "pending" | "processing" | "processed" | "failed";

  const LABEL: Record<BillStatus, string> = {
    pending: "Pending",
    processing: "Processing",
    processed: "Processed",
    failed: "Failed",
  };

  const CLS: Record<BillStatus, string> = {
    pending:    "bg-muted text-muted-foreground",
    processing: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    processed:  "bg-green-500/15 text-green-400 border-green-500/30",
    failed:     "bg-red-500/15 text-red-400 border-red-500/30",
  };

  export function StatusBadge({ status }: { status: BillStatus }) {
    return (
      <span className={cn("inline-flex items-center rounded-full border border-transparent px-2 py-0.5 text-xs font-medium", CLS[status])}>
        {LABEL[status]}
      </span>
    );
  }
  ```

- [ ] **Step 2: Write `bill-card.tsx`**

  ```tsx
  import Link from "next/link";
  import { Card, CardContent } from "@/components/ui/card";
  import { StatusBadge, type BillStatus } from "./status-badge";

  export type BillCardProps = {
    id: string;
    status: BillStatus;
    storeName: string | null;
    billDate: string | null;
    totalAmount: number | null;
    currency: string;
    createdAt: string;
  };

  export function BillCard(p: BillCardProps) {
    return (
      <Link href={`/bills/${p.id}`}>
        <Card className="hover:bg-muted/50">
          <CardContent className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{p.storeName ?? "Awaiting OCR…"}</div>
              <div className="text-xs text-muted-foreground">
                {p.billDate ?? "—"}
                {p.totalAmount !== null ? ` · ${p.currency} ${p.totalAmount.toFixed(2)}` : ""}
                {` · uploaded ${new Date(p.createdAt).toLocaleDateString("en-SG")}`}
              </div>
            </div>
            <StatusBadge status={p.status} />
          </CardContent>
        </Card>
      </Link>
    );
  }
  ```

- [ ] **Step 3: Write `bill-detail-header.tsx`**

  ```tsx
  import { StatusBadge, type BillStatus } from "./status-badge";

  export type BillDetailHeaderProps = {
    status: BillStatus;
    statusReason: string | null;
    storeName: string | null;
    billDate: string | null;
    totalAmount: number | null;
    currency: string;
    githubIssueUrl: string | null;
  };

  export function BillDetailHeader(p: BillDetailHeaderProps) {
    return (
      <header className="border-b border-border px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">{p.storeName ?? "Awaiting OCR…"}</h1>
          <StatusBadge status={p.status} />
        </div>
        <div className="text-sm text-muted-foreground">
          {p.billDate ?? "—"}
          {p.totalAmount !== null ? ` · ${p.currency} ${p.totalAmount.toFixed(2)}` : ""}
        </div>
        {p.statusReason && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive">
            {p.statusReason}
          </p>
        )}
        {p.githubIssueUrl && (
          <a
            href={p.githubIssueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground underline hover:no-underline"
          >
            See ticket
          </a>
        )}
      </header>
    );
  }
  ```

- [ ] **Step 4: Write `line-item-row.tsx`**

  ```tsx
  "use client";
  import { useState } from "react";
  import { Button } from "@/components/ui/button";

  export type LineItem = {
    id: string;
    position: number;
    item_name: string;
    quantity: number | null;
    unit: string | null;
    unit_price: number | null;
    line_total: number | null;
    matchedShoppingItemName: string | null;
  };

  export type LineItemRowProps = {
    item: LineItem;
    readOnly: boolean;
    onEdit?: () => void;
    onDelete?: () => void;
  };

  export function LineItemRow({ item, readOnly, onEdit, onDelete }: LineItemRowProps) {
    const [confirmDelete, setConfirmDelete] = useState(false);
    const meta: string[] = [];
    if (item.quantity !== null && item.unit) meta.push(`${item.quantity} ${item.unit}`);
    else if (item.quantity !== null) meta.push(String(item.quantity));
    else if (item.unit) meta.push(item.unit);
    if (item.line_total !== null) meta.push(`SGD ${item.line_total.toFixed(2)}`);

    return (
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{item.item_name}</div>
          <div className="text-xs text-muted-foreground">{meta.join(" · ") || " "}</div>
          {item.matchedShoppingItemName && (
            <div className="mt-1 inline-block rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] uppercase">
              marked “{item.matchedShoppingItemName}” bought
            </div>
          )}
        </div>
        {!readOnly && (
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="outline" type="button" onClick={onEdit}>Edit</Button>
            {confirmDelete ? (
              <>
                <Button size="sm" variant="ghost" type="button" onClick={() => setConfirmDelete(false)}>No</Button>
                <Button size="sm" variant="destructive" type="button" onClick={() => { setConfirmDelete(false); onDelete?.(); }}>Yes</Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" type="button" onClick={() => setConfirmDelete(true)}>×</Button>
            )}
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 5: Write `line-item-editor.tsx`**

  ```tsx
  "use client";
  import { useState, useTransition } from "react";
  import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { updateBillLineItem } from "@/app/bills/actions";

  export type LineItemEditorProps = {
    lineItemId: string;
    initial: { name: string; quantity: number | null; unit: string | null; unit_price: number | null; line_total: number | null };
    open: boolean;
    onOpenChange: (open: boolean) => void;
  };

  export function LineItemEditor(p: LineItemEditorProps) {
    const [name, setName] = useState(p.initial.name);
    const [quantity, setQuantity] = useState(p.initial.quantity?.toString() ?? "");
    const [unit, setUnit] = useState(p.initial.unit ?? "");
    const [unitPrice, setUnitPrice] = useState(p.initial.unit_price?.toString() ?? "");
    const [lineTotal, setLineTotal] = useState(p.initial.line_total?.toString() ?? "");
    const [error, setError] = useState<string | null>(null);
    const [pending, start] = useTransition();

    const save = () => {
      setError(null);
      start(async () => {
        const res = await updateBillLineItem({
          lineItemId: p.lineItemId,
          name: name.trim() || undefined,
          quantity: quantity ? Number(quantity) : null,
          unit: unit.trim() || null,
          unitPrice: unitPrice ? Number(unitPrice) : null,
          lineTotal: lineTotal ? Number(lineTotal) : null,
        });
        if (!res.ok) { setError(res.error.message); return; }
        p.onOpenChange(false);
      });
    };

    return (
      <Sheet open={p.open} onOpenChange={p.onOpenChange}>
        <SheetContent side="bottom">
          <SheetHeader><SheetTitle>Edit line item</SheetTitle></SheetHeader>
          <div className="flex flex-col gap-3 py-4">
            <div>
              <Label htmlFor="li-name">Name</Label>
              <Input id="li-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </div>
            <div className="grid grid-cols-[1fr_1fr] gap-2">
              <div>
                <Label htmlFor="li-qty">Quantity</Label>
                <Input id="li-qty" type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="li-unit">Unit</Label>
                <Input id="li-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={24} />
              </div>
            </div>
            <div className="grid grid-cols-[1fr_1fr] gap-2">
              <div>
                <Label htmlFor="li-unit-price">Unit price</Label>
                <Input id="li-unit-price" type="number" min="0" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="li-line-total">Line total</Label>
                <Input id="li-line-total" type="number" min="0" step="0.01" value={lineTotal} onChange={(e) => setLineTotal(e.target.value)} />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="button" onClick={save} disabled={pending || !name.trim()}>Save</Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }
  ```

- [ ] **Step 6: Write `upload-form.tsx`**

  ```tsx
  "use client";
  import { useState, useTransition } from "react";
  import { useRouter } from "next/navigation";
  import imageCompression from "browser-image-compression";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { uploadBill } from "@/app/bills/actions";

  export function UploadForm() {
    const router = useRouter();
    const [file, setFile] = useState<File | null>(null);
    const [storeHint, setStoreHint] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [pending, start] = useTransition();
    const [phase, setPhase] = useState<"idle" | "compressing" | "submitting">("idle");

    async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
      const f = e.target.files?.[0];
      if (!f) return;
      setError(null);
      setPhase("compressing");
      try {
        const compressed = await imageCompression(f, { maxSizeMB: 2, maxWidthOrHeight: 2400, useWebWorker: true });
        setFile(compressed);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Compression failed");
      } finally {
        setPhase("idle");
      }
    }

    function submit(e: React.FormEvent) {
      e.preventDefault();
      if (!file) { setError("Pick an image first."); return; }
      setError(null);
      start(async () => {
        setPhase("submitting");
        try {
          const fd = new FormData();
          fd.append("file", file);
          if (storeHint.trim()) fd.append("storeHint", storeHint.trim());
          const res = await uploadBill(fd);
          if (!res.ok) { setError(res.error.message); return; }
          router.push(`/bills/${res.data.billId}`);
        } finally {
          setPhase("idle");
        }
      });
    }

    return (
      <form className="mx-auto max-w-md space-y-4 p-4" onSubmit={submit}>
        <div>
          <Label htmlFor="bill-file">Receipt photo</Label>
          <input
            id="bill-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={onFileChange}
            disabled={pending}
          />
        </div>
        <div>
          <Label htmlFor="bill-hint">Store hint (optional)</Label>
          <Input id="bill-hint" value={storeHint} onChange={(e) => setStoreHint(e.target.value)} placeholder="e.g., NTUC Tampines" maxLength={200} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending || !file || phase !== "idle"}>
          {phase === "compressing" ? "Compressing…" : phase === "submitting" ? "Uploading…" : "Upload bill"}
        </Button>
      </form>
    );
  }
  ```

- [ ] **Step 7: Write `manual-entry-form.tsx`**

  ```tsx
  "use client";
  import { useState, useTransition } from "react";
  import { useRouter } from "next/navigation";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { markBillManuallyProcessed } from "@/app/bills/actions";

  export type ManualEntryFormProps = { billId: string };

  type LineDraft = { item_name: string; quantity: number | null; unit: string | null; unit_price: number | null; line_total: number | null };

  export function ManualEntryForm({ billId }: ManualEntryFormProps) {
    const router = useRouter();
    const [storeName, setStoreName] = useState("");
    const [billDate, setBillDate] = useState("");
    const [total, setTotal] = useState("");
    const [lines, setLines] = useState<LineDraft[]>([
      { item_name: "", quantity: null, unit: null, unit_price: null, line_total: null },
    ]);
    const [error, setError] = useState<string | null>(null);
    const [pending, start] = useTransition();

    function submit(e: React.FormEvent) {
      e.preventDefault();
      const filtered = lines.filter((l) => l.item_name.trim().length > 0);
      if (filtered.length === 0) { setError("Add at least one line item."); return; }
      setError(null);
      start(async () => {
        const res = await markBillManuallyProcessed({
          billId,
          storeName: storeName.trim() || null,
          billDate: billDate || null,
          totalAmount: total ? Number(total) : null,
          lineItems: filtered.map((l) => ({
            item_name: l.item_name.trim(),
            quantity: l.quantity,
            unit: l.unit,
            unit_price: l.unit_price,
            line_total: l.line_total,
          })),
        });
        if (!res.ok) { setError(res.error.message); return; }
        router.refresh();
      });
    }

    return (
      <form className="space-y-4 px-4 py-4" onSubmit={submit}>
        <div className="grid grid-cols-[1fr_1fr] gap-2">
          <div>
            <Label htmlFor="me-store">Store</Label>
            <Input id="me-store" value={storeName} onChange={(e) => setStoreName(e.target.value)} maxLength={200} />
          </div>
          <div>
            <Label htmlFor="me-date">Date</Label>
            <Input id="me-date" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="me-total">Total (SGD)</Label>
          <Input id="me-total" type="number" min="0" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Line items</legend>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_5rem_6rem_2rem] gap-2">
              <Input placeholder="Item" value={l.item_name} onChange={(e) => setLines(lines.map((x, idx) => idx === i ? { ...x, item_name: e.target.value } : x))} />
              <Input placeholder="Qty" type="number" value={l.quantity ?? ""} onChange={(e) => setLines(lines.map((x, idx) => idx === i ? { ...x, quantity: e.target.value ? Number(e.target.value) : null } : x))} />
              <Input placeholder="Unit" value={l.unit ?? ""} onChange={(e) => setLines(lines.map((x, idx) => idx === i ? { ...x, unit: e.target.value || null } : x))} />
              <Input placeholder="Line total" type="number" step="0.01" value={l.line_total ?? ""} onChange={(e) => setLines(lines.map((x, idx) => idx === i ? { ...x, line_total: e.target.value ? Number(e.target.value) : null } : x))} />
              <Button type="button" variant="ghost" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>×</Button>
            </div>
          ))}
          <Button type="button" variant="outline" onClick={() => setLines([...lines, { item_name: "", quantity: null, unit: null, unit_price: null, line_total: null }])}>+ Add line</Button>
        </fieldset>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending}>Mark processed</Button>
      </form>
    );
  }
  ```

- [ ] **Step 8: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean.

- [ ] **Step 9: Commit**

  ```bash
  git add src/components/bills
  git commit -m "$(cat <<'EOF'
  Add bills UI components (badge, card, header, line item row + editor, upload + manual-entry forms)

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 10: Pages `/bills`, `/bills/new`, `/bills/[id]`

**Files:**

- Create: `src/app/bills/page.tsx`
- Create: `src/app/bills/new/page.tsx`
- Create: `src/app/bills/[id]/page.tsx`

- [ ] **Step 1: Write `/bills/page.tsx`**

  ```tsx
  import Link from "next/link";
  import { requireHousehold } from "@/lib/auth/require";
  import { createClient } from "@/lib/supabase/server";
  import { Button } from "@/components/ui/button";
  import { MainNav } from "@/components/site/main-nav";
  import { BillCard } from "@/components/bills/bill-card";

  export default async function BillsIndex() {
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { data } = await supabase
      .from("bills")
      .select("id, status, store_name, bill_date, total_amount, currency, created_at")
      .eq("household_id", ctx.household.id)
      .order("created_at", { ascending: false });
    const bills = data ?? [];

    return (
      <main className="mx-auto max-w-md">
        <MainNav active="bills" />
        <header className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h1 className="text-lg font-semibold">Bills</h1>
          <Link href="/bills/new"><Button size="sm">+ New</Button></Link>
        </header>
        {bills.length === 0 && (
          <p className="px-4 py-12 text-center text-muted-foreground">
            No bills yet. <Link href="/bills/new" className="underline">Upload one</Link>.
          </p>
        )}
        <div className="flex flex-col gap-2 p-3">
          {bills.map((b) => (
            <BillCard
              key={b.id}
              id={b.id}
              status={b.status}
              storeName={b.store_name}
              billDate={b.bill_date}
              totalAmount={b.total_amount}
              currency={b.currency}
              createdAt={b.created_at}
            />
          ))}
        </div>
      </main>
    );
  }
  ```

- [ ] **Step 2: Write `/bills/new/page.tsx`**

  ```tsx
  import { requireHousehold } from "@/lib/auth/require";
  import { MainNav } from "@/components/site/main-nav";
  import { UploadForm } from "@/components/bills/upload-form";

  export default async function NewBillPage() {
    await requireHousehold();
    return (
      <main className="mx-auto max-w-md">
        <MainNav active="bills" />
        <header className="border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">Upload bill</h1>
        </header>
        <UploadForm />
      </main>
    );
  }
  ```

- [ ] **Step 3: Write `/bills/[id]/page.tsx`**

  ```tsx
  import { notFound } from "next/navigation";
  import { requireHousehold } from "@/lib/auth/require";
  import { createClient } from "@/lib/supabase/server";
  import { MainNav } from "@/components/site/main-nav";
  import { BillDetailHeader } from "@/components/bills/bill-detail-header";
  import { LineItemRow } from "@/components/bills/line-item-row";
  import { BillDetailActions } from "@/components/bills/_detail-actions";

  export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const ctx = await requireHousehold();
    const supabase = await createClient();
    const { data: bill } = await supabase
      .from("bills")
      .select("id, household_id, status, status_reason, store_name, bill_date, total_amount, currency, image_storage_path, github_issue_url")
      .eq("id", id)
      .maybeSingle();
    if (!bill) notFound();

    const { data: lines } = await supabase
      .from("bill_line_items")
      .select("id, position, item_name, quantity, unit, unit_price, line_total, matched_shopping_item_id, shopping_list_items!matched_shopping_item_id(item_name)")
      .eq("bill_id", id)
      .order("position");

    const items = (lines ?? []).map((l: any) => ({
      id: l.id,
      position: l.position,
      item_name: l.item_name,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: l.unit_price,
      line_total: l.line_total,
      matchedShoppingItemName: Array.isArray(l.shopping_list_items)
        ? (l.shopping_list_items[0]?.item_name ?? null)
        : (l.shopping_list_items?.item_name ?? null),
    }));

    const readOnly = ctx.membership.role === "family_member";

    let imageUrl: string | null = null;
    const signed = await supabase.storage
      .from("bill-images")
      .createSignedUrl(bill.image_storage_path, 3600);
    imageUrl = signed.data?.signedUrl ?? null;

    return (
      <main className="mx-auto max-w-md">
        <MainNav active="bills" />
        <BillDetailHeader
          status={bill.status}
          statusReason={bill.status_reason}
          storeName={bill.store_name}
          billDate={bill.bill_date}
          totalAmount={bill.total_amount}
          currency={bill.currency}
          githubIssueUrl={bill.github_issue_url}
        />
        {imageUrl && (
          <div className="border-b border-border px-4 py-3">
            <img src={imageUrl} alt="Bill" className="max-h-96 w-full rounded-md object-contain" />
          </div>
        )}
        {bill.status === "failed" && !readOnly && (
          <BillDetailActions billId={bill.id} mode="failed" />
        )}
        {bill.status === "processing" && (
          <p className="px-4 py-6 text-center text-muted-foreground">
            Waiting for Claude to process the receipt — usually under 5 minutes.
          </p>
        )}
        {items.length > 0 && (
          <section>
            <h2 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Line items</h2>
            <BillDetailActions billId={bill.id} mode="processed" items={items} readOnly={readOnly} />
          </section>
        )}
      </main>
    );
  }
  ```

  Create the small client wrapper `src/components/bills/_detail-actions.tsx` that hosts the editor state:

  ```tsx
  "use client";
  import { useState } from "react";
  import { Button } from "@/components/ui/button";
  import { LineItemRow, type LineItem } from "./line-item-row";
  import { LineItemEditor } from "./line-item-editor";
  import { ManualEntryForm } from "./manual-entry-form";
  import { retryBill } from "@/app/bills/actions";

  type Props =
    | { billId: string; mode: "failed" }
    | { billId: string; mode: "processed"; items: LineItem[]; readOnly: boolean };

  export function BillDetailActions(p: Props) {
    const [editTarget, setEditTarget] = useState<LineItem | null>(null);
    if (p.mode === "failed") {
      return (
        <section className="border-t border-border">
          <div className="px-4 py-3 flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => retryBill({ billId: p.billId })}
            >
              Retry OCR
            </Button>
          </div>
          <h2 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Or enter line items manually
          </h2>
          <ManualEntryForm billId={p.billId} />
        </section>
      );
    }
    return (
      <>
        <div>
          {p.items.map((it) => (
            <LineItemRow
              key={it.id}
              item={it}
              readOnly={p.readOnly}
              onEdit={() => setEditTarget(it)}
            />
          ))}
        </div>
        {editTarget && (
          <LineItemEditor
            lineItemId={editTarget.id}
            initial={{
              name: editTarget.item_name,
              quantity: editTarget.quantity,
              unit: editTarget.unit,
              unit_price: editTarget.unit_price,
              line_total: editTarget.line_total,
            }}
            open={editTarget !== null}
            onOpenChange={(open) => {
              if (!open) setEditTarget(null);
            }}
          />
        )}
      </>
    );
  }
  ```

- [ ] **Step 4: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean. If the joined `shopping_list_items` shape trips TS, narrow with `as any` for the inner field (slice 2a Task 16 used this pattern for `r.recipes` join inference).

- [ ] **Step 5: Commit**

  ```bash
  git add src/app/bills src/components/bills/_detail-actions.tsx
  git commit -m "$(cat <<'EOF'
  Add /bills, /bills/new, /bills/[id] pages

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 11: MainNav → 4 links + proxy gate `/bills`

**Files:**

- Modify: `src/components/site/main-nav.tsx`
- Modify: `src/proxy.ts`

- [ ] **Step 1: Update `MainNav` to include Bills**

  Open `src/components/site/main-nav.tsx`. Find the `links` array and the `Route` type. Update both:

  ```tsx
  type Route = "plan" | "recipes" | "shopping" | "bills";

  // ...

  const links: { route: Route; href: string; label: string }[] = [
    { route: "plan",     href: "/plan",     label: "Plan" },
    { route: "recipes",  href: "/recipes",  label: "Recipes" },
    { route: "shopping", href: "/shopping", label: "Shopping" },
    { route: "bills",    href: "/bills",    label: "Bills" },
  ];
  ```

- [ ] **Step 2: Gate `/bills(.*)` in `proxy.ts`**

  Open `src/proxy.ts`. Add `"/bills(.*)"` to `isAuthGated`:

  ```ts
  const isAuthGated = createRouteMatcher([
    "/dashboard(.*)",
    "/household(.*)",
    "/onboarding(.*)",
    "/plan(.*)",
    "/recipes(.*)",
    "/shopping(.*)",
    "/bills(.*)",
  ]);
  ```

  Also add the webhook to `isPublic` so unauthenticated POSTs from GitHub aren't blocked:

  ```ts
  const isPublic = createRouteMatcher([
    "/",
    "/sign-in(.*)",
    "/sign-up(.*)",
    "/join/(.*)",
    "/api/webhooks/(.*)",
  ]);
  ```

  (The webhook path `/api/webhooks/github` matches `/api/webhooks/(.*)`. Foundations already had this. Confirm it's there and leave as-is.)

- [ ] **Step 3: Typecheck**

  ```bash
  pnpm typecheck
  ```

  Expected: clean.

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/site/main-nav.tsx src/proxy.ts
  git commit -m "$(cat <<'EOF'
  Add Bills to MainNav (4 links) and gate /bills(.*) in proxy

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 12: Playwright smoke for `/bills`

**Files:**

- Create: `tests/e2e/bills.spec.ts`

- [ ] **Step 1: Write the smoke**

  ```ts
  import { test, expect } from "@playwright/test";

  test.describe("slice 3 smoke (unauthenticated)", () => {
    test("/bills redirects unauthenticated users to /", async ({ page }) => {
      await page.goto("/bills");
      await expect(page).toHaveURL("http://localhost:3000/");
    });
  });
  ```

- [ ] **Step 2: Run the full E2E suite**

  ```bash
  pnpm test:e2e 2>&1 | tail -10
  ```

  Expected: all foundations + slice 2a + 2b tests still pass, plus the new slice 3 test (2 projects = 2 new passes). Skipped count unchanged at 2.

- [ ] **Step 3: Commit**

  ```bash
  git add tests/e2e/bills.spec.ts
  git commit -m "$(cat <<'EOF'
  Add Playwright smoke for /bills route gating

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 13: HANDOFF update + final verification

**Files:**

- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Final local verification gate**

  ```bash
  pnpm db:reset && pnpm typecheck && pnpm test tests/db && pnpm test:e2e
  ```

  Expected:
  - `pnpm db:reset`: all 21 migrations apply (7 foundations + 9 slice 2a + 2 slice 2b + 3 slice 3).
  - `pnpm typecheck`: clean.
  - `pnpm test tests/db`: 18 passing (no slice 3 DB tests added per "skip tests" instruction).
  - `pnpm test:e2e`: 14 pass (12 prior + 2 slice 3 chromium/mobile) + 2 expected skips.

- [ ] **Step 2: Manual walkthrough**

  Interactive in the browser (`pnpm dev`). Requires pre-flight A–F complete + a real shopping receipt photo.

  1. Sign in as owner. Visit `/dashboard` → click any nav link → confirm the 4-link nav (Plan · Recipes · Shopping · Bills) shows with the right link highlighted.
  2. Click **Bills**. Empty state shows.
  3. Click **+ New**. Pick a photo of a real grocery receipt. Submit. Lands on `/bills/<id>` with status `processing` and a "Waiting for Claude…" message. GitHub link works.
  4. Open the GitHub issue in a new tab. Confirm the body has the `<!-- zomaid-bill -->` sentinel, the bill ID, the image (signed URL — clicking should load the image), and the `@claude` prompt.
  5. Wait 30 s – 3 min. Claude posts a comment with a JSON code block. The webhook fires; refresh `/bills/<id>`. Status is now `processed`; store name + date + total + line items appear.
  6. Visit `/shopping`. Confirm any line items that fuzzy-matched existing unbought items now show as **bought** (strikethrough, in the "Show bought" section).
  7. Add a recognizable item to `/shopping` (e.g., "milk"). Re-upload a receipt that has "Fresh Milk 1L". Wait. Confirm the milk item is auto-matched and marked bought.
  8. Force a failure: upload a non-receipt image (a photo of a tree). After Claude responds with no JSON, refresh `/bills/<id>`. Status is `failed`, reason mentions "missing JSON" or similar. Click **Enter line items manually** — fill the form, submit. Status flips to `processed`; line items appear.
  9. Sign in as a family member. Visit `/bills`. Click into a bill. Confirm: no **+ New** button, no **Edit**/**×** on line items, no **Retry OCR**/manual-entry form for failed bills.

- [ ] **Step 3: Update `docs/HANDOFF.md`**

  Append a new section under "Status" after slice 2b's section:

  ```markdown
  ### Done — Slice 3 (Bill scanning via GitHub-mediated Claude OCR)

  Spec: [`docs/specs/2026-05-11-slice-3-bill-scanning-ocr-design.md`](specs/2026-05-11-slice-3-bill-scanning-ocr-design.md). Plan: [`docs/plans/2026-05-11-slice-3-bill-scanning-ocr.md`](plans/2026-05-11-slice-3-bill-scanning-ocr.md). 13 tasks executed via `superpowers:subagent-driven-development`.

  - **Pre-flight done by user:** Claude Code GitHub Action installed on the repo, GITHUB_TOKEN PAT, GITHUB_WEBHOOK_SECRET, webhook registered on the repo (issue_comment events).
  - **Migrations (3):** `20260528_001_bills_and_line_items.sql` (tables + bill_status enum + RLS), `20260529_001_bill_images_storage.sql` (Storage bucket + RLS), `20260530_001_ingest_bill_ocr_fn.sql` (atomic ingest with fuzzy-match-and-link).
  - **Libs:** `src/lib/github/issues.ts` (REST client), `src/lib/supabase/service.ts` (service-role client for the webhook).
  - **Server actions:** `src/app/bills/actions.ts` — `uploadBill`, `updateBillLineItem`, `deleteBill`, `retryBill`, `markBillManuallyProcessed`.
  - **Webhook:** `src/app/api/webhooks/github/route.ts` — HMAC-verified `issue_comment.created` handler; ingests via `ingest_bill_ocr` RPC; closes the issue.
  - **UI:** `/bills` (list), `/bills/new` (upload), `/bills/[id]` (detail with header + image + line items + per-row edit + failed-state manual-entry fallback). MainNav now 4 links.
  - **Proxy:** `/bills(.*)` added to gated routes.
  - **Family is read-only.** Upload, retry, manual-entry, line-item edit/delete all hidden for `family_member` role.

  Verified locally on 2026-MM-DD: full E2E suite green (14 passed + 2 expected skips). Manual walkthrough also exercised.
  ```

  Add a "Deferred from slice 3" block:

  ```markdown
  ### Deferred from slice 3

  - **All vitest tests** (DB + action + webhook coverage) — per the ongoing "skip tests" instruction.
  - **Long-stuck bills auto-flip to failed**: v1 relies on the user retrying manually.
  - **Bill image deletion / retention policy**: bills persist indefinitely.
  - **Manual link/unlink** of bill_line_items ↔ shopping_list_items beyond editing names.
  - **Dedupe of same-bill duplicates.**
  - **GitHub App + installation token** (instead of long-lived PAT).
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add docs/HANDOFF.md
  git commit -m "$(cat <<'EOF'
  Update HANDOFF for slice 3 completion

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

- [ ] `pnpm db:reset && pnpm typecheck && pnpm test tests/db && pnpm test:e2e` all green.
- [ ] `pnpm build` completes cleanly.
- [ ] **Manual walkthrough** in Task 13 Step 2 complete with a real bill.
- [ ] **Push** complete.

When all four are checked, slice 3 is ready to call done.
