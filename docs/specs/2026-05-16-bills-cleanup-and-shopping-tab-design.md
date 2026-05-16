# Zomaid — Bills Cleanup + Shopping "Bills" Tab — Design

> **Superseded as the living architecture doc for the shopping area by [`features/shopping.md`](features/shopping.md).** This dated spec is retained for historical context.

- **Date**: 2026-05-16
- **Status**: Approved — implementing in same session
- **Scope**: Retire the legacy GitHub-Issues OCR pipeline now that [`/inventory/new`'s "Upload bill" tab](../../src/app/inventory/new/_bill-form.tsx) (shipped in `16c03b2`) is the canonical bill-capture entry point. Remove the standalone `/bills` index and `/bills/new` upload, remove the `Bills` link from the main nav, and surface the list of household bills as a new "Bills" tab on [`/shopping`](../../src/app/shopping/page.tsx). The detail page at `/bills/[id]` stays exactly as-is — it's the redirect target from both the new scan flow and the new shopping tab.

## 1. Context

The previous flow created a `bills` row, uploaded the image to Supabase Storage, opened a GitHub issue with the signed URL + an `@claude` prompt, and waited for a webhook (`/api/webhooks/github`) to ingest the JSON Claude posted back. That whole orchestration is now obsolete:

- `/inventory/new` tab #3 calls Sonnet 4.6 vision directly, shows a confirmation form, and writes `bills + bill_line_items + inventory_items` in one server action ([`uploadBillFromScan`](../../src/app/bills/actions.ts)).
- The GitHub PAT, repo coords, and webhook secret have no other consumers in this app.

Cleanup scope:

1. Delete `/bills` index page + `/bills/new`.
2. Delete the GitHub OCR helper (`src/lib/github/issues.ts`) and the webhook (`src/app/api/webhooks/github/`).
3. Prune `src/app/bills/actions.ts` to only the actions still consumed by surviving callers.
4. Remove the now-orphaned `UploadForm` + `ManualEntryForm` components.
5. Strip the four obsolete env vars from `.env.local.example`.
6. Drop the `Bills` link from the main nav.
7. Add `?view=list | bills` tabs on `/shopping`; the Bills tab lists bills sorted `bill_date desc, created_at desc` and deep-links to `/bills/[id]`.

What stays untouched:

- `/bills/[id]` page + everything it imports (header, line-item row, line-item editor, detail-actions, status-badge, inventory review queue).
- `uploadBillFromScan` server action + its sibling helpers (`ingestBillLineItem`, `skipBillLineItem`, `unskipBillLineItem`, `updateBillLineItem`, `deleteBill`) — all reachable from `/bills/[id]`.
- The `BillCard` component — reusable in the new shopping tab.
- The DB schema (the `github_issue_number / github_issue_url` columns and the `bills` table itself stay; only the writing code goes).
- The `/bills(.*)` matcher in `src/proxy.ts` — `/bills/[id]` is still gated.

## 2. Decisions log

| Q | Decision |
|---|---|
| Where do bills live in the nav? | Nowhere directly. They surface as a tab on `/shopping`. The main nav stays at 6 entries. |
| Tab routing on `/shopping` | `?view=list` (default) and `?view=bills`. URL-driven so links are deep-linkable; client state mirrors the param. |
| Bills tab data fetch | Use the existing Supabase browser client (`useSupabaseClient`), to match the page's current architecture (it's already a client component). Lazy-fetch only when the tab is selected; cache for the lifetime of the page. |
| Row component | Reuse [`BillCard`](../../src/components/bills/bill-card.tsx) verbatim — its width and click target already match the shopping page. No refactor. |
| Empty state copy | "No bills yet. Add one from Inventory." with `Inventory` linking to `/inventory/new?mode=bill`. (The third tab on /inventory/new reads `?mode=bill` to auto-select itself.) |
| What about old bills with `status='pending'/'processing'/'failed'` and no scan-flow line items? | They keep rendering on `/bills/[id]` exactly as they did. The bills index just stops existing — old bills are still reachable via direct URL if the user has it, but the user has confirmed there are none in production worth surfacing. |
| Action pruning | Keep: `uploadBillFromScan`, `updateBillLineItem`, `deleteBill`, `ingestBillLineItem`, `skipBillLineItem`, `unskipBillLineItem`. Delete: `uploadBill`, `retryBill`, `markBillManuallyProcessed`. (Each "delete" is verified to have no callers after `UploadForm` + `ManualEntryForm` + `_detail-actions` failed-mode are removed.) |
| `_detail-actions` failed-mode branch | The `mode: "failed"` branch only existed to retry GH-issue OCR or fall back to manual entry. With both flows gone, drop the branch entirely; `/bills/[id]` will simply render no actions for a `failed` bill (the status badge + status_reason already communicate the state). |
| `bill-detail-header.tsx` `githubIssueUrl` prop | Leave the prop in place but stop passing a value. We'd otherwise have to touch a working component to no real benefit; the "See ticket" link won't render when the value is `null`. |
| `.env.local.example` | Drop `GITHUB_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`, `GITHUB_WEBHOOK_SECRET`. The four lines of header comments above them go too. |
| `tests/e2e/bills.spec.ts` smoke | Leaves `/bills` → `/` redirect assertion intact — `/bills` is no longer a route, Next 16 will 404 (or middleware redirect for unauthenticated). Rewrite the assertion to hit `/bills/00000000-0000-0000-0000-000000000000` to keep the "auth gate" smoke; the matcher in `proxy.ts` still covers it. |

## 3. File-by-file plan

### Delete

- `src/app/bills/page.tsx` — index list
- `src/app/bills/loading.tsx` — loading skeleton for index
- `src/app/bills/new/page.tsx` + the dir
- `src/lib/github/issues.ts` + the `src/lib/github/` dir
- `src/app/api/webhooks/github/route.ts` + the `src/app/api/webhooks/github/` dir
- `src/components/bills/upload-form.tsx`
- `src/components/bills/manual-entry-form.tsx`

### Edit

- `src/app/bills/actions.ts` — remove `uploadBill`, `retryBill`, `markBillManuallyProcessed`, both `github/issues` imports, the `uploadImageAndSignUrl` helper, the `PhotoConstraints` constant, and `validatePhoto`. Keep `uploadBillFromScan` + the 4 line-item actions.
- `src/components/bills/_detail-actions.tsx` — drop the `mode: "failed"` arm + the now-unused `retryBill` and `ManualEntryForm` imports. The component becomes a thin wrapper around `LineItemRow` + `LineItemEditor`.
- `src/app/bills/[id]/page.tsx` — drop the `github_issue_url` from the `.select(...)` and the `githubIssueUrl={bill.github_issue_url}` prop on the header. Drop the `mode="failed"` branch.
- `src/components/site/main-nav.tsx` — remove `"bills"` from `Route` union and the `bills` entry in the `links` array.
- `src/app/shopping/page.tsx` — restructure to tabs (see §4).
- `.env.local.example` — strip the four env vars + their section header comments.
- `tests/e2e/bills.spec.ts` — point smoke at `/bills/00000000-0000-0000-0000-000000000000`.

### Add

- `src/app/shopping/_bills-tab.tsx` — small client component that fetches bills via `useSupabaseClient`, sorts `bill_date desc, created_at desc`, renders `BillCard` rows or the empty state.

## 4. Shopping tabs

`/shopping` is already client-side (interactive checkboxes + quick-add). The tab control lives in the same component:

```tsx
const params = useSearchParams();
const router = useRouter();
const view = (params.get("view") === "bills" ? "bills" : "list") as "list" | "bills";

function setView(next: "list" | "bills") {
  const sp = new URLSearchParams(params);
  if (next === "list") sp.delete("view"); else sp.set("view", "bills");
  router.replace(`/shopping${sp.size ? `?${sp}` : ""}`, { scroll: false });
}
```

UI: pair of buttons under the header, styled with the existing `cn` + active-state pattern from `MainNav`. The currently selected tab is `font-semibold text-foreground`, the other `text-muted-foreground`.

Body:

- `view === "list"`: existing JSX (`QuickAdd`, `unbought.map`, `BoughtHistory`, `EditItemSheet`).
- `view === "bills"`: render `<BillsTab />` (the new component).

`BillsTab` does its own `useEffect` fetch on first mount and caches the result in local state so flipping between tabs doesn't refetch.

## 5. Verification

- `pnpm run typecheck` clean.
- `pnpm run lint` no new errors in touched files.
- `pnpm run build` succeeds.
- `pnpm test` → 132 tests, all green.
- `curl -I http://localhost:3000/shopping` → 307 (Clerk redirect, unauthenticated).
- `curl -I http://localhost:3000/shopping?view=bills` → 307.
- `curl -I http://localhost:3000/bills/00000000-0000-0000-0000-000000000000` → 307.
- `curl -I http://localhost:3000/bills` → 404 (deleted) and `curl -I http://localhost:3000/bills/new` → 404 (deleted).

## 6. Risks / non-goals

- **Old bills with `status='pending'`** that the GH webhook never processed will stay in that state forever. The user accepted this — they're not in production. We don't migrate them.
- **The `github_issue_number / github_issue_url` DB columns** stay because writing a migration is out of scope and they're not load-bearing for the surviving code path.
- **Failed-bill UX regression**: `/bills/[id]` for a `failed` bill no longer offers a retry button or a manual-entry form. The only path to recover a failed bill is to re-upload from `/inventory/new`. This is intentional — those flows depended on the GH pipeline that no longer exists.
