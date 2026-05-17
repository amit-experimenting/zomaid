export type AgeGroup = "infants" | "school_age" | "teens" | "adults" | "seniors";
export type Pets = "none" | "dog" | "cat" | "other" | "multiple";
export type WorkHours = "wfh" | "office" | "mixed" | "retired";
export type SchoolChildren = "all" | "some" | "homeschool" | "none_school_age";

export type HouseholdProfile = {
  age_groups: AgeGroup[];
  pets: Pets;
  work_hours: WorkHours;
  school_children: SchoolChildren;
  has_indoor_plants: boolean;
  has_balcony: boolean;
  has_ac: boolean;
  has_polishables: boolean;
};
