"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireHousehold } from "@/lib/auth/require";

const Slot = z.enum(["breakfast", "lunch", "snacks", "dinner"]);
const TimeStr = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

const UpdateSchema = z.object({
  slot: Slot,
  meal_time: TimeStr,
});

export type MealTimeActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export async function updateMealTime(
  input: z.infer<typeof UpdateSchema>,
): Promise<MealTimeActionResult<{ slot: string; meal_time: string }>> {
  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "MT_INVALID", message: "Invalid input" } };
  const ctx = await requireHousehold();
  const supabase = await createClient();
  const { error } = await supabase
    .from("household_meal_times")
    .upsert(
      { household_id: ctx.household.id, slot: parsed.data.slot, meal_time: parsed.data.meal_time },
      { onConflict: "household_id,slot" },
    );
  if (error) return { ok: false, error: { code: "MT_DB", message: error.message } };
  revalidatePath("/household/meal-times");
  revalidatePath("/plan");
  return { ok: true, data: parsed.data };
}
