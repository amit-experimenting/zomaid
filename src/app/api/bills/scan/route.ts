// Bill-photo scan endpoint.
//
// POST /api/bills/scan with multipart form-data containing `image`.
// Calls Claude Sonnet 4.6 vision and returns a parsed bill object
// (store header + line items, including per-line price) that the
// /inventory/new "Upload bill" tab renders into an editable
// confirmation form. The user reviews + saves; the actual DB write
// happens in the uploadBillFromScan server action.
//
// Server-only. ANTHROPIC_API_KEY must never be imported by client code.
// The uploaded image is held in memory for the duration of the request
// and never persisted (no Supabase storage, no on-disk copy).

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { requireHousehold } from "@/lib/auth/require";
import { parseBillScanResponse, type ParsedBill } from "./_parse";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB hard ceiling after client-side compression
const REQUEST_TIMEOUT_MS = 30_000;

// Frozen — placed before the (variable) image so it benefits from
// Anthropic's prefix prompt cache on repeated scans.
const BILL_SYSTEM_PROMPT = `You extract grocery-bill data from a photo of a paper retail receipt or invoice.

Return a JSON object with these top-level fields:
- store_name (string or null): the merchant name as printed at the top
  of the bill. Strip address lines, phone numbers, GST/UEN codes. Title
  Case is fine. Null if unreadable.
- bill_date (string YYYY-MM-DD, or null): the bill / transaction date.
  Null if not clearly printed.
- currency (string ISO 4217, e.g. "SGD", "USD", "INR", "EUR", or null):
  the currency symbol or code. Use "SGD" for "$" with a Singapore-context
  bill, "USD" if clearly American, "INR" for ₹ or "Rs". Null if unsure.
- total_amount (number or null): the grand total the customer paid.
  Excludes "subtotal" — use the final number after tax. Null if unclear.
- items (array): each entry has:
    - item_name (string, lowercase, no brand prefixes / SKU codes;
      e.g. "basmati rice", "toor dal", "milk").
    - quantity (number or null): purchased amount.
    - unit (string or null): one of "kg", "g", "l", "ml", "piece".
    - price (number or null): the line total in the bill's currency
      (not the per-unit price).

Rules:
- Output only the JSON object. No prose, no markdown fence.
- Skip non-grocery lines in items: subtotal, tax, GST, discount,
  loyalty points, store address, payment method, change, "thank you".
- Skip items you cannot confidently identify. Missing items are better
  than hallucinated items.
- If the image is not a grocery bill, return:
  {"store_name": null, "bill_date": null, "currency": null,
   "total_amount": null, "items": []}.
- Keep names short (under 60 chars) and lowercase.`;

const BILL_USER_PROMPT = "Extract the bill header and grocery line items from this bill.";

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["store_name", "bill_date", "currency", "total_amount", "items"],
  properties: {
    store_name: { type: ["string", "null"] },
    bill_date: { type: ["string", "null"] },
    currency: { type: ["string", "null"] },
    total_amount: { type: ["number", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item_name", "quantity", "unit", "price"],
        properties: {
          item_name: { type: "string" },
          quantity: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          price: { type: ["number", "null"] },
        },
      },
    },
  },
} as const;

export type BillScanResponseBody =
  | { ok: true; data: ParsedBill }
  | { ok: false; error: { code: string; message: string } };

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
  const mediaType = file.type as "image/jpeg" | "image/png" | "image/webp";

  const client = new Anthropic({ apiKey });
  let response;
  try {
    response = await Promise.race([
      client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: [
          {
            type: "text",
            text: BILL_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        output_config: {
          format: { type: "json_schema", schema: JSON_SCHEMA },
        },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: base64 },
              },
              { type: "text", text: BILL_USER_PROMPT },
            ],
          },
        ],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Bill scan timed out — try a smaller image.")),
          REQUEST_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (err) {
    const message =
      err instanceof Error && err.message.includes("timed out")
        ? err.message
        : "Couldn't read that bill. Try a clearer photo.";
    // Log full detail server-side; never echo SDK error text to the client.
    console.error("[bills/scan] anthropic call failed", err);
    return bad(502, "BILL_SCAN_FAILED", message);
  }

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  if (!textBlock) {
    return bad(502, "BILL_SCAN_FAILED", "Couldn't read that bill. Try a clearer photo.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(textBlock.text);
  } catch {
    return bad(502, "BILL_SCAN_FAILED", "Couldn't read that bill. Try a clearer photo.");
  }
  const data = parseBillScanResponse(raw);
  return NextResponse.json({ ok: true, data });
}
