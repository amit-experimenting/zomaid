"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireHousehold } from "@/lib/auth/require";
import { closeBillIssue, createBillIssue } from "@/lib/github/issues";
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

const PhotoConstraints = {
  maxBytes: 5 * 1024 * 1024,
  mimeTypes: ["image/jpeg", "image/png", "image/webp"] as const,
};

function validatePhoto(file: File | null):
  | { ok: true }
  | { ok: false; code: "BILL_INVALID_FILE"; message: string }
{
  if (!file) return { ok: false, code: "BILL_INVALID_FILE", message: "No file provided." };
  if (file.size === 0) return { ok: false, code: "BILL_INVALID_FILE", message: "Empty file." };
  if (file.size > PhotoConstraints.maxBytes) {
    return { ok: false, code: "BILL_INVALID_FILE", message: "Photo exceeds 5 MB." };
  }
  if (!(PhotoConstraints.mimeTypes as readonly string[]).includes(file.type)) {
    return { ok: false, code: "BILL_INVALID_FILE", message: "Only JPEG, PNG, or WebP." };
  }
  return { ok: true };
}

function extFor(mime: string): "jpg" | "png" | "webp" {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/** Internal helper: uploads to Storage, returns the path + a 24h signed URL. */
async function uploadImageAndSignUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  billId: string,
  file: File,
): Promise<{ path: string; signedUrl: string }> {
  const path = `${householdId}/${billId}.${extFor(file.type)}`;
  const up = await supabase.storage.from("bill-images").upload(path, file, {
    upsert: true,
    contentType: file.type,
  });
  if (up.error) throw new Error(`Storage upload: ${up.error.message}`);
  const signed = await supabase.storage
    .from("bill-images")
    .createSignedUrl(path, 60 * 60 * 24);
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(`Signed URL: ${signed.error?.message ?? "no URL"}`);
  }
  return { path, signedUrl: signed.data.signedUrl };
}

export async function uploadBill(formData: FormData): Promise<BillActionResult<{ billId: string }>> {
  const file = formData.get("file") as File | null;
  const storeHint = ((formData.get("storeHint") as string | null) ?? "").trim() || null;
  const check = validatePhoto(file);
  if (!check.ok) return { ok: false, error: { code: check.code, message: check.message } };
  const ctx = await requireHousehold();
  const supabase = await createClient();

  // 1. Insert the bills row first (pending) so we have an ID for the storage path.
  const { data: billRow, error: insertErr } = await supabase
    .from("bills")
    .insert({
      household_id: ctx.household.id,
      uploaded_by_profile_id: ctx.profile.id,
      status: "pending",
      image_storage_path: "pending", // placeholder; updated below
    })
    .select("id")
    .single();
  if (insertErr || !billRow) {
    return { ok: false, error: { code: "BILL_FORBIDDEN", message: insertErr?.message ?? "Insert failed" } };
  }

  // 2. Upload image, generate signed URL.
  let path: string;
  let signedUrl: string;
  try {
    ({ path, signedUrl } = await uploadImageAndSignUrl(supabase, ctx.household.id, billRow.id, file!));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Upload failed";
    await supabase.from("bills").update({ status: "failed", status_reason: message }).eq("id", billRow.id);
    return { ok: false, error: { code: "BILL_INVALID_FILE", message } };
  }
  await supabase.from("bills").update({ image_storage_path: path }).eq("id", billRow.id);

  // 3. Create the GitHub issue.
  try {
    const issue = await createBillIssue({
      billId: billRow.id,
      householdId: ctx.household.id,
      signedImageUrl: signedUrl,
      storeHint,
      uploadedAtIso: new Date().toISOString(),
    });
    await supabase
      .from("bills")
      .update({
        status: "processing",
        github_issue_number: issue.issueNumber,
        github_issue_url: issue.issueUrl,
      })
      .eq("id", billRow.id);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "GitHub issue create failed";
    await supabase.from("bills").update({ status: "failed", status_reason: message }).eq("id", billRow.id);
    return { ok: false, error: { code: "BILL_GITHUB_CREATE_FAILED", message } };
  }

  revalidatePath("/bills");
  return { ok: true, data: { billId: billRow.id } };
}

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
  revalidatePath("/bills");
  return { ok: true, data: { lineItemId: parsed.data.lineItemId } };
}

export async function deleteBill(input: { billId: string }): Promise<BillActionResult<{ billId: string }>> {
  const parsed = z.object({ billId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "BILL_INVALID_FILE", message: "Invalid input" } };
  await requireHousehold();
  const supabase = await createClient();
  const { error } = await supabase.from("bills").delete().eq("id", parsed.data.billId);
  if (error) return { ok: false, error: { code: "BILL_FORBIDDEN", message: error.message } };
  revalidatePath("/bills");
  return { ok: true, data: { billId: parsed.data.billId } };
}

export async function retryBill(input: { billId: string }): Promise<BillActionResult<{ billId: string }>> {
  const parsed = z.object({ billId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "BILL_INVALID_FILE", message: "Invalid input" } };
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { data: bill, error: readErr } = await supabase
    .from("bills")
    .select("id, household_id, status, image_storage_path")
    .eq("id", parsed.data.billId)
    .maybeSingle();
  if (readErr) return { ok: false, error: { code: "BILL_FORBIDDEN", message: readErr.message } };
  if (!bill) return { ok: false, error: { code: "BILL_NOT_FOUND", message: "Bill not found" } };
  if (bill.status === "processed") {
    return { ok: false, error: { code: "BILL_ALREADY_PROCESSED", message: "Bill is already processed." } };
  }
  // Regenerate signed URL.
  const signed = await supabase.storage
    .from("bill-images")
    .createSignedUrl(bill.image_storage_path, 60 * 60 * 24);
  if (signed.error || !signed.data?.signedUrl) {
    return { ok: false, error: { code: "BILL_FORBIDDEN", message: signed.error?.message ?? "Signed URL failed" } };
  }
  try {
    const issue = await createBillIssue({
      billId: bill.id,
      householdId: bill.household_id,
      signedImageUrl: signed.data.signedUrl,
      storeHint: null,
      uploadedAtIso: new Date().toISOString(),
    });
    await supabase
      .from("bills")
      .update({
        status: "processing",
        status_reason: null,
        github_issue_number: issue.issueNumber,
        github_issue_url: issue.issueUrl,
      })
      .eq("id", bill.id);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "GitHub issue create failed";
    await supabase.from("bills").update({ status: "failed", status_reason: message }).eq("id", bill.id);
    return { ok: false, error: { code: "BILL_GITHUB_CREATE_FAILED", message } };
  }
  revalidatePath("/bills");
  revalidatePath(`/bills/${bill.id}`);
  return { ok: true, data: { billId: bill.id } };
}

const ManualLineSchema = z.object({
  item_name: z.string().trim().min(1).max(120),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().trim().min(1).max(24).nullable().optional(),
  unit_price: z.number().nonnegative().nullable().optional(),
  line_total: z.number().nonnegative().nullable().optional(),
});

const ManualInput = z.object({
  billId: z.string().uuid(),
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  storeName: z.string().trim().min(1).max(200).nullable().optional(),
  totalAmount: z.number().nonnegative().nullable().optional(),
  lineItems: z.array(ManualLineSchema).min(1),
});

export async function markBillManuallyProcessed(input: z.infer<typeof ManualInput>): Promise<BillActionResult<{ billId: string }>> {
  const parsed = ManualInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "BILL_INVALID_FILE", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as unknown as Record<string, string> } };
  }
  await requireHousehold();
  const supabase = await createClient();

  // Build the same payload shape ingest_bill_ocr expects.
  const payload: Record<string, unknown> = {
    store_name: parsed.data.storeName ?? null,
    bill_date: parsed.data.billDate ?? null,
    total_amount: parsed.data.totalAmount ?? null,
    line_items: parsed.data.lineItems,
  };
  const { error } = await supabase.rpc("ingest_bill_ocr", {
    p_bill_id: parsed.data.billId,
    p_payload: payload,
  });
  if (error) return { ok: false, error: { code: "BILL_FORBIDDEN", message: error.message } };

  // Close the GH issue (best-effort; ignore failures).
  const { data: bill } = await supabase.from("bills").select("github_issue_number").eq("id", parsed.data.billId).maybeSingle();
  if (bill?.github_issue_number) {
    try {
      await closeBillIssue({
        issueNumber: bill.github_issue_number,
        completionComment: `✅ Manually processed by household member → bill \`${parsed.data.billId}\``,
      });
    } catch { /* ignore — DB is the source of truth */ }
  }

  revalidatePath("/bills");
  revalidatePath(`/bills/${parsed.data.billId}`);
  return { ok: true, data: { billId: parsed.data.billId } };
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
  revalidatePath(`/bills`);
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
  revalidatePath(`/bills`);
  return { ok: true as const, data: null };
}

export async function unskipBillLineItem(input: z.infer<typeof SkipSchema>) {
  const parsed = SkipSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: { code: "BILL_INVALID", message: "Invalid input" } };
  await requireHousehold();
  const supabase = await createClient();
  const { error } = await supabase.rpc("inventory_bill_unskip", { p_line_item_id: parsed.data.line_item_id });
  if (error) return { ok: false as const, error: { code: "BILL_DB", message: error.message } };
  revalidatePath(`/bills`);
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
      image_storage_path: SENTINEL_IMAGE_PATH,
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

  revalidatePath("/bills");
  revalidatePath(`/bills/${billId}`);
  revalidatePath("/inventory");
  return { ok: true, data: { billId } };
}
