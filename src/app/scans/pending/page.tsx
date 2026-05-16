// Pending-scan queue for the caller.
//
// Lists bill_scan_attempts the caller uploaded where:
//   - status='succeeded' AND reviewed_at IS NULL  → "Ready to review"
//   - status='pending'                            → "In progress"
//   - status='failed' AND reviewed_at IS NULL     → "Couldn't read"
//
// Succeeded rows expand into the same BillConfirmForm as /inventory/new.
// Failed rows can be cancelled (stamps reviewed_at).
//
// Linked from the /inventory/new bill tab's queued-notice banner and
// from the inventory-tab dot badge in the main nav.

import { requireHousehold } from "@/lib/auth/require";
import { createServiceClient } from "@/lib/supabase/service";
import { MainNav } from "@/components/site/main-nav";
import { BILL_SCAN_BUCKET } from "@/app/api/bills/scan/_storage";
import type { ParsedBill } from "@/app/api/bills/scan/_parse";
import type { ConfirmFormInitial } from "@/components/bills/bill-confirm-form";
import { SucceededAttemptCard } from "./_review-card";
import { FailedAttemptCard } from "./_failed-card";

const SIGNED_URL_TTL_SECONDS = 60 * 10; // 10 minutes — refresh on revisit

type AttemptRow = {
  id: string;
  household_id: string;
  status: "pending" | "succeeded" | "failed";
  attempts: number;
  storage_path: string;
  last_error: string | null;
  reviewed_at: string | null;
  parsed_payload: unknown;
  created_at: string;
};

export default async function PendingScansPage() {
  const ctx = await requireHousehold();
  const svc = createServiceClient();

  const { data: rows, error } = await svc
    .from("bill_scan_attempts")
    .select(
      "id, household_id, status, attempts, storage_path, last_error, reviewed_at, parsed_payload, created_at",
    )
    .eq("uploaded_by_profile_id", ctx.profile.id)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="mx-auto max-w-md">
        <MainNav active="inventory" />
        <header className="px-4 py-3">
          <h1 className="text-lg font-semibold">Pending scans</h1>
        </header>
        <p className="px-4 py-6 text-sm text-destructive">
          Couldn&apos;t load your scans: {error.message}
        </p>
      </main>
    );
  }

  const all = (rows ?? []) as AttemptRow[];
  const succeeded = all.filter(
    (r) => r.status === "succeeded" && r.reviewed_at === null,
  );
  const pending = all.filter((r) => r.status === "pending");
  const failed = all.filter(
    (r) => r.status === "failed" && r.reviewed_at === null,
  );

  // Mint signed URLs in batch for the rows we'll render thumbnails for.
  const pathsToSign = [...succeeded, ...failed].map((r) => r.storage_path);
  const signedUrls = new Map<string, string>();
  if (pathsToSign.length > 0) {
    const { data: signed } = await svc.storage
      .from(BILL_SCAN_BUCKET)
      .createSignedUrls(pathsToSign, SIGNED_URL_TTL_SECONDS);
    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) signedUrls.set(s.path, s.signedUrl);
    }
  }

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="inventory" />
      <header className="px-4 py-3">
        <h1 className="text-lg font-semibold">Pending scans</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Bill scans that need attention. Successful retries land here for you
          to review before they become a bill.
        </p>
      </header>

      {all.length === 0 && (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          No pending scans. When a bill scan needs to be retried, it&apos;ll show up here.
        </p>
      )}

      {succeeded.length > 0 && (
        <Section title={`Ready to review · ${succeeded.length}`}>
          {succeeded.map((r) => (
            <SucceededAttemptCard
              key={r.id}
              attemptId={r.id}
              thumbnailUrl={signedUrls.get(r.storage_path) ?? null}
              uploadedAt={r.created_at}
              initial={normaliseParsed(r.parsed_payload)}
            />
          ))}
        </Section>
      )}

      {pending.length > 0 && (
        <Section title={`In progress · ${pending.length}`}>
          {pending.map((r) => (
            <div
              key={r.id}
              className="rounded border border-dashed p-3 text-sm text-muted-foreground"
            >
              <p className="font-medium text-foreground">Retrying…</p>
              <p className="mt-1 text-xs">
                Uploaded {new Date(r.created_at).toLocaleString()} ·{" "}
                {r.attempts} attempt{r.attempts === 1 ? "" : "s"}
              </p>
              {r.last_error && (
                <p className="mt-1 text-xs">Last error: {r.last_error}</p>
              )}
            </div>
          ))}
        </Section>
      )}

      {failed.length > 0 && (
        <Section title={`Couldn't read · ${failed.length}`}>
          {failed.map((r) => (
            <FailedAttemptCard
              key={r.id}
              attemptId={r.id}
              thumbnailUrl={signedUrls.get(r.storage_path) ?? null}
              uploadedAt={r.created_at}
              lastError={r.last_error}
              attempts={r.attempts}
            />
          ))}
        </Section>
      )}
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 px-4 py-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

// parsed_payload is stored as jsonb — narrow it back to the ConfirmFormInitial
// shape the client component expects. Empty / malformed payloads produce
// the empty bill shape so the form still renders rather than crashing.
function normaliseParsed(raw: unknown): ConfirmFormInitial {
  const empty: ConfirmFormInitial = {
    store_name: null,
    bill_date: null,
    currency: null,
    total_amount: null,
    items: [],
  };
  if (raw === null || typeof raw !== "object") return empty;
  const p = raw as Partial<ParsedBill>;
  return {
    store_name: typeof p.store_name === "string" ? p.store_name : null,
    bill_date: typeof p.bill_date === "string" ? p.bill_date : null,
    currency: typeof p.currency === "string" ? p.currency : null,
    total_amount: typeof p.total_amount === "number" ? p.total_amount : null,
    items: Array.isArray(p.items)
      ? p.items.map((it) => ({
          item_name: typeof it.item_name === "string" ? it.item_name : "",
          quantity: typeof it.quantity === "number" ? it.quantity : null,
          unit:
            it.unit === "kg" ||
            it.unit === "g" ||
            it.unit === "l" ||
            it.unit === "ml" ||
            it.unit === "piece"
              ? it.unit
              : null,
          price: typeof it.price === "number" ? it.price : null,
        }))
      : [],
  };
}
