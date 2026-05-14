"use client";
import { SlotRow } from "./slot-row";
import { SlotActionSheet } from "./slot-action-sheet";
import type { Recipe } from "./recipe-picker";
import type { Warning } from "./slot-warning-badge";

type Slot = "breakfast" | "lunch" | "snacks" | "dinner";
const ORDER: Slot[] = ["breakfast", "lunch", "snacks", "dinner"];

export type TodayListProps = {
  planDate: string;
  rows: Record<Slot, {
    recipeId: string | null;
    recipeName: string | null;
    photoUrl: string | null;
    setBySystem: boolean;
    rowExists: boolean;
    peopleEating: number | null;
    locked: boolean;
    deductionWarnings: Warning[];
  }>;
  recipes: Recipe[];
  readOnly: boolean;
  rosterSize: number;
};

export function TodayList({ planDate, rows, recipes, readOnly, rosterSize }: TodayListProps) {
  return (
    <div className="flex flex-col">
      {ORDER.map((s) => {
        const row = rows[s];
        return (
          <SlotActionSheet
            key={s}
            planDate={planDate}
            slot={s}
            currentRecipeId={row.recipeId}
            currentRecipeName={row.recipeName}
            recipes={recipes}
            readOnly={readOnly}
            trigger={
              <SlotRow
                slot={s}
                recipeId={row.recipeId}
                recipeName={row.recipeName}
                photoUrl={row.photoUrl}
                setBySystem={row.setBySystem}
                rowExists={row.rowExists}
                readOnly={readOnly}
                planDate={planDate}
                peopleEating={row.peopleEating}
                rosterSize={rosterSize}
                locked={row.locked}
                deductionWarnings={row.deductionWarnings}
              />
            }
          />
        );
      })}
    </div>
  );
}
