"use client";
import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

export type SlotRowOwnProps = {
  slot: "breakfast" | "lunch" | "snacks" | "dinner";
  recipeId: string | null;
  recipeName: string | null;
  photoUrl: string | null;
  setBySystem: boolean;          // true if set_by_profile_id was NULL
  rowExists: boolean;            // false → no meal_plans row yet (vs explicit clear)
  readOnly: boolean;
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
  { slot, recipeId, recipeName, photoUrl, setBySystem, rowExists, readOnly, className, ...rest },
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
        {photoUrl ? (
          <Image src={photoUrl} alt={recipeName ?? ""} width={48} height={48} className="size-12 object-cover" />
        ) : (
          <div className="flex size-12 items-center justify-center text-xs text-muted-foreground">no photo</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{SLOT_LABEL[slot]}</div>
        {recipeId === null ? (
          <div className="italic text-muted-foreground">{emptyCopy(rowExists, setBySystem)}</div>
        ) : (
          <div className="truncate font-medium">{recipeName}</div>
        )}
      </div>
    </button>
  );
});
