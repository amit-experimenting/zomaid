import { describe, it, expect } from "vitest";
import { deriveMatchingTags } from "@/lib/profile/matching-tags";
import type { HouseholdProfile } from "@/lib/profile/types";

function profile(overrides: Partial<HouseholdProfile> = {}): HouseholdProfile {
  return {
    age_groups: ["adults"],
    pets: "none",
    work_hours: "mixed",
    school_children: "none_school_age",
    has_indoor_plants: false,
    has_balcony: false,
    has_ac: false,
    has_polishables: false,
    ...overrides,
  };
}

describe("deriveMatchingTags", () => {
  it("emits one tag per scalar answer and one per age group", () => {
    const tags = deriveMatchingTags(profile({ age_groups: ["adults", "school_age"] }));
    expect(tags).toEqual(expect.arrayContaining([
      "age:adults", "age:school_age",
      "pets:none",
      "work:mixed",
      "school:none_school_age",
    ]));
  });

  it("emits feature:* only for true booleans", () => {
    const tags = deriveMatchingTags(profile({
      has_indoor_plants: true,
      has_balcony: false,
      has_ac: true,
      has_polishables: false,
    }));
    expect(tags).toContain("feature:plants");
    expect(tags).not.toContain("feature:balcony");
    expect(tags).toContain("feature:ac");
    expect(tags).not.toContain("feature:polishables");
  });

  it("expands pets:multiple to imply pets:dog, pets:cat, pets:other", () => {
    const tags = deriveMatchingTags(profile({ pets: "multiple" }));
    expect(tags).toContain("pets:multiple");
    expect(tags).toContain("pets:dog");
    expect(tags).toContain("pets:cat");
    expect(tags).toContain("pets:other");
  });

  it("does NOT expand pets:dog to imply other pets", () => {
    const tags = deriveMatchingTags(profile({ pets: "dog" }));
    expect(tags).toContain("pets:dog");
    expect(tags).not.toContain("pets:cat");
    expect(tags).not.toContain("pets:other");
  });

  it("never returns duplicates", () => {
    const tags = deriveMatchingTags(profile({
      age_groups: ["adults", "adults", "seniors"],
      pets: "multiple",
    }));
    const set = new Set(tags);
    expect(tags.length).toBe(set.size);
  });
});
