"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireHousehold } from "@/lib/auth/require";

export type ShoppingActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; fieldErrors?: Record<string, string> } };

const NameSchema = z.string().trim().min(1).max(120);
const QuantitySchema = z.number().positive().optional().nullable();
const UnitSchema = z.string().trim().min(1).max(24).optional().nullable();
const NotesSchema = z.string().max(500).optional().nullable();
const ItemIdSchema = z.string().uuid();

const AddInput = z.object({
  name: NameSchema,
  quantity: QuantitySchema,
  unit: UnitSchema,
  notes: NotesSchema,
});

export async function addShoppingItem(input: z.infer<typeof AddInput>): Promise<ShoppingActionResult<{ itemId: string }>> {
  const parsed = AddInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "SHOPPING_INVALID", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as unknown as Record<string, string> } };
  }
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shopping_list_items")
    .insert({
      household_id: ctx.household.id,
      item_name: parsed.data.name,
      quantity: parsed.data.quantity ?? null,
      unit: parsed.data.unit ?? null,
      notes: parsed.data.notes ?? null,
      created_by_profile_id: ctx.profile.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: { code: "SHOPPING_FORBIDDEN", message: error?.message ?? "Insert failed" } };
  }
  revalidatePath("/shopping");
  return { ok: true, data: { itemId: data.id } };
}

const UpdateInput = z.object({
  itemId: ItemIdSchema,
  name: NameSchema.optional(),
  quantity: QuantitySchema,
  unit: UnitSchema,
  notes: NotesSchema,
});

export async function updateShoppingItem(input: z.infer<typeof UpdateInput>): Promise<ShoppingActionResult<{ itemId: string }>> {
  const parsed = UpdateInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "SHOPPING_INVALID", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as unknown as Record<string, string> } };
  }
  await requireHousehold();
  const supabase = await createClient();

  // Check the row exists and is unbought (bought rows are history-read-only).
  const { data: existing, error: readErr } = await supabase
    .from("shopping_list_items")
    .select("id, bought_at")
    .eq("id", parsed.data.itemId)
    .maybeSingle();
  if (readErr) return { ok: false, error: { code: "SHOPPING_FORBIDDEN", message: readErr.message } };
  if (!existing) return { ok: false, error: { code: "SHOPPING_NOT_FOUND", message: "Item not found" } };
  if (existing.bought_at !== null) {
    return { ok: false, error: { code: "SHOPPING_ITEM_BOUGHT_IMMUTABLE", message: "Bought items can't be edited — undo first." } };
  }

  const patch: Database["public"]["Tables"]["shopping_list_items"]["Update"] = {};
  if (parsed.data.name !== undefined)     patch.item_name = parsed.data.name;
  if (parsed.data.quantity !== undefined) patch.quantity  = parsed.data.quantity ?? null;
  if (parsed.data.unit !== undefined)     patch.unit      = parsed.data.unit ?? null;
  if (parsed.data.notes !== undefined)    patch.notes     = parsed.data.notes ?? null;

  const { error } = await supabase
    .from("shopping_list_items")
    .update(patch)
    .eq("id", parsed.data.itemId);
  if (error) return { ok: false, error: { code: "SHOPPING_FORBIDDEN", message: error.message } };

  revalidatePath("/shopping");
  return { ok: true, data: { itemId: parsed.data.itemId } };
}

export async function markShoppingItemBought(input: { itemId: string }): Promise<ShoppingActionResult<{ itemId: string }>> {
  const parsed = z.object({ itemId: ItemIdSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "SHOPPING_INVALID", message: "Invalid input" } };
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { error } = await supabase
    .from("shopping_list_items")
    .update({ bought_at: new Date().toISOString(), bought_by_profile_id: ctx.profile.id })
    .eq("id", parsed.data.itemId)
    .is("bought_at", null);
  if (error) return { ok: false, error: { code: "SHOPPING_FORBIDDEN", message: error.message } };
  revalidatePath("/shopping");
  return { ok: true, data: { itemId: parsed.data.itemId } };
}

export async function unmarkShoppingItemBought(input: { itemId: string }): Promise<ShoppingActionResult<{ itemId: string }>> {
  const parsed = z.object({ itemId: ItemIdSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "SHOPPING_INVALID", message: "Invalid input" } };
  await requireHousehold();
  const supabase = await createClient();
  const { error } = await supabase
    .from("shopping_list_items")
    .update({ bought_at: null, bought_by_profile_id: null })
    .eq("id", parsed.data.itemId);
  if (error) return { ok: false, error: { code: "SHOPPING_FORBIDDEN", message: error.message } };
  revalidatePath("/shopping");
  return { ok: true, data: { itemId: parsed.data.itemId } };
}

export async function deleteShoppingItem(input: { itemId: string }): Promise<ShoppingActionResult<{ itemId: string }>> {
  const parsed = z.object({ itemId: ItemIdSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "SHOPPING_INVALID", message: "Invalid input" } };
  await requireHousehold();
  const supabase = await createClient();
  const { error } = await supabase
    .from("shopping_list_items")
    .delete()
    .eq("id", parsed.data.itemId);
  if (error) return { ok: false, error: { code: "SHOPPING_FORBIDDEN", message: error.message } };
  revalidatePath("/shopping");
  return { ok: true, data: { itemId: parsed.data.itemId } };
}

export async function autoAddFromPlans(): Promise<ShoppingActionResult<{ insertedCount: number; insertedNames: string[] }>> {
  await requireHousehold();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("shopping_auto_add_from_plans");
  if (error) return { ok: false, error: { code: "SHOPPING_FORBIDDEN", message: error.message } };
  const rows = data ?? [];
  revalidatePath("/shopping");
  return { ok: true, data: { insertedCount: rows.length, insertedNames: rows.map((r) => r.item_name) } };
}

// Type imported at the bottom to keep the Zod schemas at the top scannable.
import type { Database } from "@/lib/db/types";
