// Vercel cron — retries pending bill scans every 15 minutes.
// Auth via Authorization: Bearer $CRON_SECRET.
//
// See docs/specs/2026-05-16-bill-scan-retry-queue-design.md.

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendWebPush } from "@/lib/push/webpush";
import { runSonnetBillScan, type SonnetMediaType } from "@/app/api/bills/scan/_sonnet";
import { BILL_SCAN_BUCKET } from "@/app/api/bills/scan/_storage";

// Per-tick safety knobs.
const BATCH_LIMIT = 10;
const WALLCLOCK_BUDGET_MS = 60_000;
// 14-minute (not 15) "do not re-claim" window — keeps a row that's
// being processed in tick N from being grabbed by tick N+1 if the
// previous run is still on the Sonnet call.
const RETRY_GAP_MINUTES = 14;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET unset" }, { status: 500 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "replace_me") {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY unset" },
      { status: 500 },
    );
  }

  const supabase = createServiceClient();
  const startedAt = Date.now();
  const cutoffIso = new Date(
    Date.now() - RETRY_GAP_MINUTES * 60 * 1000,
  ).toISOString();

  // Pull candidate rows: pending, not over the attempt cap, and either
  // never tried OR last tried before the cutoff.
  const candidates = await supabase
    .from("bill_scan_attempts")
    .select(
      "id, household_id, uploaded_by_profile_id, storage_path, mime_type, attempts, max_attempts, last_attempted_at",
    )
    .eq("status", "pending")
    .or(`last_attempted_at.is.null,last_attempted_at.lt.${cutoffIso}`)
    .order("last_attempted_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_LIMIT);
  if (candidates.error) {
    return NextResponse.json(
      { error: candidates.error.message },
      { status: 500 },
    );
  }

  let succeeded = 0;
  let failed = 0;
  let processed = 0;
  let stillPending = 0;

  for (const row of candidates.data ?? []) {
    // Bail out before starting another Sonnet call if we're out of budget.
    if (Date.now() - startedAt > WALLCLOCK_BUDGET_MS) break;
    if (row.attempts >= row.max_attempts) continue;

    processed++;

    // 1. Download the image from the private bucket.
    const download = await supabase.storage
      .from(BILL_SCAN_BUCKET)
      .download(row.storage_path);
    if (download.error || !download.data) {
      const nextAttempts = row.attempts + 1;
      const isTerminal = nextAttempts >= row.max_attempts;
      await supabase
        .from("bill_scan_attempts")
        .update({
          attempts: nextAttempts,
          last_attempted_at: new Date().toISOString(),
          last_error: `Failed to download stored image: ${download.error?.message ?? "missing"}`,
          status: isTerminal ? "failed" : "pending",
        })
        .eq("id", row.id);
      if (isTerminal) {
        failed++;
        await notifyUploader(supabase, row.uploaded_by_profile_id, {
          title: "Bill scan failed",
          body: "We couldn't read your bill. An admin will take a look.",
          data: { attemptId: row.id, terminal: true },
        });
      } else {
        stillPending++;
      }
      continue;
    }

    const buffer = Buffer.from(await download.data.arrayBuffer());
    const base64 = buffer.toString("base64");
    const mime = (row.mime_type as SonnetMediaType) ?? "image/jpeg";

    // 2. Call Sonnet (same helper as the sync path).
    const result = await runSonnetBillScan(base64, mime, apiKey);

    if (result.ok) {
      const updated = await supabase
        .from("bill_scan_attempts")
        .update({
          status: "succeeded",
          attempts: row.attempts + 1,
          last_attempted_at: new Date().toISOString(),
          last_error: null,
          parsed_payload: result.data as unknown as Record<string, unknown>,
        })
        .eq("id", row.id);
      if (updated.error) {
        console.error("[cron/retry-bill-scans] update on success failed", updated.error);
        continue;
      }
      succeeded++;
      await notifyUploader(supabase, row.uploaded_by_profile_id, {
        title: "Bill scan ready",
        body: "Your bill scan is ready — review it.",
        data: { attemptId: row.id, url: "/scans/pending" },
      });
    } else {
      const nextAttempts = row.attempts + 1;
      const isTerminal = nextAttempts >= row.max_attempts;
      const updated = await supabase
        .from("bill_scan_attempts")
        .update({
          attempts: nextAttempts,
          last_attempted_at: new Date().toISOString(),
          last_error: result.message,
          status: isTerminal ? "failed" : "pending",
        })
        .eq("id", row.id);
      if (updated.error) {
        console.error("[cron/retry-bill-scans] update on failure failed", updated.error);
        continue;
      }
      if (isTerminal) {
        failed++;
        await notifyUploader(supabase, row.uploaded_by_profile_id, {
          title: "Bill scan failed",
          body: "We couldn't read your bill. An admin will take a look.",
          data: { attemptId: row.id, terminal: true },
        });
      } else {
        stillPending++;
      }
    }
  }

  return NextResponse.json({
    processed,
    succeeded,
    failed,
    stillPending,
  });
}

type ServiceSupabase = ReturnType<typeof createServiceClient>;

async function notifyUploader(
  supabase: ServiceSupabase,
  profileId: string | null,
  payload: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  if (!profileId) return;
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh_key, auth_key")
    .eq("profile_id", profileId)
    .is("revoked_at", null);
  if (!subs || subs.length === 0) return;
  for (const sub of subs) {
    const r = await sendWebPush(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh_key, auth: sub.auth_key } },
      payload,
    );
    if (r.ok) {
      await supabase
        .from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", sub.id);
    } else if (r.gone) {
      await supabase
        .from("push_subscriptions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", sub.id);
    }
  }
}
