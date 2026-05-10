import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/**
 * Returns the caller's profile row, lazily upserting one from Clerk if missing
 * (backstop for delayed/lost user.created webhooks).
 * Throws when caller is not signed in.
 */
export async function getCurrentProfile(): Promise<Profile> {
  const { userId } = await auth();
  if (!userId) throw new Error("not authenticated");

  const svc = createServiceClient();
  const existing = await svc
    .from("profiles")
    .select("*")
    .eq("clerk_user_id", userId)
    .maybeSingle();
  if (existing.data) return existing.data;

  const u = await currentUser();
  const email =
    u?.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)
      ?.emailAddress ??
    u?.emailAddresses[0]?.emailAddress ??
    "";
  const display = [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();

  const inserted = await svc
    .from("profiles")
    .insert({
      clerk_user_id: userId,
      email,
      display_name: display || email.split("@")[0] || "User",
    })
    .select("*")
    .single();
  if (inserted.error) throw new Error(inserted.error.message);
  return inserted.data;
}
