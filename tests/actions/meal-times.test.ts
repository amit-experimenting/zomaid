// Integration tests for the updateMealTime server action.
//
// Talks to a real local Supabase over HTTP — Clerk + Next stubs are mocked.
// Note: `household_meal_times` rows are seeded by an after-insert trigger on
// `households`, so each household starts with all four slots populated and
// the action behaves as an upsert.
//
// RLS gates: any active member of the household may write a meal time (per
// the hmt_insert / hmt_update policies). A caller who has no membership in
// the target household is silently blocked — PostgREST's response under a
// failing RLS check is "no rows mutated" with no error.

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
  // household_meal_times rows cascade-delete with the household.
  await cleanupRows("household_memberships", ids.memberships.splice(0));
  await cleanupRows("households", ids.households.splice(0));
  await cleanupRows("profiles", ids.profiles.splice(0));
}

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

describe("updateMealTime (action)", () => {
  const ids = freshIds();

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupAll(ids);
  });

  it("owner can update breakfast", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { updateMealTime } = await import(
      "@/app/household/meal-times/actions"
    );

    const res = await updateMealTime({ slot: "breakfast", meal_time: "07:15" });
    expect(res.ok).toBe(true);

    const { data: row } = await serviceClient()
      .from("household_meal_times")
      .select("meal_time")
      .eq("household_id", household.id)
      .eq("slot", "breakfast")
      .single();
    // Postgres `time` is rendered as HH:MM:SS by PostgREST.
    expect(row?.meal_time).toBe("07:15:00");
  });

  it("owner can update every slot independently (breakfast/lunch/snacks/dinner)", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { updateMealTime } = await import(
      "@/app/household/meal-times/actions"
    );

    const updates: Array<["breakfast" | "lunch" | "snacks" | "dinner", string]> = [
      ["breakfast", "06:45"],
      ["lunch", "12:30"],
      ["snacks", "16:15"],
      ["dinner", "19:45"],
    ];
    for (const [slot, time] of updates) {
      const res = await updateMealTime({ slot, meal_time: time });
      expect(res.ok).toBe(true);
    }

    const { data: rows } = await serviceClient()
      .from("household_meal_times")
      .select("slot, meal_time")
      .eq("household_id", household.id)
      .order("slot");
    const byslot = new Map(rows?.map((r) => [r.slot, r.meal_time]) ?? []);
    expect(byslot.get("breakfast")).toBe("06:45:00");
    expect(byslot.get("lunch")).toBe("12:30:00");
    expect(byslot.get("snacks")).toBe("16:15:00");
    expect(byslot.get("dinner")).toBe("19:45:00");
  });

  it("maid can update meal times", async () => {
    const { household } = await seedOwnerHousehold(ids);
    const maid = await createProfile();
    ids.profiles.push(maid.id);
    const mMaid = await createMembership({
      household_id: household.id,
      profile_id: maid.id,
      role: "maid",
    });
    ids.memberships.push(mMaid.id);

    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();
    const { updateMealTime } = await import(
      "@/app/household/meal-times/actions"
    );

    const res = await updateMealTime({ slot: "lunch", meal_time: "13:30" });
    expect(res.ok).toBe(true);

    const { data: row } = await serviceClient()
      .from("household_meal_times")
      .select("meal_time")
      .eq("household_id", household.id)
      .eq("slot", "lunch")
      .single();
    expect(row?.meal_time).toBe("13:30:00");
  });

  it("family_member can update meal times (per hmt_update policy: any active member)", async () => {
    // The DB policy is intentionally permissive (`has_active_membership`),
    // so a family_member is allowed. This documents the as-built behaviour
    // — if product later restricts to owner/maid, this test should flip.
    const { household } = await seedOwnerHousehold(ids);
    const fam = await createProfile();
    ids.profiles.push(fam.id);
    const mFam = await createMembership({
      household_id: household.id,
      profile_id: fam.id,
      role: "family_member",
    });
    ids.memberships.push(mFam.id);

    mockClerk({ clerkUserId: fam.clerk_user_id });
    mockNextStubs();
    const { updateMealTime } = await import(
      "@/app/household/meal-times/actions"
    );

    const res = await updateMealTime({ slot: "dinner", meal_time: "20:30" });
    expect(res.ok).toBe(true);

    const { data: row } = await serviceClient()
      .from("household_meal_times")
      .select("meal_time")
      .eq("household_id", household.id)
      .eq("slot", "dinner")
      .single();
    expect(row?.meal_time).toBe("20:30:00");
  });

  it("rejects invalid slot with MT_INVALID", async () => {
    const { owner } = await seedOwnerHousehold(ids);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { updateMealTime } = await import(
      "@/app/household/meal-times/actions"
    );

    const res = await updateMealTime({
      // @ts-expect-error — testing runtime Zod rejection
      slot: "brunch",
      meal_time: "11:00",
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected error");
    expect(res.error.code).toBe("MT_INVALID");
  });

  it("rejects invalid time format with MT_INVALID", async () => {
    const { owner } = await seedOwnerHousehold(ids);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { updateMealTime } = await import(
      "@/app/household/meal-times/actions"
    );

    const res = await updateMealTime({ slot: "breakfast", meal_time: "8am" });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected error");
    expect(res.error.code).toBe("MT_INVALID");
  });

  it("accepts HH:MM:SS format (regex allows the optional seconds group)", async () => {
    const { owner, household } = await seedOwnerHousehold(ids);

    mockClerk({ clerkUserId: owner.clerk_user_id });
    mockNextStubs();
    const { updateMealTime } = await import(
      "@/app/household/meal-times/actions"
    );

    const res = await updateMealTime({
      slot: "snacks",
      meal_time: "16:30:45",
    });
    expect(res.ok).toBe(true);

    const { data: row } = await serviceClient()
      .from("household_meal_times")
      .select("meal_time")
      .eq("household_id", household.id)
      .eq("slot", "snacks")
      .single();
    expect(row?.meal_time).toBe("16:30:45");
  });

  it("cross-household isolation: RLS silently blocks a caller not in the target household", async () => {
    // Household A — caller will be a member here.
    const { owner: ownerA } = await seedOwnerHousehold(ids);
    // Household B — completely separate, A's owner has no membership.
    const { household: hB } = await seedOwnerHousehold(ids);

    // Snapshot B's breakfast (seeded by trigger at '08:00').
    const { data: before } = await serviceClient()
      .from("household_meal_times")
      .select("meal_time")
      .eq("household_id", hB.id)
      .eq("slot", "breakfast")
      .single();
    expect(before?.meal_time).toBe("08:00:00");

    // Act as ownerA. requireHousehold() will resolve to A, so the action
    // will upsert against A's id, not B's — B remains untouched.
    mockClerk({ clerkUserId: ownerA.clerk_user_id });
    mockNextStubs();
    const { updateMealTime } = await import(
      "@/app/household/meal-times/actions"
    );

    const res = await updateMealTime({
      slot: "breakfast",
      meal_time: "05:00",
    });
    expect(res.ok).toBe(true);

    // B is unchanged.
    const { data: after } = await serviceClient()
      .from("household_meal_times")
      .select("meal_time")
      .eq("household_id", hB.id)
      .eq("slot", "breakfast")
      .single();
    expect(after?.meal_time).toBe("08:00:00");
  });

  it("caller with no membership is redirected to /onboarding by requireHousehold", async () => {
    const orphan = await createProfile();
    ids.profiles.push(orphan.id);

    mockClerk({ clerkUserId: orphan.clerk_user_id });
    mockNextStubs();
    const { updateMealTime } = await import(
      "@/app/household/meal-times/actions"
    );

    await expect(
      updateMealTime({ slot: "breakfast", meal_time: "07:00" }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });
});
