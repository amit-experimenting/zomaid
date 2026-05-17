// src/app/onboarding/profile/actions.ts
"use server";

import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { HouseholdProfile } from "@/lib/profile/types";

export async function saveProfileAction(
  payload: HouseholdProfile,
  // Kept for future extensibility / documentation — `upsert` handles INSERT vs
  // UPDATE transparently, so the current implementation doesn't branch on it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _editMode: boolean,
): Promise<{ error?: string }> {
  const ctx = await requireHousehold();
  if (ctx.household.maid_mode === "unset") {
    return { error: "Household not set up yet." };
  }

  if (payload.age_groups.length === 0) return { error: "Pick at least one age group." };

  const supabase = await createClient();

  const row = {
    household_id: ctx.household.id,
    age_groups: payload.age_groups,
    pets: payload.pets,
    work_hours: payload.work_hours,
    school_children: payload.school_children,
    has_indoor_plants: payload.has_indoor_plants,
    has_balcony: payload.has_balcony,
    has_ac: payload.has_ac,
    has_polishables: payload.has_polishables,
    completed_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("household_profiles")
    .upsert(row, { onConflict: "household_id" });

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  revalidatePath("/onboarding/tasks");
  revalidatePath("/household/settings");

  return {};
}
