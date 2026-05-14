"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireHousehold } from "@/lib/auth/require";

export type InventoryActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

const CreateSchema = z.object({
  item_name: z.string().min(1).max(120),
  quantity: z.number().min(0),
  unit: z.string().min(1).max(24),
  low_stock_threshold: z.number().min(0).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function createInventoryItem(
  input: z.infer<typeof CreateSchema>,
): Promise<InventoryActionResult<{ id: string }>> {
  const parsed = CreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "INV_INVALID", message: "Invalid input" } };
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_items")
    .insert({
      household_id: ctx.household.id,
      item_name: parsed.data.item_name,
      quantity: parsed.data.quantity,
      unit: parsed.data.unit,
      low_stock_threshold: parsed.data.low_stock_threshold ?? null,
      notes: parsed.data.notes ?? null,
      created_by_profile_id: ctx.profile.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: { code: "INV_DB", message: error.message } };
  revalidatePath("/inventory");
  return { ok: true, data: { id: data.id } };
}

const UpdateSchema = z.object({
  id: z.string().uuid(),
  item_name: z.string().min(1).max(120).optional(),
  unit: z.string().min(1).max(24).optional(),
  low_stock_threshold: z.number().min(0).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function updateInventoryItem(
  input: z.infer<typeof UpdateSchema>,
): Promise<InventoryActionResult<{ id: string }>> {
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "INV_INVALID", message: "Invalid input" } };
  await requireHousehold();
  const supabase = await createClient();
  const { id, ...rest } = parsed.data;
  const { error } = await supabase.from("inventory_items").update(rest).eq("id", id);
  if (error) return { ok: false, error: { code: "INV_DB", message: error.message } };
  revalidatePath("/inventory");
  revalidatePath(`/inventory/${id}`);
  return { ok: true, data: { id } };
}

const DeleteSchema = z.object({ id: z.string().uuid() });

export async function deleteInventoryItem(
  input: z.infer<typeof DeleteSchema>,
): Promise<InventoryActionResult<{ id: string }>> {
  const parsed = DeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "INV_INVALID", message: "Invalid input" } };
  await requireHousehold();
  const supabase = await createClient();
  const { error } = await supabase.from("inventory_items").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, error: { code: "INV_DB", message: error.message } };
  revalidatePath("/inventory");
  return { ok: true, data: { id: parsed.data.id } };
}

const AdjustSchema = z.object({
  id: z.string().uuid(),
  delta: z.number(),
  notes: z.string().max(500).optional(),
});

export async function adjustInventoryItem(
  input: z.infer<typeof AdjustSchema>,
): Promise<InventoryActionResult<{ id: string; quantity: number }>> {
  const parsed = AdjustSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "INV_INVALID", message: "Invalid input" } };
  await requireHousehold();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inventory_manual_adjust", {
    p_item_id: parsed.data.id,
    p_delta: parsed.data.delta,
    p_notes: parsed.data.notes ?? "",
  });
  if (error) return { ok: false, error: { code: "INV_DB", message: error.message } };
  revalidatePath("/inventory");
  revalidatePath(`/inventory/${parsed.data.id}`);
  const row = data as { id: string; quantity: number } | null;
  if (!row) return { ok: false, error: { code: "INV_DB", message: "no row" } };
  return { ok: true, data: { id: row.id, quantity: row.quantity } };
}

const DismissCardSchema = z.object({});

export async function dismissInventoryCard(): Promise<InventoryActionResult<null>> {
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { error } = await supabase
    .from("households")
    .update({ inventory_card_dismissed_at: new Date().toISOString() })
    .eq("id", ctx.household.id);
  if (error) return { ok: false, error: { code: "INV_DB", message: error.message } };
  revalidatePath("/dashboard");
  return { ok: true, data: null };
}
