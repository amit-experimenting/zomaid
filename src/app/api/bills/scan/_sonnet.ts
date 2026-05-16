// Shared Anthropic Sonnet 4.6 bill-scan call.
//
// Split out from route.ts so both the synchronous POST handler and the
// /api/cron/retry-bill-scans worker call the exact same prompt + schema.
// Pure: takes bytes + key, returns the normalised ParsedBill or a
// friendly error message. No NextResponse, no Supabase, no env reads.

import Anthropic from "@anthropic-ai/sdk";
import { parseBillScanResponse, type ParsedBill } from "./_parse";

export type SonnetMediaType = "image/jpeg" | "image/png" | "image/webp";

export type SonnetScanResult =
  | { ok: true; data: ParsedBill }
  | { ok: false; message: string };

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

const BILL_USER_PROMPT =
  "Extract the bill header and grocery line items from this bill.";

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

const REQUEST_TIMEOUT_MS = 30_000;

export async function runSonnetBillScan(
  base64: string,
  mediaType: SonnetMediaType,
  apiKey: string,
): Promise<SonnetScanResult> {
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
    console.error("[bills/scan] anthropic call failed", err);
    return { ok: false, message };
  }

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  if (!textBlock) {
    return {
      ok: false,
      message: "Couldn't read that bill. Try a clearer photo.",
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(textBlock.text);
  } catch {
    return {
      ok: false,
      message: "Couldn't read that bill. Try a clearer photo.",
    };
  }
  return { ok: true, data: parseBillScanResponse(raw) };
}
