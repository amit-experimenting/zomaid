"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireHousehold } from "@/lib/auth/require";
import type { Database } from "@/lib/db/types";
import { createInventoryItem } from "@/app/inventory/actions";
import {
  areDedupeKeysEqual,
  buildBillDedupeKey,
  type DedupeKey,
} from "@/app/bills/_dedupe";

export type BillActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string> } };

const UpdateLineItemInput = z.object({
  lineItemId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().trim().min(1).max(24).nullable().optional(),
  unitPrice: z.number().nonnegative().nullable().optional(),
  lineTotal: z.number().nonnegative().nullable().optional(),
});

export async function updateBillLineItem(input: z.infer<typeof UpdateLineItemInput>): Promise<BillActionResult<{ lineItemId: string }>> {
  const parsed = UpdateLineItemInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "BILL_INVALID_FILE", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as unknown as Record<string, string> } };
  }
  await requireHousehold();
  const supabase = await createClient();
  const patch: Database["public"]["Tables"]["bill_line_items"]["Update"] = {};
  if (parsed.data.name !== undefined)      patch.item_name = parsed.data.name;
  if (parsed.data.quantity !== undefined)  patch.quantity = parsed.data.quantity ?? null;
  if (parsed.data.unit !== undefined)      patch.unit = parsed.data.unit ?? null;
  if (parsed.data.unitPrice !== undefined) patch.unit_price = parsed.data.unitPrice ?? null;
  if (parsed.data.lineTotal !== undefined) patch.line_total = parsed.data.lineTotal ?? null;
  const { error } = await supabase
    .from("bill_line_items")
    .update(patch)
    .eq("id", parsed.data.lineItemId);
  if (error) return { ok: false, error: { code: "BILL_FORBIDDEN", message: error.message } };
  // We don't know the bill_id here without another round-trip, so revalidate
  // the shopping page (bills tab) and let the per-bill page re-fetch on
  // next visit.
  revalidatePath("/shopping");
  return { ok: true, data: { lineItemId: parsed.data.lineItemId } };
}

const BillIngestSchema = z.object({
  line_item_id: z.string().uuid(),
  inventory_id: z.string().uuid().nullable(),
  quantity: z.number().min(0),
  unit: z.string().min(1).max(24),
  new_item_name: z.string().min(1).max(120).optional(),
});

export async function ingestBillLineItem(input: z.infer<typeof BillIngestSchema>) {
  const parsed = BillIngestSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: { code: "BILL_INVALID", message: "Invalid input" } };
  await requireHousehold();
  const supabase = await createClient();
  const { error } = await supabase.rpc("inventory_bill_ingest", {
    p_line_item_id: parsed.data.line_item_id,
    p_inventory_id: parsed.data.inventory_id,
    p_quantity: parsed.data.quantity,
    p_unit: parsed.data.unit,
    p_new_item_name: parsed.data.new_item_name ?? null,
  });
  if (error) {
    if (error.message.includes("INV_NO_CONVERSION")) {
      return { ok: false as const, error: { code: "INV_NO_CONVERSION", message: "Unit can't be reconciled — choose 'new item' or adjust unit." } };
    }
    return { ok: false as const, error: { code: "BILL_DB", message: error.message } };
  }
  revalidatePath("/shopping");
  return { ok: true as const, data: null };
}

const SkipSchema = z.object({ line_item_id: z.string().uuid() });

export async function skipBillLineItem(input: z.infer<typeof SkipSchema>) {
  const parsed = SkipSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: { code: "BILL_INVALID", message: "Invalid input" } };
  await requireHousehold();
  const supabase = await createClient();
  const { error } = await supabase.rpc("inventory_bill_skip", { p_line_item_id: parsed.data.line_item_id });
  if (error) return { ok: false as const, error: { code: "BILL_DB", message: error.message } };
  revalidatePath("/shopping");
  return { ok: true as const, data: null };
}

export async function unskipBillLineItem(input: z.infer<typeof SkipSchema>) {
  const parsed = SkipSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: { code: "BILL_INVALID", message: "Invalid input" } };
  await requireHousehold();
  const supabase = await createClient();
  const { error } = await supabase.rpc("inventory_bill_unskip", { p_line_item_id: parsed.data.line_item_id });
  if (error) return { ok: false as const, error: { code: "BILL_DB", message: error.message } };
  revalidatePath("/shopping");
  return { ok: true as const, data: null };
}

// ── uploadBillFromScan ──────────────────────────────────────────────
// Server-side companion of the /inventory/new "Upload bill" tab.
// Takes the user-confirmed parsed-bill object plus a per-line
// addToInventory flag. Rejects exact duplicates of an earlier bill.
// On unique: creates bills + bill_line_items rows, plus an
// inventory_items row per checked line, and links each line back to
// the inventory row it produced via matched_inventory_item_id.

const ScanUnitEnum = z.enum(["kg", "g", "l", "ml", "piece"]);

const ScanLineSchema = z.object({
  item_name: z.string().min(1).max(120),
  quantity: z.number().positive().nullable(),
  unit: ScanUnitEnum.nullable(),
  price: z.number().nonnegative().nullable(),
  addToInventory: z.boolean(),
});

const UploadBillFromScanSchema = z.object({
  store_name: z.string().trim().min(1).max(200),
  bill_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  total_amount: z.number().nonnegative().nullable(),
  items: z.array(ScanLineSchema).min(1).max(200),
  // Optional bill_scan_attempts row to stamp once the bill is created.
  // Present when the user is finalising a queued retry from /scans/pending;
  // omitted on the synchronous /inventory/new → confirm flow.
  attemptId: z.string().uuid().optional(),
  // Storage path in bill-images bucket. Set by the scan API route after a
  // successful upload; omitted on retry-from-attempt flows (the image lives
  // in bill-scan-pending and isn't moved on save in v1).
  imageStoragePath: z.string().min(1).max(500).optional(),
});

export type UploadBillFromScanInput = z.infer<typeof UploadBillFromScanSchema>;

// Sentinel value for bills uploaded via the inventory-new scan tab —
// the image is never persisted to Supabase Storage. The bills.image_storage_path
// column is `not null`, so we record this string instead. The detail
// page's signed-URL attempt against this path harmlessly returns null
// and the photo block is skipped.
const SENTINEL_IMAGE_PATH = "bill-scan-not-persisted";

export async function uploadBillFromScan(
  input: UploadBillFromScanInput,
): Promise<BillActionResult<{ billId: string }>> {
  const parsed = UploadBillFromScanSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "BILL_INVALID",
        message: "Invalid input.",
        fieldErrors: parsed.error.flatten().fieldErrors as unknown as Record<string, string>,
      },
    };
  }
  const ctx = await requireHousehold();
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "maid") {
    return { ok: false, error: { code: "BILL_FORBIDDEN", message: "You don't have permission to upload bills." } };
  }
  const supabase = await createClient();

  // Drop empty-name lines defensively (zod already enforces min length 1,
  // but a leading/trailing whitespace-only row could slip through).
  const cleanItems = parsed.data.items.filter((it) => it.item_name.trim().length > 0);
  if (cleanItems.length === 0) {
    return { ok: false, error: { code: "BILL_INVALID", message: "Add at least one line item." } };
  }

  // ── 1. Dedupe check ───────────────────────────────────────────────
  const candidateKey = buildBillDedupeKey({
    store_name: parsed.data.store_name,
    bill_date: parsed.data.bill_date,
    lines: cleanItems.map((it) => ({
      item_name: it.item_name,
      quantity: it.quantity,
      unit: it.unit,
      price: it.price,
    })),
  });
  if (candidateKey) {
    // Pull all bills with matching store+date for this household and check
    // their line sets in JS. Per-household bill volume is small (~tens/month).
    const { data: candidateBills, error: candidateErr } = await supabase
      .from("bills")
      .select("id, bill_date, store_name")
      .eq("household_id", ctx.household.id)
      .eq("bill_date", parsed.data.bill_date);
    if (candidateErr) {
      return { ok: false, error: { code: "BILL_DB", message: candidateErr.message } };
    }
    const sameStoreBills = (candidateBills ?? []).filter(
      (b) => (b.store_name ?? "").trim().toLowerCase() === candidateKey.store,
    );
    if (sameStoreBills.length > 0) {
      const ids = sameStoreBills.map((b) => b.id);
      const { data: lineRows, error: linesErr } = await supabase
        .from("bill_line_items")
        .select("bill_id, item_name, quantity, unit, line_total")
        .in("bill_id", ids);
      if (linesErr) {
        return { ok: false, error: { code: "BILL_DB", message: linesErr.message } };
      }
      const byBill = new Map<string, Array<{ item_name: string; quantity: number | null; unit: string | null; line_total: number | null }>>();
      for (const row of lineRows ?? []) {
        const list = byBill.get(row.bill_id) ?? [];
        list.push({
          item_name: row.item_name,
          quantity: row.quantity == null ? null : Number(row.quantity),
          unit: row.unit,
          line_total: row.line_total == null ? null : Number(row.line_total),
        });
        byBill.set(row.bill_id, list);
      }
      for (const b of sameStoreBills) {
        const existingLines = byBill.get(b.id) ?? [];
        const existingKey: DedupeKey | null = buildBillDedupeKey({
          store_name: b.store_name,
          bill_date: b.bill_date,
          lines: existingLines.map((l) => ({
            item_name: l.item_name,
            quantity: l.quantity,
            unit: l.unit,
            price: l.line_total,
          })),
        });
        if (existingKey && areDedupeKeysEqual(candidateKey, existingKey)) {
          return {
            ok: false,
            error: {
              code: "BILL_DUPLICATE",
              message: `Looks like a duplicate of a bill uploaded on ${b.bill_date}.`,
            },
          };
        }
      }
    }
  }

  // ── 1.5. If finalizing a queued retry, copy the image from the
  // bill-scan-pending bucket into bill-images so /bills/[id] can render
  // it via the bill-images signed-URL path. The pending-bucket original
  // stays put (user explicitly opted to retain images on success).
  let finalImagePath = parsed.data.imageStoragePath ?? SENTINEL_IMAGE_PATH;
  if (parsed.data.attemptId && !parsed.data.imageStoragePath) {
    const { createServiceClient } = await import("@/lib/supabase/service");
    const svc = createServiceClient();
    const attempt = await svc
      .from("bill_scan_attempts")
      .select("storage_path, mime_type, household_id")
      .eq("id", parsed.data.attemptId)
      .single();
    if (attempt.data) {
      const dl = await svc.storage
        .from("bill-scan-pending")
        .download(attempt.data.storage_path);
      if (dl.data) {
        const mime = attempt.data.mime_type;
        const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
        const newPath = `${attempt.data.household_id}/${crypto.randomUUID()}.${ext}`;
        const ul = await svc.storage
          .from("bill-images")
          .upload(newPath, dl.data, { contentType: mime, upsert: false });
        if (!ul.error) {
          finalImagePath = newPath;
        } else {
          console.error("[uploadBillFromScan] copy to bill-images failed", ul.error);
        }
      } else {
        console.error("[uploadBillFromScan] download from bill-scan-pending failed", dl.error);
      }
    } else {
      console.error("[uploadBillFromScan] attempt row lookup failed", attempt.error);
    }
  }

  // ── 2. Insert the bills row ──────────────────────────────────────
  const { data: billRow, error: billInsertErr } = await supabase
    .from("bills")
    .insert({
      household_id: ctx.household.id,
      uploaded_by_profile_id: ctx.profile.id,
      status: "processed",
      processed_at: new Date().toISOString(),
      store_name: parsed.data.store_name.trim(),
      bill_date: parsed.data.bill_date,
      currency: parsed.data.currency,
      total_amount: parsed.data.total_amount ?? null,
      image_storage_path: finalImagePath,
    })
    .select("id")
    .single();
  if (billInsertErr || !billRow) {
    return {
      ok: false,
      error: {
        code: "BILL_DB",
        message: billInsertErr?.message ?? "Failed to create bill.",
      },
    };
  }
  const billId: string = billRow.id;

  // ── 3. Create inventory rows for checked lines + remember mapping ─
  const inventoryIdByIndex: Array<string | null> = [];
  for (const item of cleanItems) {
    if (!item.addToInventory) {
      inventoryIdByIndex.push(null);
      continue;
    }
    // createInventoryItem requires a unit and a non-negative quantity.
    // If the user left them empty, fall back to safe defaults so the
    // inventory row is still created — they can edit it later.
    const invResult = await createInventoryItem({
      item_name: item.item_name.trim(),
      quantity: item.quantity ?? 0,
      unit: item.unit ?? "piece",
    });
    if (!invResult.ok) {
      // Best-effort rollback: delete the half-built bill row.
      await supabase.from("bills").delete().eq("id", billId);
      return {
        ok: false,
        error: {
          code: "BILL_DB",
          message: `Failed to add ${item.item_name} to inventory: ${invResult.error.message}`,
        },
      };
    }
    inventoryIdByIndex.push(invResult.data.id);
  }

  // ── 4. Insert all bill_line_items at once ────────────────────────
  const lineRows: Database["public"]["Tables"]["bill_line_items"]["Insert"][] =
    cleanItems.map((item, i) => ({
      bill_id: billId,
      position: i + 1,
      item_name: item.item_name.trim(),
      quantity: item.quantity,
      unit: item.unit,
      // `line_total` is the per-line dollar amount; we reuse the column the
      // dedupe key reads (no separate `price` column on bill_line_items).
      line_total: item.price,
      unit_price: null,
      matched_inventory_item_id: inventoryIdByIndex[i],
      // Treat unchecked rows as explicitly skipped so they don't show up
      // in the legacy pending-inventory review queue on /bills/[id].
      inventory_ingestion_skipped: !item.addToInventory,
      inventory_ingested_at: inventoryIdByIndex[i] ? new Date().toISOString() : null,
    }));
  const { error: lineErr } = await supabase
    .from("bill_line_items")
    .insert(lineRows);
  if (lineErr) {
    await supabase.from("bills").delete().eq("id", billId);
    return { ok: false, error: { code: "BILL_DB", message: lineErr.message } };
  }

  // ── 5. Bill-match: any active shopping rows whose (lower name, unit)
  // match one of this bill's line items are moved to "bought" so the
  // user doesn't have to tick them by hand. Inventory was already
  // updated above for lines the user checked "Add to inventory"; we
  // intentionally don't double-write here. Shopping rows that should
  // have gone to inventory but didn't (user unchecked) will get picked
  // up by the end-of-day sweep instead.
  {
    const now = new Date().toISOString();
    for (const item of cleanItems) {
      const name = item.item_name.trim();
      if (!name) continue;
      let q = supabase
        .from("shopping_list_items")
        .update({
          bought_at: now,
          checked_at: now,
          bought_by_profile_id: ctx.profile.id,
        })
        .eq("household_id", ctx.household.id)
        .is("bought_at", null)
        .ilike("item_name", name);
      q = item.unit === null ? q.is("unit", null) : q.eq("unit", item.unit);
      const { error } = await q;
      if (error) {
        // Non-fatal: log and continue. The bill itself is already
        // saved; failing the bill because shopping match misfired
        // would be worse than the row staying on the list.
        console.error("[uploadBillFromScan] shopping match failed", error);
      }
    }
  }

  // If the caller is finalising a queued retry, stamp the attempt row so
  // it stops showing on /scans/pending and the inventory-tab badge. Best
  // effort — failure to stamp is logged but does not roll back the bill.
  // We use the service-role client because bill_scan_attempts has no
  // user-writable RLS policy by design.
  if (parsed.data.attemptId) {
    const { createServiceClient } = await import("@/lib/supabase/service");
    const svc = createServiceClient();
    const stamp = await svc
      .from("bill_scan_attempts")
      .update({
        reviewed_at: new Date().toISOString(),
        produced_bill_id: billId,
      })
      .eq("id", parsed.data.attemptId)
      .eq("uploaded_by_profile_id", ctx.profile.id);
    if (stamp.error) {
      console.error(
        "[uploadBillFromScan] failed to stamp bill_scan_attempts",
        stamp.error,
      );
    }
    revalidatePath("/scans/pending");
  }

  revalidatePath("/shopping");
  revalidatePath(`/bills/${billId}`);
  revalidatePath("/inventory");
  return { ok: true, data: { billId } };
}
