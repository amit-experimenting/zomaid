"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require";
import { createServiceClient } from "@/lib/supabase/service";

export type AdminBillScanResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } };

const AttemptIdSchema = z.object({ attemptId: z.string().uuid() });

/**
 * Bounce a failed scan back into the cron queue. Resets attempts to 0
 * and clears last_error so the cron treats it like a fresh row. The
 * stored image is kept untouched.
 */
export async function resetBillScan(
  input: z.infer<typeof AttemptIdSchema>,
): Promise<AdminBillScanResult> {
  const parsed = AttemptIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "ADMIN_SCAN_INVALID", message: "Invalid input." } };
  }
  await requireAdmin();
  const svc = createServiceClient();
  const { error } = await svc
    .from("bill_scan_attempts")
    .update({
      status: "pending",
      attempts: 0,
      last_error: null,
      last_attempted_at: null,
    })
    .eq("id", parsed.data.attemptId);
  if (error) {
    return { ok: false, error: { code: "ADMIN_SCAN_DB", message: error.message } };
  }
  revalidatePath("/admin/bill-scans");
  return { ok: true };
}

/**
 * Mark a failed scan as handled out-of-band. Stamps reviewed_at without
 * creating a bill or putting it back in the queue.
 */
export async function resolveBillScan(
  input: z.infer<typeof AttemptIdSchema>,
): Promise<AdminBillScanResult> {
  const parsed = AttemptIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "ADMIN_SCAN_INVALID", message: "Invalid input." } };
  }
  await requireAdmin();
  const svc = createServiceClient();
  const { error } = await svc
    .from("bill_scan_attempts")
    .update({ reviewed_at: new Date().toISOString() })
    .eq("id", parsed.data.attemptId);
  if (error) {
    return { ok: false, error: { code: "ADMIN_SCAN_DB", message: error.message } };
  }
  revalidatePath("/admin/bill-scans");
  return { ok: true };
}
