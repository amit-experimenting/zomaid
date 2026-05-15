"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { getCurrentHousehold } from "@/lib/auth/current-household";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Privilege, Role } from "@/lib/db/types";

const createInviteSchema = z.object({
  role: z.enum(["owner", "family_member", "maid"]),
  privilege: z.enum(["full", "meal_modify", "view_only"]).optional(),
  // Optional whitelist email. Empty string is treated as absent.
  email: z
    .union([z.literal(""), z.string().trim().toLowerCase().email()])
    .optional(),
});

export async function createInvite(input: unknown) {
  const data = createInviteSchema.parse(input);
  const email = data.email && data.email.length > 0 ? data.email : null;
  const ctx = await getCurrentHousehold();
  if (!ctx) throw new Error("no active household");
  const { household, membership, profile } = ctx;

  // Spec §5.3 invariants
  if (data.role === "owner" && membership.role !== "maid") {
    throw new Error("only the maid can invite the owner");
  }
  if (data.role !== "owner" && membership.role !== "owner") {
    throw new Error("only an owner can invite this role");
  }

  const svc = createServiceClient();

  if (data.role === "maid") {
    const has = await svc
      .from("household_memberships")
      .select("id")
      .eq("household_id", household.id)
      .eq("role", "maid")
      .eq("status", "active")
      .limit(1);
    if (has.error) throw new Error(has.error.message);
    if (has.data?.length) throw new Error("household already has an active maid");
  }
  if (data.role === "owner") {
    const has = await svc
      .from("household_memberships")
      .select("id")
      .eq("household_id", household.id)
      .eq("role", "owner")
      .eq("status", "active")
      .limit(1);
    if (has.error) throw new Error(has.error.message);
    if (has.data?.length) throw new Error("household already has an active owner");
  }

  if (email) {
    // App-level duplicate guard: turns the partial unique index into a clean
    // error instead of a 23505 from the insert below.
    const dupe = await svc
      .from("invites")
      .select("id")
      .eq("household_id", household.id)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .ilike("intended_email", email)
      .limit(1);
    if (dupe.error) throw new Error(dupe.error.message);
    if (dupe.data?.length) {
      throw new Error("an unconsumed invite for that email already exists");
    }
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const token = randomBytes(32).toString("base64url");

  const inv = await svc
    .from("invites")
    .insert({
      household_id: household.id,
      invited_by_profile_id: profile.id,
      intended_role: data.role as Role,
      intended_privilege:
        data.role === "family_member" ? (data.privilege ?? "view_only") : ("full" as Privilege),
      code,
      token,
      intended_email: email,
    })
    .select("code, token")
    .single();
  if (inv.error) throw new Error(inv.error.message);

  revalidatePath("/household/settings");
  revalidatePath("/dashboard");
  return { code: inv.data.code, token: inv.data.token };
}

const revokeSchema = z.object({ inviteId: z.uuid() });
export async function revokeInvite(input: unknown) {
  const data = revokeSchema.parse(input);
  const ctx = await getCurrentHousehold();
  if (!ctx) throw new Error("no active household");
  const svc = createServiceClient();

  const found = await svc
    .from("invites")
    .select("household_id, invited_by_profile_id, consumed_at")
    .eq("id", data.inviteId)
    .maybeSingle();
  if (found.error) throw new Error(found.error.message);
  const invite = found.data;
  if (!invite) throw new Error("invite not found");
  if (invite.consumed_at !== null) throw new Error("invite already consumed");
  if (invite.household_id !== ctx.household.id) throw new Error("forbidden");
  const isOwner = ctx.membership.role === "owner";
  const isInviter = invite.invited_by_profile_id === ctx.profile.id;
  if (!isOwner && !isInviter) throw new Error("forbidden");

  // Mark consumed (not expired) so the partial unique index on (code) where
  // consumed_at is null releases the slot for reuse.
  const { error } = await svc
    .from("invites")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", data.inviteId);
  if (error) throw new Error(error.message);
  revalidatePath("/household/settings");
  revalidatePath("/dashboard");
}

const redeemSchema = z.object({
  tokenOrCode: z.string().min(1).max(200),
});
export async function redeemInvite(input: unknown) {
  const data = redeemSchema.parse(input);
  const ctx = await getCurrentHousehold();
  if (ctx) redirect("/dashboard"); // already in a household; can't accept another in v1

  const svc = createServiceClient();

  // Resolve a code to a token if needed
  let token = data.tokenOrCode.trim();
  if (/^\d{6}$/.test(token)) {
    const r = await svc
      .from("invites")
      .select("token")
      .eq("code", token)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);
    if (r.error) throw new Error(r.error.message);
    const found = r.data?.[0]?.token;
    if (!found) throw new Error("invite not found or expired");
    token = found;
  }

  // The redeem_invite RPC requires the caller's Clerk JWT (auth.jwt()->>'sub');
  // the service-role client carries no JWT, so call it via the Clerk-bearing client.
  const supabase = await createClient();
  const rpc = await supabase.rpc("redeem_invite", { p_token: token });
  if (rpc.error) throw new Error(rpc.error.message);

  // Caller is responsible for revalidatePath: this function is invoked from
  // /join/[token] during page render, where revalidatePath is not allowed.
  redirect("/dashboard");
}

const removeSchema = z.object({ membershipId: z.uuid() });
export async function removeMembership(input: unknown) {
  const data = removeSchema.parse(input);
  const ctx = await getCurrentHousehold();
  if (!ctx) throw new Error("no active household");

  const svc = createServiceClient();
  const target = await svc
    .from("household_memberships")
    .select("*")
    .eq("id", data.membershipId)
    .single();
  if (target.error) throw new Error(target.error.message);

  const targetRow = target.data;
  if (targetRow.household_id !== ctx.household.id) throw new Error("forbidden");

  const isSelfLeave = targetRow.profile_id === ctx.profile.id;
  const isOwnerAction = ctx.membership.role === "owner";
  if (!isSelfLeave && !isOwnerAction) throw new Error("forbidden");

  if (targetRow.role === "owner" && isSelfLeave) {
    // Spec §5.6 — disallowed in v1
    throw new Error("an owner cannot self-leave; transfer ownership first (not in v1)");
  }

  const { error } = await svc
    .from("household_memberships")
    .update({ status: "removed", removed_at: new Date().toISOString() })
    .eq("id", data.membershipId);
  if (error) throw new Error(error.message);

  revalidatePath("/household/settings");
  revalidatePath("/dashboard");
}

const updatePrivSchema = z.object({
  membershipId: z.uuid(),
  privilege: z.enum(["full", "meal_modify", "view_only"]),
});
export async function updateMembershipPrivilege(input: unknown) {
  const data = updatePrivSchema.parse(input);
  const ctx = await getCurrentHousehold();
  if (!ctx) throw new Error("no active household");
  if (ctx.membership.role !== "owner") throw new Error("only the owner can change privileges");

  const svc = createServiceClient();
  const target = await svc
    .from("household_memberships")
    .select("household_id, role")
    .eq("id", data.membershipId)
    .single();
  if (target.error) throw new Error(target.error.message);
  if (target.data.household_id !== ctx.household.id) throw new Error("forbidden");
  if (target.data.role !== "family_member")
    throw new Error("privilege only applies to family members");

  const { error } = await svc
    .from("household_memberships")
    .update({ privilege: data.privilege })
    .eq("id", data.membershipId);
  if (error) throw new Error(error.message);

  revalidatePath("/household/settings");
}
