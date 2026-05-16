"use client";
import React, { useState, useTransition } from "react";
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const onPick = (recipeId: string) => {
    start(async () => {
      await setMealPlanSlot({ planDate: props.planDate, slot: props.slot, recipeId });
      setPickerOpen(false);
      setSheetOpen(false);
    });
  };
  const onRegenerate = () => {
    start(async () => {
      await regenerateMealPlanSlot({ planDate: props.planDate, slot: props.slot });
      setSheetOpen(false);
    });
  };
  const onClear = () => {
    start(async () => {
      await setMealPlanSlot({ planDate: props.planDate, slot: props.slot, recipeId: null });
      setSheetOpen(false);
    });
  };

  return (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetTrigger render={props.trigger as React.ReactElement} />
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>{props.currentRecipeName ?? "No recipe set"}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-2 py-4">
          {props.currentRecipeId && (
            <Button variant="secondary" nativeButton={false} render={<a href={`/recipes/${props.currentRecipeId}`} />}>
              View recipe
            </Button>
          )}
          {!props.readOnly && (
            <>
              <RecipePicker
                slot={props.slot}
                recipes={props.recipes}
                onPick={onPick}
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                pending={pending}
                trigger={<Button variant="secondary" disabled={pending}>Pick different</Button>}
              />
              <Button variant="secondary" loading={pending} onClick={onRegenerate}>Regenerate</Button>
              <Button variant="ghost" loading={pending} onClick={onClear}>Clear</Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
