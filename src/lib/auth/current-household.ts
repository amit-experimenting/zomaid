import "server-only";
import { getCurrentProfile } from "./current-profile";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

export type Membership = Database["public"]["Tables"]["household_memberships"]["Row"];
export type Household  = Database["public"]["Tables"]["households"]["Row"];

export type CurrentHousehold = {
  profile: Awaited<ReturnType<typeof getCurrentProfile>>;
  household: Household;
  membership: Membership;
};

export async function getCurrentHousehold(): Promise<CurrentHousehold | null> {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const memberships = await supabase
    .from("household_memberships")
    .select("*, household:households(*)")
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .order("joined_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (memberships.error) throw new Error(memberships.error.message);
  const row = memberships.data?.[0];
  if (!row) return null;

  const { household, ...membership } = row as typeof row & { household: Household };
  return { profile, household, membership: membership as Membership };
}
