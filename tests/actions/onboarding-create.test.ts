// Integration tests for the onboarding entry-point server actions
// createHouseholdAsOwner and createHouseholdAsMaid. Talks to a real local
// Supabase over HTTP; only Clerk and Next.js stubs are mocked. The maid case
// additionally exercises the pending-owner-invite mint and the
// household_memberships -> households maid_mode='invited' sync trigger
// (migration 20260705_001_household_setup_gates.sql).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mockClerk } from "../helpers/clerk";
import { expectRedirect, mockNextStubs } from "../helpers/next";
import {
  cleanupRows,
  createHousehold,
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
  // Children → parents. invites and memberships both reference households;
  // households references profiles. Clear in dependency order.
  await cleanupRows("invites", ids.invites.splice(0));
  await cleanupRows("household_memberships", ids.memberships.splice(0));
  await cleanupRows("households", ids.households.splice(0));
  await cleanupRows("profiles", ids.profiles.splice(0));
}

/**
 * Collect cleanup ids for every household + membership + invite tied to a
 * given profile_id. Used in tests where the action itself creates these rows
 * (so the test never holds the ids directly).
 */
async function collectIdsForProfile(
  profileId: string,
  ids: Ids,
): Promise<void> {
  const svc = serviceClient();
  const { data: ms } = await svc
    .from("household_memberships")
    .select("id, household_id")
    .eq("profile_id", profileId);
  for (const m of ms ?? []) {
    ids.memberships.push(m.id);
    if (!ids.households.includes(m.household_id)) {
      ids.households.push(m.household_id);
    }
  }
  if (ms && ms.length > 0) {
    const householdIds = ms.map((m) => m.household_id);
    const { data: invs } = await svc
      .from("invites")
      .select("id")
      .in("household_id", householdIds);
    for (const inv of invs ?? []) ids.invites.push(inv.id);
  }
}

describe("createHouseholdAsOwner (action)", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("happy path: lazy-creates profile, household, owner membership; maid_mode defaults to 'unset'; redirects to /dashboard", async () => {
    const clerkUserId = `user_${randomUUID()}`;

    mockClerk({
      clerkUserId,
      email: `${clerkUserId}@example.test`,
      firstName: "Olive",
      lastName: "Owner",
    });
    mockNextStubs();
    const { createHouseholdAsOwner } = await import(
      "@/app/onboarding/actions"
    );

    await expectRedirect(
      createHouseholdAsOwner({ name: "Owners Place" }),
      "/dashboard",
    );

    // Profile was lazy-upserted by getCurrentProfile().
    const { data: profile } = await serviceClient()
      .from("profiles")
      .select("id, clerk_user_id, email, display_name")
      .eq("clerk_user_id", clerkUserId)
      .single();
    expect(profile?.clerk_user_id).toBe(clerkUserId);
    expect(profile?.email).toBe(`${clerkUserId}@example.test`);
    expect(profile?.display_name).toBe("Olive Owner");
    if (profile?.id) ids.profiles.push(profile.id);

    // Single owner membership with default privilege='full' and status='active'.
    const { data: memberships } = await serviceClient()
      .from("household_memberships")
      .select("id, household_id, role, privilege, status")
      .eq("profile_id", profile!.id);
    expect(memberships).toHaveLength(1);
    const m = memberships![0];
    expect(m.role).toBe("owner");
    expect(m.privilege).toBe("full");
    expect(m.status).toBe("active");
    ids.memberships.push(m.id);
    ids.households.push(m.household_id);

    // Household matches what was passed in. maid_mode defaults to 'unset' for
    // an owner-created household (no maid membership yet, so the
    // households_sync_maid_mode_on_join trigger leaves it alone).
    const { data: household } = await serviceClient()
      .from("households")
      .select("id, name, address_line, postal_code, maid_mode, created_by_profile_id")
      .eq("id", m.household_id)
      .single();
    expect(household?.name).toBe("Owners Place");
    expect(household?.address_line).toBeNull();
    expect(household?.postal_code).toBeNull();
    expect(household?.maid_mode).toBe("unset");
    expect(household?.created_by_profile_id).toBe(profile!.id);
  });

  it("happy path with optional address fields persists them on the household", async () => {
    const clerkUserId = `user_${randomUUID()}`;

    mockClerk({ clerkUserId });
    mockNextStubs();
    const { createHouseholdAsOwner } = await import(
      "@/app/onboarding/actions"
    );

    await expectRedirect(
      createHouseholdAsOwner({
        name: "Address-bearing Home",
        addressLine: "12 Test Lane",
        postalCode: "123456",
      }),
      "/dashboard",
    );

    const { data: profile } = await serviceClient()
      .from("profiles")
      .select("id")
      .eq("clerk_user_id", clerkUserId)
      .single();
    if (profile?.id) ids.profiles.push(profile.id);

    const { data: memberships } = await serviceClient()
      .from("household_memberships")
      .select("id, household_id")
      .eq("profile_id", profile!.id);
    expect(memberships).toHaveLength(1);
    ids.memberships.push(memberships![0].id);
    ids.households.push(memberships![0].household_id);

    const { data: household } = await serviceClient()
      .from("households")
      .select("name, address_line, postal_code")
      .eq("id", memberships![0].household_id)
      .single();
    expect(household?.name).toBe("Address-bearing Home");
    expect(household?.address_line).toBe("12 Test Lane");
    expect(household?.postal_code).toBe("123456");
  });

  it("second-household guard: caller with an existing active membership short-circuits to /dashboard without creating a new household", async () => {
    // Seed an owner who already has a household.
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
    const { createHouseholdAsOwner } = await import(
      "@/app/onboarding/actions"
    );

    const householdsBefore = await serviceClient()
      .from("households")
      .select("id", { count: "exact", head: true });
    const beforeCount = householdsBefore.count ?? 0;

    await expectRedirect(
      createHouseholdAsOwner({ name: "Should Not Be Created" }),
      "/dashboard",
    );

    // No new household for this profile.
    const { data: memberships } = await serviceClient()
      .from("household_memberships")
      .select("id, household_id")
      .eq("profile_id", owner.id);
    expect(memberships).toHaveLength(1);
    expect(memberships![0].id).toBe(m.id);

    // And no orphan household row was created either.
    const householdsAfter = await serviceClient()
      .from("households")
      .select("id", { count: "exact", head: true });
    expect(householdsAfter.count).toBe(beforeCount);
  });

  it("validates input: rejects empty name", async () => {
    const clerkUserId = `user_${randomUUID()}`;
    mockClerk({ clerkUserId });
    mockNextStubs();
    const { createHouseholdAsOwner } = await import(
      "@/app/onboarding/actions"
    );

    await expect(createHouseholdAsOwner({ name: "" })).rejects.toThrow();

    // Cleanup any lazy-upserted profile.
    const { data: profile } = await serviceClient()
      .from("profiles")
      .select("id")
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();
    if (profile?.id) ids.profiles.push(profile.id);
  });
});

describe("createHouseholdAsMaid (action)", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("happy path: lazy-creates profile + household + maid membership; trigger sets maid_mode='invited'; mints a pending owner invite; redirects to /dashboard", async () => {
    const clerkUserId = `user_${randomUUID()}`;

    mockClerk({
      clerkUserId,
      firstName: "Mia",
      lastName: "Maid",
    });
    mockNextStubs();
    const { createHouseholdAsMaid } = await import(
      "@/app/onboarding/actions"
    );

    await expectRedirect(
      createHouseholdAsMaid({ ownerName: "  Olivia  " }),
      "/dashboard",
    );

    const { data: profile } = await serviceClient()
      .from("profiles")
      .select("id, clerk_user_id")
      .eq("clerk_user_id", clerkUserId)
      .single();
    expect(profile?.clerk_user_id).toBe(clerkUserId);
    if (profile?.id) ids.profiles.push(profile.id);

    // Membership: role='maid', privilege defaults to 'full', status='active'.
    const { data: memberships } = await serviceClient()
      .from("household_memberships")
      .select("id, household_id, role, privilege, status")
      .eq("profile_id", profile!.id);
    expect(memberships).toHaveLength(1);
    const m = memberships![0];
    expect(m.role).toBe("maid");
    expect(m.privilege).toBe("full");
    expect(m.status).toBe("active");
    ids.memberships.push(m.id);
    ids.households.push(m.household_id);

    // Household: name derived from ownerName (trimmed), and the maid-join
    // trigger flipped maid_mode to 'invited'.
    const { data: household } = await serviceClient()
      .from("households")
      .select("name, maid_mode, created_by_profile_id")
      .eq("id", m.household_id)
      .single();
    expect(household?.name).toBe("Olivia's household");
    expect(household?.maid_mode).toBe("invited");
    expect(household?.created_by_profile_id).toBe(profile!.id);

    // Pending owner-invite was minted.
    const { data: invites } = await serviceClient()
      .from("invites")
      .select(
        "id, intended_role, intended_privilege, code, token, invited_by_profile_id, consumed_at, expires_at",
      )
      .eq("household_id", m.household_id);
    expect(invites).toHaveLength(1);
    const inv = invites![0];
    expect(inv.intended_role).toBe("owner");
    expect(inv.intended_privilege).toBe("full");
    expect(inv.invited_by_profile_id).toBe(profile!.id);
    expect(inv.consumed_at).toBeNull();
    // 6-digit numeric code.
    expect(inv.code).toMatch(/^\d{6}$/);
    // Token is a non-trivial base64url string.
    expect(typeof inv.token).toBe("string");
    expect(inv.token.length).toBeGreaterThan(20);
    // Expiry in the future (default 7d).
    expect(new Date(inv.expires_at).getTime()).toBeGreaterThan(Date.now());
    ids.invites.push(inv.id);
  });

  it("second-household guard: maid caller with existing active membership short-circuits to /dashboard without creating a new household or invite", async () => {
    // Seed: maid is already a member of some household.
    const stubOwner = await createProfile();
    ids.profiles.push(stubOwner.id);
    const maid = await createProfile();
    ids.profiles.push(maid.id);
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
    const { createHouseholdAsMaid } = await import(
      "@/app/onboarding/actions"
    );

    await expectRedirect(
      createHouseholdAsMaid({ ownerName: "Should Not Be Used" }),
      "/dashboard",
    );

    // No new membership for this maid.
    const { data: memberships } = await serviceClient()
      .from("household_memberships")
      .select("id")
      .eq("profile_id", maid.id);
    expect(memberships).toHaveLength(1);
    expect(memberships![0].id).toBe(m.id);

    // No invite created on the seeded household by the maid this run.
    const { data: invites } = await serviceClient()
      .from("invites")
      .select("id")
      .eq("invited_by_profile_id", maid.id);
    expect(invites ?? []).toHaveLength(0);
  });

  it("validates input: rejects empty ownerName", async () => {
    const clerkUserId = `user_${randomUUID()}`;
    mockClerk({ clerkUserId });
    mockNextStubs();
    const { createHouseholdAsMaid } = await import(
      "@/app/onboarding/actions"
    );

    await expect(
      createHouseholdAsMaid({ ownerName: "" }),
    ).rejects.toThrow();

    // Cleanup any lazy-upserted profile + any rows accidentally written
    // before the validation/throw site (defensive — none expected).
    const { data: profile } = await serviceClient()
      .from("profiles")
      .select("id")
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle();
    if (profile?.id) {
      await collectIdsForProfile(profile.id, ids);
      ids.profiles.push(profile.id);
    }
  });
});
