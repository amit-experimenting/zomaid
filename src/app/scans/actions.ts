"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireHousehold } from "@/lib/auth/require";
import { createServiceClient } from "@/lib/supabase/service";

export type ScanActionResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } };

const AttemptIdSchema = z.object({ attemptId: z.string().uuid() });

/**
 * Mark a caller-owned succeeded scan as reviewed without creating a bill.
 * "I don't want this" path on /scans/pending.
 */
export async function discardPendingScan(
  input: z.infer<typeof AttemptIdSchema>,
): Promise<ScanActionResult> {
  const parsed = AttemptIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "SCAN_INVALID", message: "Invalid input." } };
  }
  const ctx = await requireHousehold();
  const svc = createServiceClient();
  const { error } = await svc
    .from("bill_scan_attempts")
    .update({ reviewed_at: new Date().toISOString() })
    .eq("id", parsed.data.attemptId)
    .eq("uploaded_by_profile_id", ctx.profile.id)
    .is("reviewed_at", null);
  if (error) {
    return { ok: false, error: { code: "SCAN_DB", message: error.message } };
  }
  revalidatePath("/scans/pending");
  return { ok: true };
}

/**
 * "Cancel" a failed scan — same effect as discard: stamps reviewed_at so
 * the row disappears from the user's queue. Kept as a distinct action so
 * the UI copy can be tuned independently.
 */
export async function cancelFailedScan(
  input: z.infer<typeof AttemptIdSchema>,
): Promise<ScanActionResult> {
  const parsed = AttemptIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "SCAN_INVALID", message: "Invalid input." } };
  }
  const ctx = await requireHousehold();
  const svc = createServiceClient();
  const { error } = await svc
    .from("bill_scan_attempts")
    .update({ reviewed_at: new Date().toISOString() })
    .eq("id", parsed.data.attemptId)
    .eq("uploaded_by_profile_id", ctx.profile.id)
    .is("reviewed_at", null);
  if (error) {
    return { ok: false, error: { code: "SCAN_DB", message: error.message } };
  }
  revalidatePath("/scans/pending");
  return { ok: true };
}
