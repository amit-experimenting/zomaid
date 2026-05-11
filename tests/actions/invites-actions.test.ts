import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mockClerk } from "../helpers/clerk";
import { expectRedirect, mockNextStubs } from "../helpers/next";
import {
  cleanupRows,
  createHousehold,
  createInvite,
  createMembership,
  createProfile,
  serviceClient,
} from "../helpers/supabase-test-client";

type Ids = {
  profiles: string[];
  households: string[];
  memberships: string[];
  invites: string[];
};

function freshIds(): Ids {
  return { profiles: [], households: [], memberships: [], invites: [] };
}

async function cleanupAll(ids: Ids): Promise<void> {
  await cleanupRows("household_memberships", ids.memberships.splice(0));
  await cleanupRows("invites", ids.invites.splice(0));
  await cleanupRows("households", ids.households.splice(0));
  await cleanupRows("profiles", ids.profiles.splice(0));
}

describe("createInvite (action)", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("owner can create a family_member invite with a privilege", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const m = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(m.id);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { createInvite: action } = await import(
      "@/app/household/settings/actions"
    );
    const result = await action({
      role: "family_member",
      privilege: "meal_modify",
    });

    expect(typeof result.code).toBe("string");
    expect(result.code).toMatch(/^\d{6}$/);
    expect(typeof result.token).toBe("string");
    expect(result.token.length).toBeGreaterThan(10);

    const { data: row } = await serviceClient()
      .from("invites")
      .select("id, intended_role, intended_privilege, invited_by_profile_id")
      .eq("token", result.token)
      .single();
    expect(row?.intended_role).toBe("family_member");
    expect(row?.intended_privilege).toBe("meal_modify");
    expect(row?.invited_by_profile_id).toBe(owner.id);
    if (row?.id) ids.invites.push(row.id);
  });

  it("maid can create an owner invite; cannot create a family_member invite", async () => {
    const maid = await createProfile();
    ids.profiles.push(maid.id);
    const stubOwner = await createProfile();
    ids.profiles.push(stubOwner.id);
    const h = await createHousehold({ created_by_profile_id: stubOwner.id });
    ids.households.push(h.id);
    const m = await createMembership({
      household_id: h.id,
      profile_id: maid.id,
      role: "maid",
    });
    ids.memberships.push(m.id);

    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();
    const { createInvite: action } = await import(
      "@/app/household/settings/actions"
    );

    const ok = await action({ role: "owner" });
    expect(ok.token.length).toBeGreaterThan(0);
    const { data: ownerInv } = await serviceClient()
      .from("invites")
      .select("id")
      .eq("token", ok.token)
      .single();
    if (ownerInv?.id) ids.invites.push(ownerInv.id);

    await expect(action({ role: "family_member" })).rejects.toThrow(
      /only an owner can invite this role/,
    );
  });

  it("owner cannot create an owner invite", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const m = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(m.id);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { createInvite: action } = await import(
      "@/app/household/settings/actions"
    );

    await expect(action({ role: "owner" })).rejects.toThrow(
      /only the maid can invite the owner/,
    );
  });

  it("rejects creating a maid invite when an active maid already exists", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const maid = await createProfile();
    ids.profiles.push(maid.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const mOwner = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(mOwner.id);
    const mMaid = await createMembership({
      household_id: h.id,
      profile_id: maid.id,
      role: "maid",
    });
    ids.memberships.push(mMaid.id);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { createInvite: action } = await import(
      "@/app/household/settings/actions"
    );

    await expect(action({ role: "maid" })).rejects.toThrow(
      /already has an active maid/,
    );
  });
});

describe("revokeInvite (action)", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("owner can revoke an invite for their household (I4: marks consumed_at, leaves expires_at)", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const m = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(m.id);
    const originalExpiry = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const inv = await createInvite({
      household_id: h.id,
      invited_by_profile_id: owner.id,
      intended_role: "family_member",
      intended_privilege: "view_only",
      expires_at: originalExpiry,
    });
    ids.invites.push(inv.id);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { revokeInvite } = await import("@/app/household/settings/actions");
    await revokeInvite({ inviteId: inv.id });

    const { data: after } = await serviceClient()
      .from("invites")
      .select("consumed_at, expires_at")
      .eq("id", inv.id)
      .single();
    // I4: consumed_at set
    expect(after?.consumed_at).not.toBeNull();
    // I4: expires_at NOT bumped to now() — still original 7-day-out value
    expect(after?.expires_at).toBe(originalExpiry);
  });

  it("C2: caller from a different household cannot revoke", async () => {
    const ownerH1 = await createProfile();
    ids.profiles.push(ownerH1.id);
    const ownerH2 = await createProfile();
    ids.profiles.push(ownerH2.id);
    const h1 = await createHousehold({ created_by_profile_id: ownerH1.id });
    ids.households.push(h1.id);
    const h2 = await createHousehold({ created_by_profile_id: ownerH2.id });
    ids.households.push(h2.id);
    const mH1 = await createMembership({
      household_id: h1.id,
      profile_id: ownerH1.id,
      role: "owner",
    });
    ids.memberships.push(mH1.id);
    const mH2 = await createMembership({
      household_id: h2.id,
      profile_id: ownerH2.id,
      role: "owner",
    });
    ids.memberships.push(mH2.id);
    const invH1 = await createInvite({
      household_id: h1.id,
      invited_by_profile_id: ownerH1.id,
      intended_role: "family_member",
    });
    ids.invites.push(invH1.id);

    mockClerk({ clerkUserId: ownerH2.clerk_user_id });
    mockNextStubs();
    const { revokeInvite } = await import("@/app/household/settings/actions");
    await expect(revokeInvite({ inviteId: invH1.id })).rejects.toThrow(
      /forbidden/,
    );

    const { data: after } = await serviceClient()
      .from("invites")
      .select("consumed_at")
      .eq("id", invH1.id)
      .single();
    expect(after?.consumed_at).toBeNull();
  });

  it("C2: non-owner non-inviter cannot revoke", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const fam = await createProfile();
    ids.profiles.push(fam.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const mOwner = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(mOwner.id);
    const mFam = await createMembership({
      household_id: h.id,
      profile_id: fam.id,
      role: "family_member",
    });
    ids.memberships.push(mFam.id);
    const inv = await createInvite({
      household_id: h.id,
      invited_by_profile_id: owner.id,
      intended_role: "family_member",
    });
    ids.invites.push(inv.id);

    mockClerk({ clerkUserId: fam.clerk_user_id });
    mockNextStubs();
    const { revokeInvite } = await import("@/app/household/settings/actions");
    await expect(revokeInvite({ inviteId: inv.id })).rejects.toThrow(
      /forbidden/,
    );

    const { data: after } = await serviceClient()
      .from("invites")
      .select("consumed_at")
      .eq("id", inv.id)
      .single();
    expect(after?.consumed_at).toBeNull();
  });

  it("inviter (maid) can revoke their own invite", async () => {
    // Only owner/maid can invite, so an inviter is always one of those.
    // Set up: maid creates an invite, then revokes it (not the owner).
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const maid = await createProfile();
    ids.profiles.push(maid.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const mOwner = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(mOwner.id);
    const mMaid = await createMembership({
      household_id: h.id,
      profile_id: maid.id,
      role: "maid",
    });
    ids.memberships.push(mMaid.id);
    // Invite created by the maid (owner-role invite is the only thing a maid
    // can mint, but the action's inviter check is independent of intended_role).
    const inv = await createInvite({
      household_id: h.id,
      invited_by_profile_id: maid.id,
      intended_role: "owner",
      intended_privilege: "full",
    });
    ids.invites.push(inv.id);

    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();
    const { revokeInvite } = await import("@/app/household/settings/actions");
    await revokeInvite({ inviteId: inv.id });

    const { data: after } = await serviceClient()
      .from("invites")
      .select("consumed_at")
      .eq("id", inv.id)
      .single();
    expect(after?.consumed_at).not.toBeNull();
  });

  it("throws on already-consumed invite", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const m = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(m.id);
    const inv = await createInvite({
      household_id: h.id,
      invited_by_profile_id: owner.id,
      intended_role: "family_member",
      consumed_at: new Date(Date.now() - 60_000).toISOString(),
    });
    ids.invites.push(inv.id);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { revokeInvite } = await import("@/app/household/settings/actions");
    await expect(revokeInvite({ inviteId: inv.id })).rejects.toThrow(
      /already consumed/,
    );
  });

  it("throws on nonexistent inviteId", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const m = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(m.id);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { revokeInvite } = await import("@/app/household/settings/actions");
    await expect(
      revokeInvite({ inviteId: randomUUID() }),
    ).rejects.toThrow(/invite not found/);
  });
});

describe("redeemInvite (action)", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("C1: redeem succeeds end-to-end via the Clerk-JWT path", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const fam = await createProfile();
    ids.profiles.push(fam.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const m = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(m.id);
    const inv = await createInvite({
      household_id: h.id,
      invited_by_profile_id: owner.id,
      intended_role: "family_member",
      intended_privilege: "meal_modify",
    });
    ids.invites.push(inv.id);

    mockClerk({ clerkUserId: fam.clerk_user_id });
    mockNextStubs();
    const { redeemInvite } = await import("@/app/household/settings/actions");

    // C1: a redirect (not a thrown "not authenticated") proves the RPC saw
    // auth.jwt()->>'sub' through the Clerk-JWT client, not the service-role one.
    await expectRedirect(
      redeemInvite({ tokenOrCode: inv.token }),
      "/dashboard",
    );

    const { data: membership } = await serviceClient()
      .from("household_memberships")
      .select("id, role, privilege, status")
      .eq("household_id", h.id)
      .eq("profile_id", fam.id)
      .single();
    expect(membership?.role).toBe("family_member");
    expect(membership?.privilege).toBe("meal_modify");
    expect(membership?.status).toBe("active");
    if (membership?.id) ids.memberships.push(membership.id);

    const { data: inviteAfter } = await serviceClient()
      .from("invites")
      .select("consumed_at, consumed_by_profile_id")
      .eq("id", inv.id)
      .single();
    expect(inviteAfter?.consumed_at).not.toBeNull();
    expect(inviteAfter?.consumed_by_profile_id).toBe(fam.id);
  });

  it("redeems by 6-digit code (not token)", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const fam = await createProfile();
    ids.profiles.push(fam.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const m = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(m.id);
    const inv = await createInvite({
      household_id: h.id,
      invited_by_profile_id: owner.id,
      intended_role: "family_member",
      intended_privilege: "view_only",
    });
    ids.invites.push(inv.id);

    mockClerk({ clerkUserId: fam.clerk_user_id });
    mockNextStubs();
    const { redeemInvite } = await import("@/app/household/settings/actions");

    await expectRedirect(
      redeemInvite({ tokenOrCode: inv.code }),
      "/dashboard",
    );

    const { data: membership } = await serviceClient()
      .from("household_memberships")
      .select("id, role, privilege, status")
      .eq("household_id", h.id)
      .eq("profile_id", fam.id)
      .single();
    expect(membership?.role).toBe("family_member");
    expect(membership?.status).toBe("active");
    if (membership?.id) ids.memberships.push(membership.id);
  });

  it("short-circuits to /dashboard if caller already has an active household", async () => {
    const ownerH1 = await createProfile();
    ids.profiles.push(ownerH1.id);
    const ownerH2 = await createProfile();
    ids.profiles.push(ownerH2.id);
    const h1 = await createHousehold({ created_by_profile_id: ownerH1.id });
    ids.households.push(h1.id);
    const h2 = await createHousehold({ created_by_profile_id: ownerH2.id });
    ids.households.push(h2.id);
    const mH1 = await createMembership({
      household_id: h1.id,
      profile_id: ownerH1.id,
      role: "owner",
    });
    ids.memberships.push(mH1.id);
    const mH2 = await createMembership({
      household_id: h2.id,
      profile_id: ownerH2.id,
      role: "owner",
    });
    ids.memberships.push(mH2.id);
    const inv = await createInvite({
      household_id: h2.id,
      invited_by_profile_id: ownerH2.id,
      intended_role: "family_member",
    });
    ids.invites.push(inv.id);

    mockClerk({ clerkUserId: ownerH1.clerk_user_id });
    mockNextStubs();
    const { redeemInvite } = await import("@/app/household/settings/actions");
    await expectRedirect(
      redeemInvite({ tokenOrCode: inv.token }),
      "/dashboard",
    );

    const { data: after } = await serviceClient()
      .from("invites")
      .select("consumed_at")
      .eq("id", inv.id)
      .single();
    expect(after?.consumed_at).toBeNull();
  });

  it("throws on already-consumed invite", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const fam = await createProfile();
    ids.profiles.push(fam.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const m = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(m.id);
    const inv = await createInvite({
      household_id: h.id,
      invited_by_profile_id: owner.id,
      intended_role: "family_member",
      consumed_at: new Date(Date.now() - 60_000).toISOString(),
    });
    ids.invites.push(inv.id);

    mockClerk({ clerkUserId: fam.clerk_user_id });
    mockNextStubs();
    const { redeemInvite } = await import("@/app/household/settings/actions");
    await expect(redeemInvite({ tokenOrCode: inv.token })).rejects.toThrow(
      /already consumed/,
    );
  });

  it("throws on expired invite", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const fam = await createProfile();
    ids.profiles.push(fam.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const m = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(m.id);
    const inv = await createInvite({
      household_id: h.id,
      invited_by_profile_id: owner.id,
      intended_role: "family_member",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    ids.invites.push(inv.id);

    mockClerk({ clerkUserId: fam.clerk_user_id });
    mockNextStubs();
    const { redeemInvite } = await import("@/app/household/settings/actions");
    await expect(redeemInvite({ tokenOrCode: inv.token })).rejects.toThrow(
      /expired/,
    );
  });
});
