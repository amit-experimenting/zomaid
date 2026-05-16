// Pure helpers for the bill-scan-pending storage layout.
//
// Path shape: <householdId>/<uuid>.<ext>
// The bucket is service-role-only; signed URLs are minted on the
// /scans/pending and /admin/bill-scans pages for thumbnail display.

export const BILL_SCAN_BUCKET = "bill-scan-pending";

const EXT_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function extForMime(mime: string): string {
  return EXT_FOR_MIME[mime] ?? "bin";
}

export function buildBillScanStoragePath(
  householdId: string,
  attemptId: string,
  mime: string,
): string {
  return `${householdId}/${attemptId}.${extForMime(mime)}`;
}

/**
 * Decides if a bill_scan_attempts row is ready to be retried by the cron
 * worker. The cron runs every 15 minutes; we use a 14-minute window so
 * a row that's currently being processed in tick N doesn't get re-claimed
 * by tick N+1 if the work is still in flight.
 */
export function shouldRetryAttempt(
  row: {
    status: string;
    attempts: number;
    max_attempts: number;
    last_attempted_at: string | null;
  },
  now: Date,
  retryGapMs = 14 * 60 * 1000,
): boolean {
  if (row.status !== "pending") return false;
  if (row.attempts >= row.max_attempts) return false;
  if (row.last_attempted_at === null) return true;
  const last = new Date(row.last_attempted_at).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= retryGapMs;
}
