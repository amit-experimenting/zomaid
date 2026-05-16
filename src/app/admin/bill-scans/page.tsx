// Admin queue for failed bill scans.
//
// Gated by profiles.is_admin (set on boot from ZOMAID_ADMIN_CLERK_USER_IDS).
// Lists status='failed' attempts that haven't been resolved yet, newest first,
// with image thumbnail + last_error + uploader/household context.
//
// Per-row actions:
//   - "Reset to pending"  → status='pending', attempts=0, last_error=null
//   - "Mark resolved"     → reviewed_at=now() (no bill created)

import { requireAdmin } from "@/lib/auth/require";
import { createServiceClient } from "@/lib/supabase/service";
import { BILL_SCAN_BUCKET } from "@/app/api/bills/scan/_storage";
import { AdminBillScansClient, type AdminScanRow } from "./_client";

const SIGNED_URL_TTL_SECONDS = 60 * 10;

export default async function AdminBillScansPage() {
  await requireAdmin();
  const svc = createServiceClient();

  const { data: rows, error } = await svc
    .from("bill_scan_attempts")
    .select(
      "id, household_id, uploaded_by_profile_id, storage_path, attempts, max_attempts, last_error, created_at",
    )
    .eq("status", "failed")
    .is("reviewed_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="mx-auto max-w-md">
        <header className="border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">Admin · Bill scans</h1>
        </header>
        <p className="px-4 py-6 text-sm text-destructive">
          Couldn&apos;t load the queue: {error.message}
        </p>
      </main>
    );
  }

  // Resolve uploader + household names in a single round-trip each.
  const uploaderIds = Array.from(
    new Set(
      (rows ?? [])
        .map((r) => r.uploaded_by_profile_id)
        .filter((id): id is string => id !== null),
    ),
  );
  const householdIds = Array.from(
    new Set((rows ?? []).map((r) => r.household_id)),
  );

  const profilesById = new Map<string, string>();
  if (uploaderIds.length > 0) {
    const { data: profiles } = await svc
      .from("profiles")
      .select("id, display_name")
      .in("id", uploaderIds);
    for (const p of profiles ?? []) profilesById.set(p.id, p.display_name);
  }
  const householdsById = new Map<string, string>();
  if (householdIds.length > 0) {
    const { data: households } = await svc
      .from("households")
      .select("id, name")
      .in("id", householdIds);
    for (const h of households ?? []) householdsById.set(h.id, h.name);
  }

  // Mint signed thumbnail URLs for everything in one batch.
  const signedUrls = new Map<string, string>();
  const paths = (rows ?? []).map((r) => r.storage_path);
  if (paths.length > 0) {
    const { data: signed } = await svc.storage
      .from(BILL_SCAN_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) signedUrls.set(s.path, s.signedUrl);
    }
  }

  const clientRows: AdminScanRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    storageThumbUrl: signedUrls.get(r.storage_path) ?? null,
    createdAt: r.created_at,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    lastError: r.last_error,
    uploaderName:
      r.uploaded_by_profile_id !== null
        ? profilesById.get(r.uploaded_by_profile_id) ?? null
        : null,
    householdName: householdsById.get(r.household_id) ?? null,
  }));

  return (
    <main className="mx-auto max-w-md">
      <header className="border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Admin · Bill scans</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Failed scan attempts after 3 retries. Reset to put back in the cron
          queue, or mark resolved if you handled it offline.
        </p>
      </header>
      <AdminBillScansClient rows={clientRows} />
    </main>
  );
}
