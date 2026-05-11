"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireHousehold } from "@/lib/auth/require";
import { closeBillIssue, createBillIssue } from "@/lib/github/issues";
import type { Database } from "@/lib/db/types";

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
