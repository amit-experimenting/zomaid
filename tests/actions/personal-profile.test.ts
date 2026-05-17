import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
};
function freshIds(): Ids {
  return { profiles: [], households: [], memberships: [] };
}
async function cleanupAll(ids: Ids): Promise<void> {
  await cleanupRows("household_memberships", ids.memberships.splice(0));
  await cleanupRows("households", ids.households.splice(0));
  await cleanupRows("profiles", ids.profiles.splice(0));
}

async function setupMaidInHousehold(ids: Ids) {
  const owner = await createProfile();
  ids.profiles.push(owner.id);
  const h = await createHousehold({ created_by_profile_id: owner.id });
  ids.households.push(h.id);
  const ownerM = await createMembership({
    household_id: h.id,
    profile_id: owner.id,
    role: "owner",
  });
  ids.memberships.push(ownerM.id);

  const maid = await createProfile();
  ids.profiles.push(maid.id);
  const maidM = await createMembership({
    household_id: h.id,
    profile_id: maid.id,
    role: "maid",
  });
  ids.memberships.push(maidM.id);
  return { maid, household: h };
}

function formDataFrom(obj: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(obj)) fd.set(k, v);
  return fd;
}

describe("savePersonalProfile (action)", () => {
  const ids = freshIds();
  beforeEach(() => { vi.resetModules(); });
  afterEach(async () => { await cleanupAll(ids); });

  it("writes the row, stamps onboarding_completed_at, redirects to /dashboard", async () => {
    const { maid } = await setupMaidInHousehold(ids);
    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();

    const { savePersonalProfile } = await import(
      "@/app/onboarding/personal/actions"
    );

    const fd = formDataFrom({
      display_name: "Asha",
      passport_number: "P1234567",
      passport_expiry: "2030-01-15",
      preferred_language: "ta",
      redirect_to: "/dashboard",
    });

    await expectRedirect(savePersonalProfile(fd), "/dashboard");

    const { data: row } = await serviceClient()
      .from("profiles")
      .select("display_name, passport_number, passport_expiry, preferred_language, onboarding_completed_at")
      .eq("id", maid.id)
      .single();
    expect(row?.display_name).toBe("Asha");
    expect(row?.passport_number).toBe("P1234567");
    expect(row?.passport_expiry).toBe("2030-01-15");
    expect(row?.preferred_language).toBe("ta");
    expect(row?.onboarding_completed_at).not.toBeNull();
  });

  it("accepts minimal payload (name only), normalizes empty fields to null", async () => {
    const { maid } = await setupMaidInHousehold(ids);
    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();

    const { savePersonalProfile } = await import(
      "@/app/onboarding/personal/actions"
    );

    const fd = formDataFrom({
      display_name: "Asha",
      passport_number: "",
      passport_expiry: "",
      preferred_language: "",
      redirect_to: "/dashboard",
    });

    await expectRedirect(savePersonalProfile(fd), "/dashboard");

    const { data: row } = await serviceClient()
      .from("profiles")
      .select("passport_number, passport_expiry, preferred_language, onboarding_completed_at")
      .eq("id", maid.id)
      .single();
    expect(row?.passport_number).toBeNull();
    expect(row?.passport_expiry).toBeNull();
    expect(row?.preferred_language).toBeNull();
    expect(row?.onboarding_completed_at).not.toBeNull();
  });

  it("does NOT re-stamp onboarding_completed_at on a second save", async () => {
    const { maid } = await setupMaidInHousehold(ids);
    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();

    const { savePersonalProfile } = await import(
      "@/app/onboarding/personal/actions"
    );

    await expectRedirect(
      savePersonalProfile(formDataFrom({
        display_name: "Asha",
        passport_number: "", passport_expiry: "", preferred_language: "",
        redirect_to: "/dashboard",
      })),
      "/dashboard",
    );
    const first = await serviceClient()
      .from("profiles")
      .select("onboarding_completed_at")
      .eq("id", maid.id)
      .single();
    const firstStamp = first.data?.onboarding_completed_at;
    expect(firstStamp).not.toBeNull();

    // Second save (later edit from settings).
    await new Promise((r) => setTimeout(r, 10));
    await expectRedirect(
      savePersonalProfile(formDataFrom({
        display_name: "Asha Devi",
        passport_number: "P999", passport_expiry: "", preferred_language: "",
        redirect_to: "/household/settings",
      })),
      "/household/settings",
    );
    const second = await serviceClient()
      .from("profiles")
      .select("display_name, passport_number, onboarding_completed_at")
      .eq("id", maid.id)
      .single();
    expect(second.data?.display_name).toBe("Asha Devi");
    expect(second.data?.passport_number).toBe("P999");
    expect(second.data?.onboarding_completed_at).toBe(firstStamp);
  });

  it("redirects to the redirect_to target from the form", async () => {
    const { maid } = await setupMaidInHousehold(ids);
    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();

    const { savePersonalProfile } = await import(
      "@/app/onboarding/personal/actions"
    );

    await expectRedirect(
      savePersonalProfile(formDataFrom({
        display_name: "Asha",
        passport_number: "", passport_expiry: "", preferred_language: "",
        redirect_to: "/household/settings",
      })),
      "/household/settings",
    );
  });

  it("throws when display_name is empty", async () => {
    const { maid } = await setupMaidInHousehold(ids);
    mockClerk({ clerkUserId: maid.clerk_user_id });
    mockNextStubs();

    const { savePersonalProfile } = await import(
      "@/app/onboarding/personal/actions"
    );

    await expect(
      savePersonalProfile(formDataFrom({
        display_name: "",
        passport_number: "", passport_expiry: "", preferred_language: "",
        redirect_to: "/dashboard",
      })),
    ).rejects.toThrow();
  });
});
