"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import { PeoplePill } from "@/components/plan/people-pill";
import { SlotWarningBadge, type Warning } from "@/components/plan/slot-warning-badge";
import { RecipePhoto } from "@/components/recipes/recipe-photo";

export type SlotRowOwnProps = {
  slot: "breakfast" | "lunch" | "snacks" | "dinner";
  recipeId: string | null;
  recipeName: string | null;
  /** Per-serving calories for the assigned recipe. null hides the suffix. */
  kcalPerServing?: number | null;
  photoUrl: string | null;
  setBySystem: boolean;          // true if set_by_profile_id was NULL
  rowExists: boolean;            // false → no meal_plans row yet (vs explicit clear)
  readOnly: boolean;
  peopleEating: number | null;
  rosterSize: number;
  locked: boolean;
  deductionWarnings: Warning[];
  planDate: string;
};

export type SlotRowProps = SlotRowOwnProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof SlotRowOwnProps>;

const SLOT_LABEL: Record<SlotRowOwnProps["slot"], string> = {
  breakfast: "Breakfast", lunch: "Lunch", snacks: "Snacks", dinner: "Dinner",
};

function emptyCopy(rowExists: boolean, setBySystem: boolean): string {
  if (!rowExists) return "Not planned";
  if (setBySystem) return "No suggestion (library empty)";
  return "Cleared";
}

// Forward ref + spread `rest` so base-ui's <SheetTrigger render={<SlotRow…/>}>
// can attach its click handler, aria-*, and ref onto the underlying <button>.
export const SlotRow = React.forwardRef<HTMLButtonElement, SlotRowProps>(function SlotRow(
  { slot, recipeId, recipeName, kcalPerServing, photoUrl, setBySystem, rowExists, readOnly, peopleEating, rosterSize, locked, deductionWarnings, planDate, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cn(
        "flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left",
        "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        readOnly && "cursor-default hover:bg-transparent",
        className,
      )}
    >
      <div className="size-12 shrink-0 overflow-hidden rounded-md bg-muted">
        {recipeId !== null ? (
          <RecipePhoto
            src={photoUrl}
            alt={recipeName ?? ""}
            width={48}
            height={48}
            className="size-12 object-cover"
          />
        ) : (
          <div className="flex size-12 items-center justify-center text-xs text-muted-foreground">—</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {SLOT_LABEL[slot]}
          {locked && <span className="ml-1 text-[10px] text-muted-foreground">(locked)</span>}
          {recipeId !== null && kcalPerServing != null && (() => {
            // Per-serving values are stored on the recipe; scale by how
            // many people are eating this slot (defaults to household
            // roster size when peopleEating is null — matches PeoplePill).
            const eaters = peopleEating ?? rosterSize;
            const total = Math.round(kcalPerServing * eaters);
            return (
              <span className="ml-1.5 normal-case tracking-normal text-[10px] tabular-nums">
                · {total} kcal{eaters > 1 ? ` (×${eaters})` : ""}
              </span>
            );
          })()}
        </div>
        {recipeId === null ? (
          <div className="italic text-muted-foreground">{emptyCopy(rowExists, setBySystem)}</div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-medium">{recipeName}</span>
            <SlotWarningBadge warnings={deductionWarnings} />
          </div>
        )}
        {recipeId !== null && (
          <div className="mt-1" onClick={(e) => e.stopPropagation()}>
            <PeoplePill
              planDate={planDate}
              slot={slot}
              initialPeople={peopleEating}
              rosterSize={rosterSize}
              locked={locked}
              canEdit={!readOnly}
            />
          </div>
        )}
      </div>
    </button>
  );
});
