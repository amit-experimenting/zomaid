"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PendingButton } from "@/components/ui/pending-button";
import { addRecipeToTodayPlan } from "@/app/recipes/actions";

/**
 * Sets today's meal-plan slot to this recipe and navigates the user to
 * /plan/<today> so they can see the result. Slot is implied by the recipe.
 * Permission-gated server-side (owner | maid | family-with-meal_modify).
 */
export function AddToTodayButton({ recipeId, slotLabel }: { recipeId: string; slotLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    start(async () => {
      const res = await addRecipeToTodayPlan({ recipeId });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      router.push(`/plan/${res.data.planDate}`);
    });
  };

  return (
    <>
      <PendingButton
        type="button"
        size="sm"
        variant="outline"
        pending={pending}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }}
      >
        + Today&apos;s {slotLabel}
      </PendingButton>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </>
  );
}
