import { describe, expect, it, vi, beforeEach } from "vitest";

const getCurrentHouseholdMock = vi.fn();
const createServiceClientMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/auth/current-household", () => ({
  getCurrentHousehold: (...a: unknown[]) => getCurrentHouseholdMock(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: (...a: unknown[]) => createServiceClientMock(...a),
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePathMock(...a),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { updateHouseholdDiet } from "@/app/household/settings/actions";

const householdId = "00000000-0000-0000-0000-000000000001";

function makeCtx(role: "owner" | "maid" | "family_member") {
  return {
    profile: { id: "p1" },
    household: { id: householdId },
    membership: { role },
  };
}

function makeSvc(updateImpl: (table: string) => unknown) {
  return { from: (table: string) => updateImpl(table) };
}

beforeEach(() => {
  getCurrentHouseholdMock.mockReset();
  createServiceClientMock.mockReset();
  revalidatePathMock.mockReset();
});

describe("updateHouseholdDiet", () => {
  it("rejects family_member callers", async () => {
    getCurrentHouseholdMock.mockResolvedValue(makeCtx("family_member"));
    await expect(updateHouseholdDiet({ diet: "vegan" }))
      .rejects.toThrow("forbidden");
  });

  it("allows owner to set a diet", async () => {
    let captured: { table: string; patch: unknown; id: string } | null = null;
    getCurrentHouseholdMock.mockResolvedValue(makeCtx("owner"));
    createServiceClientMock.mockReturnValue(makeSvc((table) => ({
      update: (patch: unknown) => ({
        eq: (_col: string, id: string) => {
          captured = { table, patch, id };
          return Promise.resolve({ error: null });
        },
      }),
    })));
    await updateHouseholdDiet({ diet: "vegetarian" });
    expect(captured).toEqual({
      table: "households",
      patch: { diet_preference: "vegetarian" },
      id: householdId,
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/household/settings");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePathMock).toHaveBeenCalledWith("/plan");
    expect(revalidatePathMock).toHaveBeenCalledWith("/recipes");
  });

  it("allows maid to set a diet", async () => {
    let called = false;
    getCurrentHouseholdMock.mockResolvedValue(makeCtx("maid"));
    createServiceClientMock.mockReturnValue(makeSvc(() => ({
      update: () => ({
        eq: () => { called = true; return Promise.resolve({ error: null }); },
      }),
    })));
    await updateHouseholdDiet({ diet: "eggitarian" });
    expect(called).toBe(true);
    expect(revalidatePathMock).toHaveBeenCalledWith("/household/settings");
  });

  it("empty string clears the override to null", async () => {
    let patch: unknown = null;
    getCurrentHouseholdMock.mockResolvedValue(makeCtx("owner"));
    createServiceClientMock.mockReturnValue(makeSvc(() => ({
      update: (p: unknown) => ({
        eq: () => { patch = p; return Promise.resolve({ error: null }); },
      }),
    })));
    await updateHouseholdDiet({ diet: "" });
    expect(patch).toEqual({ diet_preference: null });
    expect(revalidatePathMock).toHaveBeenCalledWith("/household/settings");
  });

  it("omitted diet clears the override to null", async () => {
    let patch: unknown = null;
    getCurrentHouseholdMock.mockResolvedValue(makeCtx("owner"));
    createServiceClientMock.mockReturnValue(makeSvc(() => ({
      update: (p: unknown) => ({
        eq: () => { patch = p; return Promise.resolve({ error: null }); },
      }),
    })));
    await updateHouseholdDiet({});
    expect(patch).toEqual({ diet_preference: null });
    expect(revalidatePathMock).toHaveBeenCalledWith("/household/settings");
  });

  it("rejects unknown diet values", async () => {
    getCurrentHouseholdMock.mockResolvedValue(makeCtx("owner"));
    await expect(updateHouseholdDiet({ diet: "carnivore" }))
      .rejects.toThrow(/invalid|enum/i); // zod parse error
  });
});
