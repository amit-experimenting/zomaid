import "server-only";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * If there's a pending invite whose intended_email matches the caller's
 * profile email, redeem the most recent one via the existing redeem_invite
 * RPC (which runs under the caller's JWT and enforces capacity + duplicate
 * checks). Errors are swallowed — a failed auto-redeem is silent; the user
 * can still redeem manually via /join.
 */
export async function tryRedeemPendingEmailInvite(profileEmail: string): Promise<boolean> {
  if (!profileEmail) return false;
  const svc = createServiceClient();
  const pending = await svc
    .from("invites")
    .select("token")
    .ilike("intended_email", profileEmail)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (pending.error || !pending.data?.length) return false;

  const supabase = await createClient();
  const { error } = await supabase.rpc("redeem_invite", { p_token: pending.data[0].token });
  return !error;
}
