// Action-level tests for tryRedeemPendingEmailInvite (src/lib/auth/redeem-email-invite.ts).
//
// Silent-failure surface. The helper runs inside getCurrentHousehold() on
// every authenticated request that lacks an active membership. Its contract:
//   1. find the most-recent unconsumed/unexpired invite whose intended_email
//      matches the caller's profile email (case-insensitive),
//   2. call redeem_invite RPC under the caller's JWT,
//   3. SWALLOW any error and return false — auto-redeem must NEVER throw
//      out of getCurrentHousehold, or every page that calls it will crash.
//
// These tests pin both halves: the happy path actually mints a membership,
// and the various "no match" / "error" paths return false cleanly.
//
// We talk to a real local Supabase over HTTP — Clerk is mocked so the helper
// can build a JWT-authed client and call the RPC end-to-end. We import the
// helper directly (rather than going through getCurrentHousehold) so we can
// observe the boolean return value.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClerk } from "../helpers/clerk";
import { mockNextStubs } from "../helpers/next";
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

/**
 * Attach an `intended_email` to an invite. The factory doesn't take this
 * column, so we patch via service-role REST after creation.
 */
async function setInviteEmail(inviteId: string, email: string | null): Promise<void> {
  const { error } = await serviceClient()
    .from("invites")
    .update({ intended_email: email } as never)
    .eq("id", inviteId);
  if (error) throw new Error(`setInviteEmail failed: ${error.message}`);
}

describe("tryRedeemPendingEmailInvite", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("happy path: invite with matching intended_email is redeemed and membership appears", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const callerEmail = `caller-${Date.now()}@example.com`;
    const caller = await createProfile({ email: callerEmail });
    ids.profiles.push(caller.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const mOwner = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(mOwner.id);
    const inv = await createInvite({
      household_id: h.id,
      invited_by_profile_id: owner.id,
      intended_role: "family_member",
      intended_privilege: "meal_modify",
    });
    ids.invites.push(inv.id);
    await setInviteEmail(inv.id, callerEmail);

    mockClerk({ clerkUserId: caller.clerk_user_id, email: callerEmail });
    mockNextStubs();
    const { tryRedeemPendingEmailInvite } = await import(
      "@/lib/auth/redeem-email-invite"
    );

    const redeemed = await tryRedeemPendingEmailInvite(callerEmail);
    expect(redeemed).toBe(true);

    const { data: membership } = await serviceClient()
      .from("household_memberships")
      .select("id, role, privilege, status")
      .eq("household_id", h.id)
      .eq("profile_id", caller.id)
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
    expect(inviteAfter?.consumed_by_profile_id).toBe(caller.id);
  });

  it("matches case-insensitively (ilike) — uppercase invite email vs lowercase caller email", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const callerEmail = `mixed-${Date.now()}@example.com`;
    const caller = await createProfile({ email: callerEmail });
    ids.profiles.push(caller.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const mOwner = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(mOwner.id);
    const inv = await createInvite({
      household_id: h.id,
      invited_by_profile_id: owner.id,
      intended_role: "family_member",
    });
    ids.invites.push(inv.id);
    // Store invite email in uppercase; query argument is lowercase.
    await setInviteEmail(inv.id, callerEmail.toUpperCase());

    mockClerk({ clerkUserId: caller.clerk_user_id, email: callerEmail });
    mockNextStubs();
    const { tryRedeemPendingEmailInvite } = await import(
      "@/lib/auth/redeem-email-invite"
    );

    const redeemed = await tryRedeemPendingEmailInvite(callerEmail);
    expect(redeemed).toBe(true);

    const { data: membership } = await serviceClient()
      .from("household_memberships")
      .select("id")
      .eq("household_id", h.id)
      .eq("profile_id", caller.id)
      .single();
    if (membership?.id) ids.memberships.push(membership.id);
    expect(membership?.id).toBeDefined();
  });

  it("returns false when the caller has no pending invite — no-op", async () => {
    const orphanEmail = `nobody-${Date.now()}@example.com`;
    const orphan = await createProfile({ email: orphanEmail });
    ids.profiles.push(orphan.id);

    mockClerk({ clerkUserId: orphan.clerk_user_id, email: orphanEmail });
    mockNextStubs();
    const { tryRedeemPendingEmailInvite } = await import(
      "@/lib/auth/redeem-email-invite"
    );

    const redeemed = await tryRedeemPendingEmailInvite(orphanEmail);
    expect(redeemed).toBe(false);

    // No membership should have been minted.
    const { data: rows } = await serviceClient()
      .from("household_memberships")
      .select("id")
      .eq("profile_id", orphan.id);
    expect(rows ?? []).toHaveLength(0);
  });

  it("returns false (and leaves the invite alone) when an invite exists for a DIFFERENT email", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const callerEmail = `me-${Date.now()}@example.com`;
    const caller = await createProfile({ email: callerEmail });
    ids.profiles.push(caller.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const mOwner = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(mOwner.id);
    const inv = await createInvite({
      household_id: h.id,
      invited_by_profile_id: owner.id,
      intended_role: "family_member",
    });
    ids.invites.push(inv.id);
    // Invite is for someone else.
    await setInviteEmail(inv.id, `someone-else-${Date.now()}@example.com`);

    mockClerk({ clerkUserId: caller.clerk_user_id, email: callerEmail });
    mockNextStubs();
    const { tryRedeemPendingEmailInvite } = await import(
      "@/lib/auth/redeem-email-invite"
    );

    const redeemed = await tryRedeemPendingEmailInvite(callerEmail);
    expect(redeemed).toBe(false);

    // Invite untouched.
    const { data: inviteAfter } = await serviceClient()
      .from("invites")
      .select("consumed_at")
      .eq("id", inv.id)
      .single();
    expect(inviteAfter?.consumed_at).toBeNull();
  });

  it("returns false when the matching invite is expired", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const callerEmail = `exp-${Date.now()}@example.com`;
    const caller = await createProfile({ email: callerEmail });
    ids.profiles.push(caller.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const mOwner = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(mOwner.id);
    const inv = await createInvite({
      household_id: h.id,
      invited_by_profile_id: owner.id,
      intended_role: "family_member",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    ids.invites.push(inv.id);
    await setInviteEmail(inv.id, callerEmail);

    mockClerk({ clerkUserId: caller.clerk_user_id, email: callerEmail });
    mockNextStubs();
    const { tryRedeemPendingEmailInvite } = await import(
      "@/lib/auth/redeem-email-invite"
    );

    const redeemed = await tryRedeemPendingEmailInvite(callerEmail);
    expect(redeemed).toBe(false);

    // Still unconsumed (the pending-query filtered it out before the RPC).
    const { data: inviteAfter } = await serviceClient()
      .from("invites")
      .select("consumed_at")
      .eq("id", inv.id)
      .single();
    expect(inviteAfter?.consumed_at).toBeNull();
  });

  it("returns false when the matching invite is already consumed", async () => {
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const callerEmail = `cons-${Date.now()}@example.com`;
    const caller = await createProfile({ email: callerEmail });
    ids.profiles.push(caller.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const mOwner = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(mOwner.id);
    const inv = await createInvite({
      household_id: h.id,
      invited_by_profile_id: owner.id,
      intended_role: "family_member",
      consumed_at: new Date(Date.now() - 60_000).toISOString(),
    });
    ids.invites.push(inv.id);
    await setInviteEmail(inv.id, callerEmail);

    mockClerk({ clerkUserId: caller.clerk_user_id, email: callerEmail });
    mockNextStubs();
    const { tryRedeemPendingEmailInvite } = await import(
      "@/lib/auth/redeem-email-invite"
    );

    const redeemed = await tryRedeemPendingEmailInvite(callerEmail);
    expect(redeemed).toBe(false);
  });

  it("returns false on empty profile email (short-circuits before any query)", async () => {
    // No setup needed — the helper bails on falsy input.
    const { tryRedeemPendingEmailInvite } = await import(
      "@/lib/auth/redeem-email-invite"
    );
    expect(await tryRedeemPendingEmailInvite("")).toBe(false);
  });

  it("multiple pending invites for the same email across DIFFERENT households: picks the most recent (order by created_at desc, limit 1)", async () => {
    // The unique index invites_active_email_per_household_idx prevents two
    // unconsumed invites for the same (household, email) pair, so we set up
    // two households each with one pending invite to the same email. The
    // helper's `order by created_at desc limit 1` should pick the newer.
    const ownerA = await createProfile();
    ids.profiles.push(ownerA.id);
    const ownerB = await createProfile();
    ids.profiles.push(ownerB.id);
    const callerEmail = `multi-${Date.now()}@example.com`;
    const caller = await createProfile({ email: callerEmail });
    ids.profiles.push(caller.id);
    const hA = await createHousehold({ created_by_profile_id: ownerA.id });
    ids.households.push(hA.id);
    const hB = await createHousehold({ created_by_profile_id: ownerB.id });
    ids.households.push(hB.id);
    const mA = await createMembership({
      household_id: hA.id,
      profile_id: ownerA.id,
      role: "owner",
    });
    ids.memberships.push(mA.id);
    const mB = await createMembership({
      household_id: hB.id,
      profile_id: ownerB.id,
      role: "owner",
    });
    ids.memberships.push(mB.id);

    // Older invite to household A.
    const invOld = await createInvite({
      household_id: hA.id,
      invited_by_profile_id: ownerA.id,
      intended_role: "family_member",
    });
    ids.invites.push(invOld.id);
    await setInviteEmail(invOld.id, callerEmail);
    // Force created_at into the past.
    await serviceClient()
      .from("invites")
      .update({ created_at: new Date(Date.now() - 60_000).toISOString() } as never)
      .eq("id", invOld.id);

    // Newer invite to household B.
    const invNew = await createInvite({
      household_id: hB.id,
      invited_by_profile_id: ownerB.id,
      intended_role: "family_member",
    });
    ids.invites.push(invNew.id);
    await setInviteEmail(invNew.id, callerEmail);

    mockClerk({ clerkUserId: caller.clerk_user_id, email: callerEmail });
    mockNextStubs();
    const { tryRedeemPendingEmailInvite } = await import(
      "@/lib/auth/redeem-email-invite"
    );

    const redeemed = await tryRedeemPendingEmailInvite(callerEmail);
    expect(redeemed).toBe(true);

    // The newer invite (household B) should be consumed; older invite (A) untouched.
    const { data: newer } = await serviceClient()
      .from("invites")
      .select("consumed_at")
      .eq("id", invNew.id)
      .single();
    expect(newer?.consumed_at).not.toBeNull();

    const { data: older } = await serviceClient()
      .from("invites")
      .select("consumed_at")
      .eq("id", invOld.id)
      .single();
    expect(older?.consumed_at).toBeNull();

    // Membership materialized in household B only.
    const { data: rows } = await serviceClient()
      .from("household_memberships")
      .select("id, household_id")
      .eq("profile_id", caller.id);
    expect(rows ?? []).toHaveLength(1);
    expect(rows![0].household_id).toBe(hB.id);
    ids.memberships.push(rows![0].id);
  });

  it("silent-failure: when redeem_invite RPC raises, the helper swallows the error and returns false (does NOT throw)", async () => {
    // Engineer a state where the matching invite exists but the RPC will
    // fail at the duplicate-membership pre-check (P0007): the caller is
    // already a member of the target household via some other path.
    // tryRedeemPendingEmailInvite MUST NOT propagate this — its caller
    // (getCurrentHousehold) would otherwise crash every page render.
    const owner = await createProfile();
    ids.profiles.push(owner.id);
    const callerEmail = `dup-${Date.now()}@example.com`;
    const caller = await createProfile({ email: callerEmail });
    ids.profiles.push(caller.id);
    const h = await createHousehold({ created_by_profile_id: owner.id });
    ids.households.push(h.id);
    const mOwner = await createMembership({
      household_id: h.id,
      profile_id: owner.id,
      role: "owner",
    });
    ids.memberships.push(mOwner.id);
    // Caller is already in the household — duplicate-membership pre-check
    // in redeem_invite will raise P0007.
    const mCaller = await createMembership({
      household_id: h.id,
      profile_id: caller.id,
      role: "family_member",
    });
    ids.memberships.push(mCaller.id);

    const inv = await createInvite({
      household_id: h.id,
      invited_by_profile_id: owner.id,
      intended_role: "family_member",
    });
    ids.invites.push(inv.id);
    await setInviteEmail(inv.id, callerEmail);

    mockClerk({ clerkUserId: caller.clerk_user_id, email: callerEmail });
    mockNextStubs();
    const { tryRedeemPendingEmailInvite } = await import(
      "@/lib/auth/redeem-email-invite"
    );

    // CRITICAL: must NOT throw. Must return false.
    let result: boolean | undefined;
    let threw = false;
    try {
      result = await tryRedeemPendingEmailInvite(callerEmail);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result).toBe(false);

    // Invite remains unconsumed (RPC rolled back).
    const { data: inviteAfter } = await serviceClient()
      .from("invites")
      .select("consumed_at")
      .eq("id", inv.id)
      .single();
    expect(inviteAfter?.consumed_at).toBeNull();
  });
});
