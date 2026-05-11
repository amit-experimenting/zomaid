"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentHousehold } from "@/lib/auth/current-household";
import { createServiceClient } from "@/lib/supabase/server";
import { createInvite, revokeInvite } from "@/app/household/settings/actions";

export async function inviteMaidFromHome() {
  const ctx = await getCurrentHousehold();
  if (!ctx) throw new Error("no active household");
  if (ctx.membership.role !== "owner") throw new Error("only the owner can invite a maid");

  // Idempotency: if a pending maid invite already exists for this household,
  // reuse it instead of creating a second one (defends against double-tap).
  const svc = createServiceClient();
  const existing = await svc
    .from("invites")
    .select("id, code, token")
    .eq("household_id", ctx.household.id)
    .eq("intended_role", "maid")
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.length) {
    revalidatePath("/dashboard");
    return { code: existing.data[0].code, token: existing.data[0].token };
  }

  const created = await createInvite({ role: "maid" });
  revalidatePath("/dashboard");
  return created;
}

const revokeSchema = z.object({ inviteId: z.uuid() });
export async function revokeMaidInviteFromHome(input: unknown) {
  const data = revokeSchema.parse(input);
  await revokeInvite({ inviteId: data.inviteId });
  revalidatePath("/dashboard");
}
