"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LineItemRow, type LineItem } from "./line-item-row";
import { LineItemEditor } from "./line-item-editor";
import { ManualEntryForm } from "./manual-entry-form";
import { retryBill } from "@/app/bills/actions";

type Props =
  | { billId: string; mode: "failed" }
  | { billId: string; mode: "processed"; items: LineItem[]; readOnly: boolean };

export function BillDetailActions(p: Props) {
  const [editTarget, setEditTarget] = useState<LineItem | null>(null);
  if (p.mode === "failed") {
    return (
      <section className="border-t border-border">
        <div className="px-4 py-3 flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => retryBill({ billId: p.billId })}
          >
            Retry OCR
          </Button>
        </div>
        <h2 className="px-4 py-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Or enter line items manually
        </h2>
        <ManualEntryForm billId={p.billId} />
      </section>
    );
  }
  return (
    <>
      <div>
        {p.items.map((it) => (
          <LineItemRow
            key={it.id}
            item={it}
            readOnly={p.readOnly}
            onEdit={() => setEditTarget(it)}
          />
        ))}
      </div>
      {editTarget && (
        <LineItemEditor
          lineItemId={editTarget.id}
          initial={{
            name: editTarget.item_name,
            quantity: editTarget.quantity,
            unit: editTarget.unit,
            unit_price: editTarget.unit_price,
            line_total: editTarget.line_total,
          }}
          open={editTarget !== null}
          onOpenChange={(open) => {
            if (!open) setEditTarget(null);
          }}
        />
      )}
    </>
  );
}
