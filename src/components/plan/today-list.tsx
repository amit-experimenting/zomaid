"use client";
import { SlotRow } from "./slot-row";
import { SlotActionSheet } from "./slot-action-sheet";
import type { Recipe } from "./recipe-picker";

type Slot = "breakfast" | "lunch" | "snacks" | "dinner";
const ORDER: Slot[] = ["breakfast", "lunch", "snacks", "dinner"];

export type TodayListProps = {
  planDate: string;
  rows: Record<Slot, { recipeId: string | null; recipeName: string | null; photoUrl: string | null; setBySystem: boolean }>;
  recipes: Recipe[];
  readOnly: boolean;
};

export function TodayList({ planDate, rows, recipes, readOnly }: TodayListProps) {
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
                onTap={() => {}}
                readOnly={readOnly}
              />
            }
          />
        );
      })}
    </div>
  );
}
