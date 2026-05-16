"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export type LineItem = {
  id: string;
  position: number;
  item_name: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  line_total: number | null;
  matchedShoppingItemName: string | null;
};

export type LineItemRowProps = {
  item: LineItem;
  readOnly: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
};

export function LineItemRow({ item, readOnly, onEdit, onDelete }: LineItemRowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const meta: string[] = [];
  if (item.quantity !== null && item.unit) meta.push(`${item.quantity} ${item.unit}`);
  else if (item.quantity !== null) meta.push(String(item.quantity));
  else if (item.unit) meta.push(item.unit);
  if (item.line_total !== null) meta.push(`SGD ${item.line_total.toFixed(2)}`);

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{item.item_name}</div>
        <div className="text-xs text-muted-foreground">{meta.join(" · ") || " "}</div>
        {item.matchedShoppingItemName && (
          <div
            className="mt-1 inline-block rounded-sm bg-secondary px-1.5 py-0.5 uppercase"
            style={{ fontSize: 10 }}
          >
            marked &quot;{item.matchedShoppingItemName}&quot; bought
          </div>
        )}
      </div>
      {!readOnly && (
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="outline" type="button" onClick={onEdit}>Edit</Button>
          {confirmDelete ? (
            <>
              <Button size="sm" variant="ghost" type="button" onClick={() => setConfirmDelete(false)}>No</Button>
              <Button size="sm" variant="destructive" type="button" onClick={() => { setConfirmDelete(false); onDelete?.(); }}>Yes</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" type="button" onClick={() => setConfirmDelete(true)}>×</Button>
          )}
        </div>
      )}
    </div>
  );
}
