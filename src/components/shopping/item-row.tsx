"use client";
import { useTransition } from "react";
import { cn } from "@/lib/utils";
import { setShoppingItemChecked, clearShoppingItemChecked } from "@/app/shopping/actions";

export type ItemRowProps = {
  itemId: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  /** Checkbox is filled; row gets strikethrough. True for both "checked" and "bought". */
  checked: boolean;
  /** Set when the row has been committed to inventory (history). */
  boughtAt: string | null;
  readOnly: boolean;
  onEdit?: () => void;
  onChanged?: () => void;
};

function metaLine(quantity: number | null, unit: string | null, notes: string | null, boughtAt: string | null): string {
  const parts: string[] = [];
  if (quantity !== null && unit) parts.push(`${quantity} ${unit}`);
  else if (quantity !== null)    parts.push(String(quantity));
  else if (unit)                 parts.push(unit);
  if (notes) parts.push(notes);
  if (boughtAt) parts.push(`bought ${new Date(boughtAt).toLocaleString("en-SG", { dateStyle: "short", timeStyle: "short" })}`);
  return parts.join(" · ");
}

export function ItemRow(p: ItemRowProps) {
  const [pending, start] = useTransition();
  const onToggle = () => {
    if (p.readOnly) return;
    start(async () => {
      const res = p.checked
        ? await clearShoppingItemChecked({ itemId: p.itemId })
        : await setShoppingItemChecked({ itemId: p.itemId });
      if (res.ok) p.onChanged?.();
    });
  };
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3">
      <button
        type="button"
        aria-label={p.checked ? "Uncheck" : "Check"}
        disabled={p.readOnly || pending}
        onClick={onToggle}
        className={cn(
          "size-5 shrink-0 rounded border-2 transition",
          p.checked ? "border-primary bg-primary" : "border-border bg-transparent",
          p.readOnly && "opacity-50",
        )}
      >
        {p.checked && (
          <svg viewBox="0 0 16 16" className="size-full text-primary-foreground"><path d="M4 8l3 3 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        )}
      </button>
      <button
        type="button"
        disabled={p.readOnly}
        onClick={() => p.onEdit?.()}
        className={cn("min-w-0 flex-1 text-left", p.readOnly && "cursor-default")}
      >
        <div className={cn("truncate font-medium", p.checked && "line-through text-muted-foreground")}>{p.name}</div>
        {metaLine(p.quantity, p.unit, p.notes, p.boughtAt) && (
          <div className="text-xs text-muted-foreground">{metaLine(p.quantity, p.unit, p.notes, p.boughtAt)}</div>
        )}
      </button>
    </div>
  );
}
