import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { IconButton } from "@/components/ui/icon-button";
import { TopAppBar } from "@/components/ui/top-app-bar";
import { PersonalProfileForm } from "@/components/profile/personal-profile-form";
import { savePersonalProfile } from "@/app/onboarding/personal/actions";

export const dynamic = "force-dynamic";

export default async function MyProfileSettingsPage() {
  const profile = await getCurrentProfile();

  return (
    <main className="mx-auto max-w-md">
      <TopAppBar
        title="My Profile"
        leading={
          <Link href="/household/settings" aria-label="Back to settings">
            <IconButton aria-label="Back to settings" variant="ghost">
              <ChevronLeft />
            </IconButton>
          </Link>
        }
      />
      <div className="px-4 py-6">
        <PersonalProfileForm
          initial={{
            display_name: profile.display_name,
            passport_number: profile.passport_number,
            passport_expiry: profile.passport_expiry,
            preferred_language: profile.preferred_language,
          }}
          action={savePersonalProfile}
          redirectTo="/household/settings"
          submitLabel="Save changes"
        />
      </div>
    </main>
  );
}
