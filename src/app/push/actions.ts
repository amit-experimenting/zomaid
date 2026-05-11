"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";

export type PushActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

const SubscribeInput = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  userAgent: z.string().max(500).optional(),
});

export async function subscribePush(input: z.infer<typeof SubscribeInput>): Promise<PushActionResult<{ subscriptionId: string }>> {
  const parsed = SubscribeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "PUSH_SUBSCRIPTION_INVALID", message: "Invalid input" } };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: { code: "PUSH_SUBSCRIPTION_INVALID", message: "No profile" } };
  const supabase = await createClient();

  // If a row with this endpoint already exists (re-subscribe on same device),
  // revoke any stale rows and insert a fresh one tied to the current profile.
  await supabase
    .from("push_subscriptions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("endpoint", parsed.data.endpoint)
    .is("revoked_at", null);

  const { data, error } = await supabase
    .from("push_subscriptions")
    .insert({
      profile_id: profile.id,
      endpoint: parsed.data.endpoint,
      p256dh_key: parsed.data.p256dh,
      auth_key: parsed.data.auth,
      user_agent: parsed.data.userAgent ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: { code: "PUSH_SUBSCRIPTION_INVALID", message: error?.message ?? "Insert failed" } };

  return { ok: true, data: { subscriptionId: data.id } };
}

const UnsubscribeInput = z.object({ endpoint: z.string().url() });

export async function unsubscribePush(input: z.infer<typeof UnsubscribeInput>): Promise<PushActionResult<{ revoked: number }>> {
  const parsed = UnsubscribeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "PUSH_SUBSCRIPTION_INVALID", message: "Invalid input" } };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: { code: "PUSH_SUBSCRIPTION_INVALID", message: "No profile" } };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("push_subscriptions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("profile_id", profile.id)
    .eq("endpoint", parsed.data.endpoint)
    .is("revoked_at", null)
    .select("id");
  if (error) return { ok: false, error: { code: "PUSH_SUBSCRIPTION_INVALID", message: error.message } };
  return { ok: true, data: { revoked: data?.length ?? 0 } };
}
