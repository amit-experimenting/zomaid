import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { TopAppBar } from "@/components/ui/top-app-bar";
import { PersonalProfileForm } from "@/components/profile/personal-profile-form";
import { savePersonalProfile } from "./actions";

export const dynamic = "force-dynamic";

export default async function OnboardingPersonalPage() {
  const profile = await getCurrentProfile();

  if (profile.onboarding_completed_at != null) {
    redirect("/dashboard");
  }

  // Pre-fill name from Clerk when the profile's display_name hasn't been set
  // by the user yet (current-profile.ts seeds it from Clerk on lazy-upsert,
  // so this branch is rarely hit, but keeps the form sensible if it's empty).
  let prefillName = profile.display_name;
  if (!prefillName.trim()) {
    const u = await currentUser();
    const fromClerk = [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();
    prefillName = fromClerk || "";
  }

  return (
    <main className="mx-auto max-w-md">
      <TopAppBar title="Welcome" subtitle="A few quick details (most are optional)" />
      <div className="px-4 py-6">
        <PersonalProfileForm
          initial={{
            display_name: prefillName,
            passport_number: profile.passport_number,
            passport_expiry: profile.passport_expiry,
            preferred_language: profile.preferred_language,
          }}
          action={savePersonalProfile}
          redirectTo="/dashboard"
          submitLabel="Save & continue →"
        />
      </div>
    </main>
  );
}
