"use client";
import { useState, useTransition } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateBillLineItem } from "@/app/bills/actions";

export type LineItemEditorProps = {
  lineItemId: string;
  initial: { name: string; quantity: number | null; unit: string | null; unit_price: number | null; line_total: number | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function LineItemEditor(p: LineItemEditorProps) {
  const [name, setName] = useState(p.initial.name);
  const [quantity, setQuantity] = useState(p.initial.quantity?.toString() ?? "");
  const [unit, setUnit] = useState(p.initial.unit ?? "");
  const [unitPrice, setUnitPrice] = useState(p.initial.unit_price?.toString() ?? "");
  const [lineTotal, setLineTotal] = useState(p.initial.line_total?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => {
    setError(null);
    start(async () => {
      const res = await updateBillLineItem({
        lineItemId: p.lineItemId,
        name: name.trim() || undefined,
        quantity: quantity ? Number(quantity) : null,
        unit: unit.trim() || null,
        unitPrice: unitPrice ? Number(unitPrice) : null,
        lineTotal: lineTotal ? Number(lineTotal) : null,
      });
      if (!res.ok) { setError(res.error.message); return; }
      p.onOpenChange(false);
    });
  };

  return (
    <Sheet open={p.open} onOpenChange={p.onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader><SheetTitle>Edit line item</SheetTitle></SheetHeader>
        <div className="flex flex-col gap-3 py-4">
          <div>
            <Label htmlFor="li-name">Name</Label>
            <Input id="li-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <div>
              <Label htmlFor="li-qty">Quantity</Label>
              <Input id="li-qty" type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="li-unit">Unit</Label>
              <Input id="li-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={24} />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <div>
              <Label htmlFor="li-unit-price">Unit price</Label>
              <Input id="li-unit-price" type="number" min="0" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="li-line-total">Line total</Label>
              <Input id="li-line-total" type="number" min="0" step="0.01" value={lineTotal} onChange={(e) => setLineTotal(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" onClick={save} disabled={pending || !name.trim()}>Save</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
