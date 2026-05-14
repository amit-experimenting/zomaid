"use client";
import { useState } from "react";
import { ItemRow } from "./item-row";

export type BoughtItem = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  boughtAt: string;
};

export function BoughtHistory({ items, readOnly, onChanged }: { items: BoughtItem[]; readOnly: boolean; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <section className="mt-4 border-t border-dashed border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:bg-muted/30"
      >
        <span>Show bought (last 7d) · {items.length} item{items.length === 1 ? "" : "s"}</span>
        <span aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div>
          {items.map((it) => (
            <ItemRow
              key={it.id}
              itemId={it.id}
              name={it.name}
              quantity={it.quantity}
              unit={it.unit}
              notes={it.notes}
              bought
              boughtAt={it.boughtAt}
              readOnly={readOnly}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </section>
  );
}
