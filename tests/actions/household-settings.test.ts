// Integration tests for the household-settings server actions:
// removeMembership, updateMembershipDiet, updateMembershipPrivilege.
//
// These hit a real local Supabase over HTTP — we mock only Clerk and the
// Next.js cache/navigation stubs. Each test seeds with the service-role
// client and cleans up after itself in `afterEach`.

import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClerk } from "../helpers/clerk";
import { mockNextStubs } from "../helpers/next";
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
};

function freshIds(): Ids {
  return { profiles: [], households: [], memberships: [] };
}

async function cleanupAll(ids: Ids): Promise<void> {
  await cleanupRows("household_memberships", ids.memberships.splice(0));
  await cleanupRows("households", ids.households.splice(0));
  await cleanupRows("profiles", ids.profiles.splice(0));
}

/** Seed owner + household + active owner membership. */
async function seedOwnerHousehold(ids: Ids) {
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
  return { owner, household: h, membership: m };
}

/** Seed a family_member in an existing household. */
async function seedFamilyMember(ids: Ids, householdId: string) {
  const fam = await createProfile();
  ids.profiles.push(fam.id);
  const m = await createMembership({
    household_id: householdId,
    profile_id: fam.id,
    role: "family_member",
  });
  ids.memberships.push(m.id);
  return { profile: fam, membership: m };
}

/** Seed a maid in an existing household. */
async function seedMaid(ids: Ids, householdId: string) {
  const maid = await createProfile();
  ids.profiles.push(maid.id);
  const m = await createMembership({
    household_id: householdId,
    profile_id: maid.id,
    role: "maid",
  });
  ids.memberships.push(m.id);
  return { profile: maid, membership: m };
}

describe("removeMembership (action)", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("owner can remove a family_member from their household", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    const { membership: famMem } = await seedFamilyMember(ids, household.id);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { removeMembership } = await import(
      "@/app/household/settings/actions"
    );

    await removeMembership({ membershipId: famMem.id });

    const { data: row } = await serviceClient()
      .from("household_memberships")
      .select("status, removed_at")
      .eq("id", famMem.id)
      .single();
    expect(row?.status).toBe("removed");
    expect(row?.removed_at).not.toBeNull();
  });

  it("owner can remove the maid", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    const { membership: maidMem } = await seedMaid(ids, household.id);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { removeMembership } = await import(
      "@/app/household/settings/actions"
    );

    await removeMembership({ membershipId: maidMem.id });

    const { data: row } = await serviceClient()
      .from("household_memberships")
      .select("status, removed_at")
      .eq("id", maidMem.id)
      .single();
    expect(row?.status).toBe("removed");
    expect(row?.removed_at).not.toBeNull();
  });

  it("owner cannot self-leave (spec §5.6 — transfer ownership not in v1)", async () => {
    const { owner, membership } = await seedOwnerHousehold(ids);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { removeMembership } = await import(
      "@/app/household/settings/actions"
    );

    await expect(
      removeMembership({ membershipId: membership.id }),
    ).rejects.toThrow(/owner cannot self-leave/);

    const { data: row } = await serviceClient()
      .from("household_memberships")
      .select("status")
      .eq("id", membership.id)
      .single();
    expect(row?.status).toBe("active");
  });

  it("family_member can self-leave (remove their own membership)", async () => {
    const { household } = await seedOwnerHousehold(ids);
    const { profile: fam, membership: famMem } = await seedFamilyMember(
      ids,
      household.id,
    );

    mockClerk({ clerkUserId: fam.clerk_user_id });
    mockNextStubs();
    const { removeMembership } = await import(
      "@/app/household/settings/actions"
    );

    await removeMembership({ membershipId: famMem.id });

    const { data: row } = await serviceClient()
      .from("household_memberships")
      .select("status, removed_at")
      .eq("id", famMem.id)
      .single();
    expect(row?.status).toBe("removed");
    expect(row?.removed_at).not.toBeNull();
  });

  it("family_member cannot remove another member (only owner/self)", async () => {
    const { household } = await seedOwnerHousehold(ids);
    const { profile: famA } = await seedFamilyMember(ids, household.id);
    const { membership: famBmem } = await seedFamilyMember(ids, household.id);

    mockClerk({ clerkUserId: famA.clerk_user_id });
    mockNextStubs();
    const { removeMembership } = await import(
      "@/app/household/settings/actions"
    );

    await expect(
      removeMembership({ membershipId: famBmem.id }),
    ).rejects.toThrow(/forbidden/);

    const { data: row } = await serviceClient()
      .from("household_memberships")
      .select("status")
      .eq("id", famBmem.id)
      .single();
    expect(row?.status).toBe("active");
  });

  it("cross-household: owner of A cannot remove a member of B", async () => {
    const { owner: ownerA } = await seedOwnerHousehold(ids);
    const { household: hB } = await seedOwnerHousehold(ids);
    const { membership: famBmem } = await seedFamilyMember(ids, hB.id);

    mockClerk({ clerkUserId: ownerA.clerk_user_id });
    mockNextStubs();
    const { removeMembership } = await import(
      "@/app/household/settings/actions"
    );

    await expect(
      removeMembership({ membershipId: famBmem.id }),
    ).rejects.toThrow(/forbidden/);

    const { data: row } = await serviceClient()
      .from("household_memberships")
      .select("status")
      .eq("id", famBmem.id)
      .single();
    expect(row?.status).toBe("active");
  });
});

describe("updateMembershipDiet (action)", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("owner can update another member's diet", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    const { membership: famMem } = await seedFamilyMember(ids, household.id);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { updateMembershipDiet } = await import(
      "@/app/household/settings/actions"
    );

    await updateMembershipDiet({
      membershipId: famMem.id,
      diet: "vegetarian",
    });

    const { data: row } = await serviceClient()
      .from("household_memberships")
      .select("diet_preference")
      .eq("id", famMem.id)
      .single();
    expect(row?.diet_preference).toBe("vegetarian");
  });

  it("family_member can update their own diet", async () => {
    const { household } = await seedOwnerHousehold(ids);
    const { profile: fam, membership: famMem } = await seedFamilyMember(
      ids,
      household.id,
    );

    mockClerk({ clerkUserId: fam.clerk_user_id });
    mockNextStubs();
    const { updateMembershipDiet } = await import(
      "@/app/household/settings/actions"
    );

    await updateMembershipDiet({ membershipId: famMem.id, diet: "vegan" });

    const { data: row } = await serviceClient()
      .from("household_memberships")
      .select("diet_preference")
      .eq("id", famMem.id)
      .single();
    expect(row?.diet_preference).toBe("vegan");
  });

  it("family_member cannot update another member's diet", async () => {
    const { household } = await seedOwnerHousehold(ids);
    const { profile: famA } = await seedFamilyMember(ids, household.id);
    const { membership: famBmem } = await seedFamilyMember(ids, household.id);

    mockClerk({ clerkUserId: famA.clerk_user_id });
    mockNextStubs();
    const { updateMembershipDiet } = await import(
      "@/app/household/settings/actions"
    );

    await expect(
      updateMembershipDiet({
        membershipId: famBmem.id,
        diet: "non_vegetarian",
      }),
    ).rejects.toThrow(/forbidden/);

    const { data: row } = await serviceClient()
      .from("household_memberships")
      .select("diet_preference")
      .eq("id", famBmem.id)
      .single();
    expect(row?.diet_preference).toBeNull();
  });

  it("maid can update any member's diet", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    const { profile: maid } = await seedMaid(ids, household.id);
    const { membership: famMem } = await seedFamilyMember(ids, household.id);

    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();
    const { updateMembershipDiet } = await import(
      "@/app/household/settings/actions"
    );

    await updateMembershipDiet({
      membershipId: famMem.id,
      diet: "eggitarian",
    });

    const { data: row } = await serviceClient()
      .from("household_memberships")
      .select("diet_preference")
      .eq("id", famMem.id)
      .single();
    expect(row?.diet_preference).toBe("eggitarian");
    // owner reference used only to suppress unused warning if any
    expect(owner.id).toBeDefined();
  });

  it("setting diet to empty string clears the preference (null)", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    const { membership: famMem } = await seedFamilyMember(ids, household.id);

    // Pre-seed a value via service client so we can verify the clear.
    const upd = await serviceClient()
      .from("household_memberships")
      .update({ diet_preference: "vegetarian" })
      .eq("id", famMem.id);
    expect(upd.error).toBeNull();

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { updateMembershipDiet } = await import(
      "@/app/household/settings/actions"
    );

    await updateMembershipDiet({ membershipId: famMem.id, diet: "" });

    const { data: row } = await serviceClient()
      .from("household_memberships")
      .select("diet_preference")
      .eq("id", famMem.id)
      .single();
    expect(row?.diet_preference).toBeNull();
  });

  it("setting diet to 'none' clears the preference (null)", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    const { membership: famMem } = await seedFamilyMember(ids, household.id);
    const upd = await serviceClient()
      .from("household_memberships")
      .update({ diet_preference: "vegan" })
      .eq("id", famMem.id);
    expect(upd.error).toBeNull();

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { updateMembershipDiet } = await import(
      "@/app/household/settings/actions"
    );

    await updateMembershipDiet({ membershipId: famMem.id, diet: "none" });

    const { data: row } = await serviceClient()
      .from("household_memberships")
      .select("diet_preference")
      .eq("id", famMem.id)
      .single();
    expect(row?.diet_preference).toBeNull();
  });

  it("rejects an invalid diet enum value via Zod", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    const { membership: famMem } = await seedFamilyMember(ids, household.id);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { updateMembershipDiet } = await import(
      "@/app/household/settings/actions"
    );

    await expect(
      updateMembershipDiet({
        membershipId: famMem.id,
        diet: "carnivore",
      }),
    ).rejects.toThrow(/invalid|enum/i);
  });

  it("cross-household: owner of A cannot update diet for a member of B", async () => {
    const { owner: ownerA } = await seedOwnerHousehold(ids);
    const { household: hB } = await seedOwnerHousehold(ids);
    const { membership: famBmem } = await seedFamilyMember(ids, hB.id);

    mockClerk({ clerkUserId: ownerA.clerk_user_id });
    mockNextStubs();
    const { updateMembershipDiet } = await import(
      "@/app/household/settings/actions"
    );

    await expect(
      updateMembershipDiet({
        membershipId: famBmem.id,
        diet: "vegan",
      }),
    ).rejects.toThrow(/forbidden/);

    const { data: row } = await serviceClient()
      .from("household_memberships")
      .select("diet_preference")
      .eq("id", famBmem.id)
      .single();
    expect(row?.diet_preference).toBeNull();
  });
});

describe("updateMembershipPrivilege (action)", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("owner can change a family_member's privilege", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    const { membership: famMem } = await seedFamilyMember(ids, household.id);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { updateMembershipPrivilege } = await import(
      "@/app/household/settings/actions"
    );

    await updateMembershipPrivilege({
      membershipId: famMem.id,
      privilege: "meal_modify",
    });

    const { data: row } = await serviceClient()
      .from("household_memberships")
      .select("privilege")
      .eq("id", famMem.id)
      .single();
    expect(row?.privilege).toBe("meal_modify");
  });

  it("owner can downgrade a family_member's privilege to view_only", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    const { membership: famMem } = await seedFamilyMember(ids, household.id);

    // Start from a non-default value.
    const upd = await serviceClient()
      .from("household_memberships")
      .update({ privilege: "full" })
      .eq("id", famMem.id);
    expect(upd.error).toBeNull();

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { updateMembershipPrivilege } = await import(
      "@/app/household/settings/actions"
    );

    await updateMembershipPrivilege({
      membershipId: famMem.id,
      privilege: "view_only",
    });

    const { data: row } = await serviceClient()
      .from("household_memberships")
      .select("privilege")
      .eq("id", famMem.id)
      .single();
    expect(row?.privilege).toBe("view_only");
  });

  it("maid cannot change privileges (owner-only)", async () => {
    const { household } = await seedOwnerHousehold(ids);
    const { profile: maid } = await seedMaid(ids, household.id);
    const { membership: famMem } = await seedFamilyMember(ids, household.id);

    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();
    const { updateMembershipPrivilege } = await import(
      "@/app/household/settings/actions"
    );

    await expect(
      updateMembershipPrivilege({
        membershipId: famMem.id,
        privilege: "meal_modify",
      }),
    ).rejects.toThrow(/only the owner can change privileges/);
  });

  it("family_member cannot change privileges (owner-only)", async () => {
    const { household } = await seedOwnerHousehold(ids);
    const { profile: famA } = await seedFamilyMember(ids, household.id);
    const { membership: famBmem } = await seedFamilyMember(ids, household.id);

    mockClerk({ clerkUserId: famA.clerk_user_id });
    mockNextStubs();
    const { updateMembershipPrivilege } = await import(
      "@/app/household/settings/actions"
    );

    await expect(
      updateMembershipPrivilege({
        membershipId: famBmem.id,
        privilege: "view_only",
      }),
    ).rejects.toThrow(/only the owner can change privileges/);
  });

  it("rejects setting privilege on a non-family_member (owner/maid target)", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    const { membership: maidMem } = await seedMaid(ids, household.id);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { updateMembershipPrivilege } = await import(
      "@/app/household/settings/actions"
    );

    await expect(
      updateMembershipPrivilege({
        membershipId: maidMem.id,
        privilege: "meal_modify",
      }),
    ).rejects.toThrow(/privilege only applies to family members/);
  });

  it("Zod rejects an invalid privilege value (no 'none' sentinel)", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);
    const { membership: famMem } = await seedFamilyMember(ids, household.id);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { updateMembershipPrivilege } = await import(
      "@/app/household/settings/actions"
    );

    await expect(
      updateMembershipPrivilege({
        membershipId: famMem.id,
        privilege: "none",
      }),
    ).rejects.toThrow(/invalid|enum/i);
  });

  it("cross-household: owner of A cannot change privilege for a member of B", async () => {
    const { owner: ownerA } = await seedOwnerHousehold(ids);
    const { household: hB } = await seedOwnerHousehold(ids);
    const { membership: famBmem } = await seedFamilyMember(ids, hB.id);

    mockClerk({ clerkUserId: ownerA.clerk_user_id });
    mockNextStubs();
    const { updateMembershipPrivilege } = await import(
      "@/app/household/settings/actions"
    );

    await expect(
      updateMembershipPrivilege({
        membershipId: famBmem.id,
        privilege: "meal_modify",
      }),
    ).rejects.toThrow(/forbidden/);

    const { data: row } = await serviceClient()
      .from("household_memberships")
      .select("privilege")
      .eq("id", famBmem.id)
      .single();
    // Unchanged from default ('full').
    expect(row?.privilege).toBe("full");
  });

  it("rejects nonexistent membershipId", async () => {
    const { owner } = await seedOwnerHousehold(ids);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { updateMembershipPrivilege } = await import(
      "@/app/household/settings/actions"
    );

    // .single() on no rows yields a PostgREST error which the action rethrows.
    await expect(
      updateMembershipPrivilege({
        membershipId: randomUUID(),
        privilege: "meal_modify",
      }),
    ).rejects.toThrow();
  });
});
