import "server-only";
import { getCurrentProfile } from "./current-profile";
import { tryRedeemPendingEmailInvite } from "./redeem-email-invite";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type Membership = Database["public"]["Tables"]["household_memberships"]["Row"];
type Household  = Database["public"]["Tables"]["households"]["Row"];

export type CurrentHousehold = {
  profile: Awaited<ReturnType<typeof getCurrentProfile>>;
  household: Household;
  membership: Membership;
};

export async function getCurrentHousehold(): Promise<CurrentHousehold | null> {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const fetchActive = async () =>
    supabase
      .from("household_memberships")
      .select("*, household:households(*)")
      .eq("profile_id", profile.id)
      .eq("status", "active")
      .order("joined_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);

  let memberships = await fetchActive();
  if (memberships.error) throw new Error(memberships.error.message);
  let row = memberships.data?.[0];

  if (!row) {
    // Try to consume a pending email-whitelisted invite. Silent on failure.
    const redeemed = await tryRedeemPendingEmailInvite(profile.email);
    if (redeemed) {
      memberships = await fetchActive();
      if (memberships.error) throw new Error(memberships.error.message);
      row = memberships.data?.[0];
    }
    if (!row) return null;
  }

  const { household, ...membership } = row as typeof row & { household: Household };
  return { profile, household, membership: membership as Membership };
}
