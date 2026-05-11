"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireHousehold } from "@/lib/auth/require";

const SlotEnum = z.enum(["breakfast", "lunch", "snacks", "dinner"]);
const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export type PlanActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

const SetSchema = z.object({
  planDate: DateString,
  slot: SlotEnum,
  recipeId: z.string().uuid().nullable(),
});

export async function setMealPlanSlot(input: z.infer<typeof SetSchema>): Promise<PlanActionResult<{ recipeId: string | null }>> {
  const parsed = SetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "PLAN_INVALID", message: "Invalid input" } };
  await requireHousehold();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mealplan_set_slot", {
    p_date: parsed.data.planDate,
    p_slot: parsed.data.slot,
    p_recipe_id: parsed.data.recipeId,
  });
  if (error) return { ok: false, error: { code: "PLAN_FORBIDDEN", message: error.message } };
  revalidatePath("/plan");
  revalidatePath(`/plan/${parsed.data.planDate}`);
  return { ok: true, data: { recipeId: data?.recipe_id ?? null } };
}

const GenerateForDateSchema = z.object({ planDate: DateString });

export async function generatePlanForDate(
  input: z.infer<typeof GenerateForDateSchema>,
): Promise<PlanActionResult<{ filled: number }>> {
  const parsed = GenerateForDateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "PLAN_INVALID", message: "Invalid input" } };
  await requireHousehold();
  const supabase = await createClient();
  const slots: Array<z.infer<typeof SlotEnum>> = ["breakfast", "lunch", "snacks", "dinner"];
  let filled = 0;
  for (const slot of slots) {
    const { data, error } = await supabase.rpc("mealplan_regenerate_slot", {
      p_date: parsed.data.planDate,
      p_slot: slot,
    });
    if (error) return { ok: false, error: { code: "PLAN_FORBIDDEN", message: error.message } };
    if (data?.recipe_id) filled += 1;
  }
  revalidatePath("/plan");
  revalidatePath(`/plan/${parsed.data.planDate}`);
  return { ok: true, data: { filled } };
}

const RegenerateSchema = z.object({
  planDate: DateString,
  slot: SlotEnum,
});

export async function regenerateMealPlanSlot(input: z.infer<typeof RegenerateSchema>): Promise<PlanActionResult<{ recipeId: string | null }>> {
  const parsed = RegenerateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "PLAN_INVALID", message: "Invalid input" } };
  await requireHousehold();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mealplan_regenerate_slot", {
    p_date: parsed.data.planDate,
    p_slot: parsed.data.slot,
  });
  if (error) return { ok: false, error: { code: "PLAN_FORBIDDEN", message: error.message } };
  if (!data?.recipe_id) {
    return { ok: false, error: { code: "MEAL_PLAN_NO_ELIGIBLE_RECIPE", message: "No recipes available for this slot." } };
  }
  revalidatePath("/plan");
  revalidatePath(`/plan/${parsed.data.planDate}`);
  return { ok: true, data: { recipeId: data.recipe_id } };
}
