// Inventory receipt scan endpoint.
//
// POST /api/inventory/scan with multipart form-data containing `image`.
// Calls Claude Sonnet 4.6 vision and returns a list of parsed grocery
// line items the client can pre-fill into the inventory creation form.
//
// Server-only. ANTHROPIC_API_KEY must never be imported by client code.
// The uploaded image is held in memory for the duration of the request
// and never persisted (no Supabase storage, no on-disk copy).

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { requireHousehold } from "@/lib/auth/require";
import { parseScanResponse, type ParsedItem } from "./_parse";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB after client-side compression
const REQUEST_TIMEOUT_MS = 30_000;

// Frozen — placed before the (variable) image so it benefits from
// Anthropic's prefix prompt cache on repeated scans.
const SCAN_SYSTEM_PROMPT = `You extract grocery line items from a photo of a paper retail receipt.

Return a JSON object with a single key "items" whose value is an array.
Each item is an object with three fields:
- item_name (string, required): the human-readable name in lowercase,
  with brand prefixes / SKU numbers / store codes stripped. e.g.
  "basmati rice", "toor dal", "tomato", "ghee", "milk".
- quantity (number or null): the amount the customer purchased, NOT
  the unit price. If the receipt shows weight (1.5 kg), use that; if
  it shows count (12 eggs), use that; if unclear, null.
- unit (string or null): one of "kg", "g", "l", "ml", "piece", or null
  if unsure. Default to "piece" for discrete items (eggs, bread loaves,
  packets) only when count is obvious.

Rules:
- Output only the JSON object. No prose, no markdown fence, no commentary.
- Skip non-grocery lines: subtotal, tax, GST, discount, loyalty points,
  store address, cashier name, payment method, change, "thank you".
- Skip items you cannot confidently identify. Missing items are better
  than hallucinated items.
- If the image is not a grocery receipt, return {"items": []}.
- Keep names short (under 60 chars) and lowercase.`;

const SCAN_USER_PROMPT = "Extract the grocery line items from this receipt.";

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item_name", "quantity", "unit"],
        properties: {
          item_name: { type: "string" },
          quantity: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

type ScanResponseBody = { items: ParsedItem[] } | { error: string };

function bad(status: number, error: string): NextResponse<ScanResponseBody> {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request): Promise<NextResponse<ScanResponseBody>> {
  // Auth + role check. Same gate as /inventory/new (owner or maid).
  const ctx = await requireHousehold();
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "maid") {
    return bad(403, "You don't have permission to add inventory items.");
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "replace_me") {
    return bad(500, "Receipt scanning is not configured.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad(400, "Couldn't read the upload.");
  }
  const file = form.get("image");
  if (!(file instanceof File)) {
    return bad(400, "Attach a photo of the receipt.");
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return bad(400, "Use a JPEG, PNG, or WebP image.");
  }
  if (file.size === 0) {
    return bad(400, "The uploaded image is empty.");
  }
  if (file.size > MAX_BYTES) {
    return bad(413, "Image is too large — keep it under 5 MB.");
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
        max_tokens: 2048,
        system: [
          {
            type: "text",
            text: SCAN_SYSTEM_PROMPT,
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
              { type: "text", text: SCAN_USER_PROMPT },
            ],
          },
        ],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Receipt scan timed out — try a smaller image.")),
          REQUEST_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (err) {
    const message =
      err instanceof Error && err.message.includes("timed out")
        ? err.message
        : "Couldn't read that receipt. Try a clearer photo.";
    // Log full detail server-side; never echo SDK error text to the client.
    console.error("[inventory/scan] anthropic call failed", err);
    return bad(502, message);
  }

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  if (!textBlock) {
    return bad(502, "Couldn't read that receipt. Try a clearer photo.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(textBlock.text);
  } catch {
    return bad(502, "Couldn't read that receipt. Try a clearer photo.");
  }
  const items = parseScanResponse(raw);
  return NextResponse.json({ items });
}
