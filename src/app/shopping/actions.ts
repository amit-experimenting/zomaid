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
  // Quantity is required for manual adds — the user wants every shopping
  // row to carry a number so the eventual inventory commit is unambiguous.
  // Auto-add from plans bypasses this (SQL function inserts directly).
  quantity: z.number().positive(),
  unit: UnitSchema,
  notes: NotesSchema,
});

export async function addShoppingItem(input: z.infer<typeof AddInput>): Promise<ShoppingActionResult<{ itemId: string; alreadyExists?: boolean }>> {
  const parsed = AddInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "SHOPPING_INVALID", message: "Invalid input", fieldErrors: parsed.error.flatten().fieldErrors as unknown as Record<string, string> } };
  }
  const ctx = await requireHousehold();
  const supabase = await createClient();

  // If the user already has an unbought row with this name (case-insensitive),
  // return it instead of creating a duplicate. The UI's typeahead catches most
  // cases; this guards against fast Enter-key races.
  const { data: existing } = await supabase
    .from("shopping_list_items")
    .select("id")
    .eq("household_id", ctx.household.id)
    .is("bought_at", null)
    .ilike("item_name", parsed.data.name)
    .maybeSingle();
  if (existing) {
    return { ok: true, data: { itemId: existing.id, alreadyExists: true } };
  }

  const { data, error } = await supabase
    .from("shopping_list_items")
    .insert({
      household_id: ctx.household.id,
      item_name: parsed.data.name,
      quantity: parsed.data.quantity,
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

const SearchInput = z.object({ query: z.string().trim().min(1).max(120) });

export type ShoppingSearchResult = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  boughtAt: string | null;
};

export async function searchShoppingItems(input: { query: string }): Promise<ShoppingActionResult<ShoppingSearchResult[]>> {
  const parsed = SearchInput.safeParse(input);
  if (!parsed.success) {
    return { ok: true, data: [] };
  }
  const ctx = await requireHousehold();
  const supabase = await createClient();
  // Escape ilike wildcards in the user-typed query so a literal % or _ does
  // not act as a wildcard.
  const escaped = parsed.data.query.replace(/[\\%_]/g, (c) => `\\${c}`);
  // Only surface active (non-bought) items in the typeahead. Bought items
  // are committed history; if the user wants the same thing again, adding
  // a fresh row is the right behaviour.
  const { data, error } = await supabase
    .from("shopping_list_items")
    .select("id,item_name,quantity,unit,notes,bought_at,created_at")
    .eq("household_id", ctx.household.id)
    .is("bought_at", null)
    .ilike("item_name", `%${escaped}%`)
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) return { ok: false, error: { code: "SHOPPING_FORBIDDEN", message: error.message } };
  const rows: ShoppingSearchResult[] = (data ?? []).map((r) => ({
    id: r.id,
    name: r.item_name,
    quantity: r.quantity,
    unit: r.unit,
    notes: r.notes,
    boughtAt: r.bought_at,
  }));
  return { ok: true, data: rows };
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

// "Checked" is the in-between state: the user has ticked the box during a
// shopping trip but the row hasn't been committed to inventory yet. Items
// stay on the main list with strikethrough until the end-of-day sweep or a
// matching bill upload moves them to "bought" (history + inventory).
export async function setShoppingItemChecked(input: { itemId: string }): Promise<ShoppingActionResult<{ itemId: string }>> {
  const parsed = z.object({ itemId: ItemIdSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "SHOPPING_INVALID", message: "Invalid input" } };
  await requireHousehold();
  const supabase = await createClient();
  const { error } = await supabase
    .from("shopping_list_items")
    .update({ checked_at: new Date().toISOString() })
    .eq("id", parsed.data.itemId)
    .is("bought_at", null);
  if (error) return { ok: false, error: { code: "SHOPPING_FORBIDDEN", message: error.message } };
  revalidatePath("/shopping");
  return { ok: true, data: { itemId: parsed.data.itemId } };
}

export async function clearShoppingItemChecked(input: { itemId: string }): Promise<ShoppingActionResult<{ itemId: string }>> {
  const parsed = z.object({ itemId: ItemIdSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "SHOPPING_INVALID", message: "Invalid input" } };
  await requireHousehold();
  const supabase = await createClient();
  const { error } = await supabase
    .from("shopping_list_items")
    .update({ checked_at: null })
    .eq("id", parsed.data.itemId)
    .is("bought_at", null);
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
