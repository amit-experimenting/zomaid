// src/app/onboarding/profile/page.tsx
import { redirect } from "next/navigation";
import { requireHousehold } from "@/lib/auth/require";
import { createClient } from "@/lib/supabase/server";
import { TopAppBar } from "@/components/ui/top-app-bar";
import { ProfileForm } from "./profile-form";
import type { HouseholdProfile } from "@/lib/profile/types";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const ctx = await requireHousehold();
  if (ctx.household.maid_mode === "unset") redirect("/dashboard");

  const sp = await searchParams;
  const editMode = sp.edit === "1";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("household_profiles")
    .select("age_groups, pets, work_hours, school_children, has_indoor_plants, has_balcony, has_ac, has_polishables")
    .eq("household_id", ctx.household.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  // If profile exists and we're NOT editing, advance to picker.
  if (data && !editMode) redirect("/onboarding/tasks");

  const initial = (data ?? null) as HouseholdProfile | null;

  return (
    <main>
      <TopAppBar
        title="Set up your household"
        subtitle={editMode ? "Edit household profile" : "Step 1 of 2 — about your home (~30 seconds)"}
      />
      <ProfileForm initial={initial} editMode={editMode} />
    </main>
  );
}
