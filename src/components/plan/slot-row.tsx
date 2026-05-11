"use client";
import Image from "next/image";
import { cn } from "@/lib/utils";

export type SlotRowProps = {
  slot: "breakfast" | "lunch" | "snacks" | "dinner";
  recipeId: string | null;
  recipeName: string | null;
  photoUrl: string | null;
  setBySystem: boolean;          // true if set_by_profile_id was NULL
  onTap: () => void;
  readOnly: boolean;
};

const SLOT_LABEL: Record<SlotRowProps["slot"], string> = {
  breakfast: "Breakfast", lunch: "Lunch", snacks: "Snacks", dinner: "Dinner",
};

export function SlotRow({ slot, recipeId, recipeName, photoUrl, setBySystem, onTap, readOnly }: SlotRowProps) {
  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(
        "flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left",
        "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        readOnly && "cursor-default hover:bg-transparent",
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
          <div className="italic text-muted-foreground">
            {setBySystem ? "No suggestion (library empty)" : "Cleared"}
          </div>
        ) : (
          <div className="truncate font-medium">{recipeName}</div>
        )}
      </div>
    </button>
  );
}
