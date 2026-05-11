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
