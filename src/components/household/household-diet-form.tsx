"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import type { Diet } from "@/lib/db/types";

type MemberSummary = { displayName: string; dietPreference: Diet | null };

type Props = {
  currentValue: Diet | null;
  members: MemberSummary[]; // active non-maid members only
  action: (formData: FormData) => Promise<void>;
};

// Strictness ranking — mirrors the SQL helper.
const RANK: Record<Diet, number> = {
  vegan: 3,
  vegetarian: 2,
  eggitarian: 1,
  non_vegetarian: 0,
};

// "What would the helper return if the household column were null?"
function memberImpliedDiet(members: MemberSummary[]): Diet {
  let pick: Diet = "non_vegetarian";
  let rank = -1;
  for (const m of members) {
    if (!m.dietPreference) continue;
    const r = RANK[m.dietPreference];
    if (r > rank) { rank = r; pick = m.dietPreference; }
  }
  return pick;
}

const LABEL: Record<Diet, string> = {
  vegan: "Vegan",
  vegetarian: "Vegetarian",
  eggitarian: "Eggitarian",
  non_vegetarian: "Non-vegetarian",
};

export function HouseholdDietForm({ currentValue, members, action }: Props) {
  const initial: string = currentValue ?? "";
  const [chosen, setChosen] = useState<string>(initial);
  const isUnchanged = chosen === initial;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (chosen === "" || chosen === currentValue) return; // submit normally (or short-circuit upstream)
    const chosenDiet = chosen as Diet;
    const implied = memberImpliedDiet(members);
    if (RANK[chosenDiet] <= RANK[implied]) return; // less strict — no prompt

    // Members whose own pref is less strict than the chosen value would lose
    // visibility under the new household pref.
    const affected = members.filter((m) => {
      const r = RANK[m.dietPreference ?? "non_vegetarian"];
      return r < RANK[chosenDiet];
    });
    if (affected.length === 0) return; // nobody to warn about — submit normally

    const names = affected.slice(0, 3).map((m) => {
      const label = m.dietPreference ? LABEL[m.dietPreference].toLowerCase() : "no preference";
      return `${m.displayName} (${label})`;
    });
    const tail = affected.length > 3 ? `, and ${affected.length - 3} more` : "";
    const msg =
      `Setting household preference to ${LABEL[chosenDiet]} will hide recipes ` +
      `that ${names.join(", ")}${tail} currently see. Continue?`;
    if (!window.confirm(msg)) {
      e.preventDefault();
    }
  }

  return (
    <form action={action} onSubmit={handleSubmit} className="flex items-center gap-2">
      <select
        name="diet"
        value={chosen}
        onChange={(e) => setChosen(e.target.value)}
        className="rounded-md border bg-background px-2 py-1 text-sm"
        aria-label="Household meal preference"
      >
        <option value="">No household preference</option>
        <option value="vegan">Vegan</option>
        <option value="vegetarian">Vegetarian</option>
        <option value="eggitarian">Eggitarian</option>
        <option value="non_vegetarian">Non-vegetarian</option>
      </select>
      <SubmitButton size="sm" variant="secondary" disabled={isUnchanged}>
        Save
      </SubmitButton>
    </form>
  );
}
