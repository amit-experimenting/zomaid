import "server-only";
import { redirect } from "next/navigation";
import {
  getCurrentHousehold,
  type CurrentHousehold,
} from "./current-household";
import { getCurrentProfile } from "./current-profile";

export async function requireHousehold(): Promise<CurrentHousehold> {
  const ctx = await getCurrentHousehold();
  if (!ctx) redirect("/onboarding");
  return ctx;
}

/**
 * Resolves to the caller's profile if `is_admin` is true. Redirects to
 * /dashboard otherwise. The is_admin flag is managed by env-sync on boot
 * (ZOMAID_ADMIN_CLERK_USER_IDS) plus the Clerk webhook lazy-upsert.
 */
export async function requireAdmin(): Promise<Awaited<ReturnType<typeof getCurrentProfile>>> {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) redirect("/dashboard");
  return profile;
}
