// Bill-photo scan endpoint.
//
// POST /api/bills/scan with multipart form-data containing `image`.
// Tries Claude Sonnet 4.6 vision synchronously. On success returns the
// parsed bill (store header + line items, including per-line price) that
// the /inventory/new "Upload bill" tab renders into the editable
// confirmation form (handled by the uploadBillFromScan server action).
//
// On any failure (Sonnet 5xx, timeout, malformed JSON), we stash the
// uploaded photo in the private bill-scan-pending bucket, insert a
// bill_scan_attempts row (status=pending, attempts=1), and respond
// with code BILL_SCAN_QUEUED so the client can point the user at
// /scans/pending. The /api/cron/retry-bill-scans worker picks the
// row up on the next */15 tick and retries up to 3 times.
//
// Server-only. ANTHROPIC_API_KEY must never be imported by client code.

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireHousehold } from "@/lib/auth/require";
import { createServiceClient } from "@/lib/supabase/service";
import type { ParsedBill } from "./_parse";
import { runSonnetBillScan, type SonnetMediaType } from "./_sonnet";
import { BILL_SCAN_BUCKET, buildBillScanStoragePath } from "./_storage";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB hard ceiling after client-side compression
const BILL_IMAGES_BUCKET = "bill-images";

/** Build the persistent storage path for a bill image: <household>/<uuid>.<ext>. */
function buildBillImagePath(householdId: string, mediaType: SonnetMediaType): string {
  const ext = mediaType === "image/png" ? "png" : mediaType === "image/webp" ? "webp" : "jpg";
  return `${householdId}/${randomUUID()}.${ext}`;
}

export type BillScanResponseBody =
  | { ok: true; data: ParsedBill & { imageStoragePath: string } }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        // Present when code === "BILL_SCAN_QUEUED".
        attemptId?: string;
      };
    };

function bad(
  status: number,
  code: string,
  message: string,
): NextResponse<BillScanResponseBody> {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export async function POST(
  request: Request,
): Promise<NextResponse<BillScanResponseBody>> {
  // requireHousehold redirects (throws) for unauthenticated callers, so
  // we never queue for an anonymous upload.
  const ctx = await requireHousehold();
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "maid") {
    return bad(403, "BILL_FORBIDDEN", "You don't have permission to upload bills.");
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "replace_me") {
    return bad(500, "BILL_NOT_CONFIGURED", "Bill scanning is not configured.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad(400, "BILL_INVALID_FILE", "Couldn't read the upload.");
  }
  const file = form.get("image");
  if (!(file instanceof File)) {
    return bad(400, "BILL_INVALID_FILE", "Attach a photo of the bill.");
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return bad(400, "BILL_INVALID_FILE", "Use a JPEG, PNG, or WebP image.");
  }
  if (file.size === 0) {
    return bad(400, "BILL_INVALID_FILE", "The uploaded image is empty.");
  }
  if (file.size > MAX_BYTES) {
    return bad(413, "BILL_INVALID_FILE", "Image is too large — keep it under 10 MB.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  const mediaType = file.type as SonnetMediaType;

  // ── Happy path: try Sonnet synchronously. ──────────────────────────
  const sonnet = await runSonnetBillScan(base64, mediaType, apiKey);
  if (sonnet.ok) {
    // Persist the image to bill-images so the bill detail page can render
    // it later (full-screen viewer). The client receives the storage path
    // and threads it through uploadBillFromScan when the user confirms.
    const supabase = createServiceClient();
    const imageStoragePath = buildBillImagePath(ctx.household.id, mediaType);
    const uploaded = await supabase.storage
      .from(BILL_IMAGES_BUCKET)
      .upload(imageStoragePath, buffer, {
        contentType: mediaType,
        upsert: false,
      });
    if (uploaded.error) {
      // Non-fatal: surface the parsed bill anyway with an empty image path.
      // The detail page already tolerates a missing image gracefully.
      console.error("[bills/scan] failed to persist image", uploaded.error);
      return NextResponse.json({
        ok: true,
        data: { ...sonnet.data, imageStoragePath: "" },
      });
    }
    return NextResponse.json({
      ok: true,
      data: { ...sonnet.data, imageStoragePath },
    });
  }

  // ── Failure path: stash the image + queue a retry. ────────────────
  const supabase = createServiceClient();
  const attemptId = randomUUID();
  const storagePath = buildBillScanStoragePath(
    ctx.household.id,
    attemptId,
    mediaType,
  );

  const uploaded = await supabase.storage
    .from(BILL_SCAN_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mediaType,
      upsert: false,
    });
  if (uploaded.error) {
    // If we can't persist the image we have nothing to retry against;
    // surface the original Sonnet message so the user can re-pick.
    console.error("[bills/scan] failed to stash image for retry", uploaded.error);
    return bad(502, "BILL_SCAN_FAILED", sonnet.message);
  }

  const inserted = await supabase
    .from("bill_scan_attempts")
    .insert({
      id: attemptId,
      household_id: ctx.household.id,
      uploaded_by_profile_id: ctx.profile.id,
      storage_path: storagePath,
      mime_type: mediaType,
      status: "pending",
      attempts: 1,
      last_attempted_at: new Date().toISOString(),
      last_error: sonnet.message,
    })
    .select("id")
    .single();

  if (inserted.error || !inserted.data) {
    console.error("[bills/scan] failed to enqueue retry row", inserted.error);
    // Clean up the orphaned image best-effort.
    await supabase.storage.from(BILL_SCAN_BUCKET).remove([storagePath]);
    return bad(502, "BILL_SCAN_FAILED", sonnet.message);
  }

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "BILL_SCAN_QUEUED",
        attemptId: inserted.data.id,
        message:
          "We couldn't read the bill on the first try. We'll retry automatically — you'll get a push notification when it's ready (usually under an hour).",
      },
    },
    { status: 202 },
  );
}
