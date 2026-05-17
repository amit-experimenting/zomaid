"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createServiceClient } from "@/lib/supabase/server";
import { personalProfileSchema } from "@/lib/profile/personal";

const ALLOWED_REDIRECTS = new Set(["/dashboard", "/household/settings"]);

export async function savePersonalProfile(formData: FormData): Promise<void> {
  const parsed = personalProfileSchema.parse({
    display_name:       formData.get("display_name")       ?? "",
    passport_number:    formData.get("passport_number")    ?? "",
    passport_expiry:    formData.get("passport_expiry")    ?? "",
    preferred_language: formData.get("preferred_language") ?? "",
  });

  const rawRedirect = String(formData.get("redirect_to") ?? "/dashboard");
  const target = ALLOWED_REDIRECTS.has(rawRedirect) ? rawRedirect : "/dashboard";

  const profile = await getCurrentProfile();
  const svc = createServiceClient();

  // Stamp onboarding_completed_at only if currently NULL: first save through
  // any surface marks the user as onboarded; later edits leave it alone.
  const update: Record<string, unknown> = {
    display_name:       parsed.display_name,
    passport_number:    parsed.passport_number,
    passport_expiry:    parsed.passport_expiry,
    preferred_language: parsed.preferred_language,
  };
  if (profile.onboarding_completed_at == null) {
    update.onboarding_completed_at = new Date().toISOString();
  }

  const { error } = await svc
    .from("profiles")
    .update(update)
    .eq("id", profile.id);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard");
  revalidatePath("/household/settings");
  redirect(target);
}
