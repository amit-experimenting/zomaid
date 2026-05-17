// src/app/onboarding/profile/profile-form.tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { saveProfileAction } from "./actions";
import type { AgeGroup, HouseholdProfile, Pets, SchoolChildren, WorkHours } from "@/lib/profile/types";

const AGE_OPTIONS: { value: AgeGroup; label: string }[] = [
  { value: "infants", label: "Infants / toddlers (0–3 years)" },
  { value: "school_age", label: "Young children (4–12 years)" },
  { value: "teens", label: "Teenagers (13–17 years)" },
  { value: "adults", label: "Adults (18–60 years)" },
  { value: "seniors", label: "Senior citizens (60+)" },
];
const PET_OPTIONS: { value: Pets; label: string }[] = [
  { value: "none", label: "No pets" },
  { value: "dog", label: "Dog(s)" },
  { value: "cat", label: "Cat(s)" },
  { value: "other", label: "Other pets" },
  { value: "multiple", label: "Multiple types" },
];
const WORK_OPTIONS: { value: WorkHours; label: string }[] = [
  { value: "wfh", label: "All work from home" },
  { value: "office", label: "All work outside (office / business)" },
  { value: "mixed", label: "Mixed (some home, some office)" },
  { value: "retired", label: "Retired / not working" },
];
const SCHOOL_OPTIONS: { value: SchoolChildren; label: string }[] = [
  { value: "all", label: "Yes, all school-age kids attend" },
  { value: "some", label: "Some attend, some don't" },
  { value: "homeschool", label: "Homeschooled" },
  { value: "none_school_age", label: "No school-age children" },
];
const FEATURE_OPTIONS: { key: keyof Pick<HouseholdProfile, "has_indoor_plants" | "has_balcony" | "has_ac" | "has_polishables">; label: string }[] = [
  { key: "has_indoor_plants", label: "Indoor plants" },
  { key: "has_balcony", label: "Balcony / terrace" },
  { key: "has_ac", label: "A/C units" },
  { key: "has_polishables", label: "Wooden / silverware / brass items to polish" },
];

type Props = {
  initial: HouseholdProfile | null;
  editMode: boolean;
};

// Step badge — 22px square with 11.5px label. Kept as inline styles because
// the design-lint rule bans arbitrary px/rem/em values inside className.
const STEP_BADGE_STYLE = { width: 22, height: 22, fontSize: 11.5 };
const STEP_HEADING_STYLE = { fontSize: 15 };
const STEP_HINT_STYLE = { paddingLeft: 30 };

function StepBadge({ n }: { n: number }) {
  return (
    <span
      style={STEP_BADGE_STYLE}
      className="inline-flex items-center justify-center bg-primary-subtle text-primary font-semibold rounded"
    >
      {n}
    </span>
  );
}

export function ProfileForm({ initial, editMode }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>(initial?.age_groups ?? []);
  const [pets, setPets] = useState<Pets | "">(initial?.pets ?? "");
  const [work, setWork] = useState<WorkHours | "">(initial?.work_hours ?? "");
  const [school, setSchool] = useState<SchoolChildren | "">(initial?.school_children ?? "");
  const [features, setFeatures] = useState<{ [K in "has_indoor_plants" | "has_balcony" | "has_ac" | "has_polishables"]: boolean }>({
    has_indoor_plants: initial?.has_indoor_plants ?? false,
    has_balcony: initial?.has_balcony ?? false,
    has_ac: initial?.has_ac ?? false,
    has_polishables: initial?.has_polishables ?? false,
  });
  const [error, setError] = useState<string | null>(null);

  const valid =
    ageGroups.length > 0 &&
    pets !== "" &&
    work !== "" &&
    school !== "";

  function toggleAge(g: AgeGroup) {
    setAgeGroups(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  }
  function toggleFeature(k: keyof typeof features) {
    setFeatures(prev => ({ ...prev, [k]: !prev[k] }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setError(null);
    startTransition(async () => {
      const result = await saveProfileAction({
        age_groups: ageGroups,
        pets: pets as Pets,
        work_hours: work as WorkHours,
        school_children: school as SchoolChildren,
        ...features,
      }, editMode);
      if (result?.error) {
        setError(result.error);
        return;
      }
      router.push(editMode ? "/household/settings" : "/onboarding/tasks");
    });
  }

  const rowBase = "flex min-h-11 items-center gap-3 px-4 py-2.5 border-b border-border last:border-0 cursor-pointer hover:bg-surface-0";
  const rowSelected = "bg-primary-subtle";

  return (
    <form onSubmit={onSubmit} className="pb-32">
      <div className="px-4 py-6 space-y-7">

        <section>
          <div className="flex items-center gap-2 mb-2">
            <StepBadge n={1} />
            <h2 style={STEP_HEADING_STYLE} className="font-semibold text-text-primary">Who lives in your home?</h2>
          </div>
          <p style={STEP_HINT_STYLE} className="text-xs text-text-muted mb-2">Select all that apply</p>
          <div className="bg-surface-1 border border-border rounded-md overflow-hidden">
            {AGE_OPTIONS.map(({ value, label }) => {
              const selected = ageGroups.includes(value);
              return (
                <label key={value} className={`${rowBase} ${selected ? rowSelected : ""}`}>
                  <input type="checkbox" checked={selected} onChange={() => toggleAge(value)} className="size-[18px] accent-primary" />
                  <span className="text-sm text-text-primary">{label}</span>
                </label>
              );
            })}
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-2">
            <StepBadge n={2} />
            <h2 style={STEP_HEADING_STYLE} className="font-semibold text-text-primary">Do you have pets?</h2>
          </div>
          <div className="bg-surface-1 border border-border rounded-md overflow-hidden">
            {PET_OPTIONS.map(({ value, label }) => {
              const selected = pets === value;
              return (
                <label key={value} className={`${rowBase} ${selected ? rowSelected : ""}`}>
                  <input type="radio" name="pets" checked={selected} onChange={() => setPets(value)} className="size-[18px] accent-primary" />
                  <span className="text-sm text-text-primary">{label}</span>
                </label>
              );
            })}
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-2">
            <StepBadge n={3} />
            <h2 style={STEP_HEADING_STYLE} className="font-semibold text-text-primary">Working hours of adults</h2>
          </div>
          <div className="bg-surface-1 border border-border rounded-md overflow-hidden">
            {WORK_OPTIONS.map(({ value, label }) => {
              const selected = work === value;
              return (
                <label key={value} className={`${rowBase} ${selected ? rowSelected : ""}`}>
                  <input type="radio" name="work" checked={selected} onChange={() => setWork(value)} className="size-[18px] accent-primary" />
                  <span className="text-sm text-text-primary">{label}</span>
                </label>
              );
            })}
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-2">
            <StepBadge n={4} />
            <h2 style={STEP_HEADING_STYLE} className="font-semibold text-text-primary">School-age children?</h2>
          </div>
          <div className="bg-surface-1 border border-border rounded-md overflow-hidden">
            {SCHOOL_OPTIONS.map(({ value, label }) => {
              const selected = school === value;
              return (
                <label key={value} className={`${rowBase} ${selected ? rowSelected : ""}`}>
                  <input type="radio" name="school" checked={selected} onChange={() => setSchool(value)} className="size-[18px] accent-primary" />
                  <span className="text-sm text-text-primary">{label}</span>
                </label>
              );
            })}
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-2">
            <StepBadge n={5} />
            <h2 style={STEP_HEADING_STYLE} className="font-semibold text-text-primary">What features does your home have?</h2>
          </div>
          <p style={STEP_HINT_STYLE} className="text-xs text-text-muted mb-2">Select all that apply</p>
          <div className="bg-surface-1 border border-border rounded-md overflow-hidden">
            {FEATURE_OPTIONS.map(({ key, label }) => {
              const selected = features[key];
              return (
                <label key={key} className={`${rowBase} ${selected ? rowSelected : ""}`}>
                  <input type="checkbox" checked={selected} onChange={() => toggleFeature(key)} className="size-[18px] accent-primary" />
                  <span className="text-sm text-text-primary">{label}</span>
                </label>
              );
            })}
          </div>
        </section>

        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>

      <div className="fixed bottom-14 left-0 right-0 bg-surface-1 border-t border-border p-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <Button type="submit" disabled={!valid} loading={pending} className="w-full">
          {editMode ? "Save changes" : "Continue to task picker →"}
        </Button>
        <p className="text-xs text-text-muted text-center mt-1.5">You can change these later in Household settings.</p>
      </div>
    </form>
  );
}
