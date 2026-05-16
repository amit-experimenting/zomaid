"use client";
import { useState, useTransition } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { deleteShoppingItem, updateShoppingItem } from "@/app/shopping/actions";

export type EditItemSheetProps = {
  itemId: string;
  initial: { name: string; quantity: number | null; unit: string | null; notes: string | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function EditItemSheet(p: EditItemSheetProps) {
  const [name, setName] = useState(p.initial.name);
  const [quantity, setQuantity] = useState<string>(p.initial.quantity?.toString() ?? "");
  const [unit, setUnit] = useState(p.initial.unit ?? "");
  const [notes, setNotes] = useState(p.initial.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => {
    setError(null);
    start(async () => {
      const res = await updateShoppingItem({
        itemId: p.itemId,
        name: name.trim() || undefined,
        quantity: quantity ? Number(quantity) : null,
        unit: unit.trim() || null,
        notes: notes.trim() || null,
      });
      if (!res.ok) { setError(res.error.message); return; }
      p.onOpenChange(false);
    });
  };
  const remove = () => {
    setError(null);
    start(async () => {
      const res = await deleteShoppingItem({ itemId: p.itemId });
      if (!res.ok) { setError(res.error.message); return; }
      p.onOpenChange(false);
    });
  };

  return (
    <Sheet open={p.open} onOpenChange={p.onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader><SheetTitle>Edit item</SheetTitle></SheetHeader>
        <div className="flex flex-col gap-3 py-4">
          <div>
            <Label htmlFor="sli-name">Name</Label>
            <Input id="sli-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <div>
              <Label htmlFor="sli-qty">Quantity</Label>
              <Input id="sli-qty" type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sli-unit">Unit</Label>
              <Input id="sli-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={24} />
            </div>
          </div>
          <div>
            <Label htmlFor="sli-notes">Notes</Label>
            <Textarea id="sli-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button type="button" onClick={save} disabled={pending || !name.trim()} className="flex-1">Save</Button>
            <Button type="button" variant="destructive" onClick={remove} disabled={pending}>Remove</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
