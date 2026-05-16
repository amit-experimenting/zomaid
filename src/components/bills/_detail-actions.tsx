"use client";
import { useState } from "react";
import { LineItemRow, type LineItem } from "./line-item-row";
import { LineItemEditor } from "./line-item-editor";

type Props = { billId: string; mode: "processed"; items: LineItem[]; readOnly: boolean };

export function BillDetailActions(p: Props) {
  const [editTarget, setEditTarget] = useState<LineItem | null>(null);
  // Legacy `mode: "failed"` branch (Retry-OCR + manual-entry fallback) was
  // removed when the GitHub-Issues OCR pipeline was retired in favor of the
  // /inventory/new "Upload bill" tab. Failed bills now just show their status
  // badge and reason on the detail header; recovery means re-uploading from
  // /inventory/new.
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
