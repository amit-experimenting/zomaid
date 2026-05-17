import type { HouseholdProfile } from "./types";

export function deriveMatchingTags(profile: HouseholdProfile): string[] {
  const tags = new Set<string>();

  for (const age of profile.age_groups) tags.add(`age:${age}`);

  tags.add(`pets:${profile.pets}`);
  if (profile.pets === "multiple") {
    tags.add("pets:dog");
    tags.add("pets:cat");
    tags.add("pets:other");
  }

  tags.add(`work:${profile.work_hours}`);
  tags.add(`school:${profile.school_children}`);

  if (profile.has_indoor_plants) tags.add("feature:plants");
  if (profile.has_balcony) tags.add("feature:balcony");
  if (profile.has_ac) tags.add("feature:ac");
  if (profile.has_polishables) tags.add("feature:polishables");

  return Array.from(tags);
}
