"use client";
import React, { useTransition } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { RecipePicker, type Recipe } from "./recipe-picker";
import { setMealPlanSlot, regenerateMealPlanSlot } from "@/app/plan/actions";

export type SlotActionSheetProps = {
  planDate: string;
  slot: "breakfast" | "lunch" | "snacks" | "dinner";
  currentRecipeId: string | null;
  currentRecipeName: string | null;
  recipes: Recipe[];
  readOnly: boolean;
  trigger: React.ReactNode;
};

export function SlotActionSheet(props: SlotActionSheetProps) {
  const [pending, start] = useTransition();
  const onPick = (recipeId: string) => {
    start(async () => { await setMealPlanSlot({ planDate: props.planDate, slot: props.slot, recipeId }); });
  };
  const onRegenerate = () => {
    start(async () => { await regenerateMealPlanSlot({ planDate: props.planDate, slot: props.slot }); });
  };
  const onClear = () => {
    start(async () => { await setMealPlanSlot({ planDate: props.planDate, slot: props.slot, recipeId: null }); });
  };

  return (
    <Sheet>
      <SheetTrigger render={props.trigger as React.ReactElement} />
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>{props.currentRecipeName ?? "No recipe set"}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-2 py-4">
          {props.currentRecipeId && (
            <Button variant="outline" render={<a href={`/recipes/${props.currentRecipeId}`} />}>
              View recipe
            </Button>
          )}
          {!props.readOnly && (
            <>
              <RecipePicker
                slot={props.slot}
                recipes={props.recipes}
                onPick={onPick}
                trigger={<Button variant="outline" disabled={pending}>Pick different</Button>}
              />
              <Button variant="outline" disabled={pending} onClick={onRegenerate}>Regenerate</Button>
              <Button variant="ghost" disabled={pending} onClick={onClear}>Clear</Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
