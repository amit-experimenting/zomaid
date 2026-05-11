"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createServiceClient } from "@/lib/supabase/server";

const ownerSchema = z.object({
  name: z.string().min(1).max(100),
  addressLine: z.string().max(200).optional(),
  postalCode: z.string().max(20).optional(),
});

const maidSchema = z.object({
  ownerName: z.string().min(1).max(100),
});

export async function createHouseholdAsOwner(input: unknown) {
  const data = ownerSchema.parse(input);
  const profile = await getCurrentProfile();
  const svc = createServiceClient();

  const existing = await svc
    .from("household_memberships")
    .select("id")
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .limit(1);
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.length) redirect("/dashboard");

  const h = await svc
    .from("households")
    .insert({
      name: data.name,
      address_line: data.addressLine ?? null,
      postal_code: data.postalCode ?? null,
      created_by_profile_id: profile.id,
    })
    .select("id")
    .single();
  if (h.error) throw new Error(h.error.message);

  const m = await svc.from("household_memberships").insert({
    household_id: h.data.id,
    profile_id: profile.id,
    role: "owner",
    privilege: "full",
    status: "active",
  });
  if (m.error) throw new Error(m.error.message);

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function createHouseholdAsMaid(input: unknown) {
  const data = maidSchema.parse(input);
  const profile = await getCurrentProfile();
  const svc = createServiceClient();

  const existing = await svc
    .from("household_memberships")
    .select("id")
    .eq("profile_id", profile.id)
    .eq("status", "active")
    .limit(1);
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.length) redirect("/dashboard");

  const householdName = `${data.ownerName.trim()}'s household`;

  const h = await svc
    .from("households")
    .insert({
      name: householdName,
      created_by_profile_id: profile.id,
    })
    .select("id")
    .single();
  if (h.error) throw new Error(h.error.message);

  const m = await svc.from("household_memberships").insert({
    household_id: h.data.id,
    profile_id: profile.id,
    role: "maid",
    privilege: "full",
    status: "active",
  });
  if (m.error) throw new Error(m.error.message);

  // Mint pending owner invite
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const token = randomBytes(32).toString("base64url");
  const inv = await svc.from("invites").insert({
    household_id: h.data.id,
    invited_by_profile_id: profile.id,
    intended_role: "owner",
    intended_privilege: "full",
    code,
    token,
  });
  if (inv.error) throw new Error(inv.error.message);

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
