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
  if (error) {
    if (error.message.includes("cannot_modify_after_lock")) {
      return { ok: false, error: { code: "PLAN_LOCKED", message: "Meal locked (within 1 hour of start)" } };
    }
    return { ok: false, error: { code: "PLAN_FORBIDDEN", message: error.message } };
  }
  revalidatePath("/dashboard");
  revalidatePath("/recipes");
  return { ok: true, data: { recipeId: data?.recipe_id ?? null } };
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
  if (error) {
    if (error.message.includes("cannot_modify_after_lock")) {
      return { ok: false, error: { code: "PLAN_LOCKED", message: "Meal locked (within 1 hour of start)" } };
    }
    return { ok: false, error: { code: "PLAN_FORBIDDEN", message: error.message } };
  }
  if (!data?.recipe_id) {
    return { ok: false, error: { code: "MEAL_PLAN_NO_ELIGIBLE_RECIPE", message: "No recipes available for this slot." } };
  }
  revalidatePath("/dashboard");
  revalidatePath("/recipes");
  return { ok: true, data: { recipeId: data.recipe_id } };
}

const PeopleEatingSchema = z.object({
  planDate: DateString,
  slot: SlotEnum,
  people: z.number().int().min(1).max(50),
});

export async function setPeopleEating(
  input: z.infer<typeof PeopleEatingSchema>,
): Promise<PlanActionResult<{ recipeId: string | null; peopleEating: number }>> {
  const parsed = PeopleEatingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "PLAN_INVALID", message: "Invalid input" } };
  await requireHousehold();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mealplan_set_people_eating", {
    p_date: parsed.data.planDate,
    p_slot: parsed.data.slot,
    p_people: parsed.data.people,
  });
  if (error) {
    if (error.message.includes("cannot_modify_after_lock")) {
      return { ok: false, error: { code: "PLAN_LOCKED", message: "Meal locked (within 1 hour of start)" } };
    }
    return { ok: false, error: { code: "PLAN_FORBIDDEN", message: error.message } };
  }
  revalidatePath("/dashboard");
  revalidatePath("/recipes");
  return { ok: true, data: { recipeId: data?.recipe_id ?? null, peopleEating: data?.people_eating ?? parsed.data.people } };
}
