"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { markBillManuallyProcessed } from "@/app/bills/actions";

export type ManualEntryFormProps = { billId: string };

type LineDraft = { item_name: string; quantity: number | null; unit: string | null; unit_price: number | null; line_total: number | null };

export function ManualEntryForm({ billId }: ManualEntryFormProps) {
  const router = useRouter();
  const [storeName, setStoreName] = useState("");
  const [billDate, setBillDate] = useState("");
  const [total, setTotal] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([
    { item_name: "", quantity: null, unit: null, unit_price: null, line_total: null },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const filtered = lines.filter((l) => l.item_name.trim().length > 0);
    if (filtered.length === 0) { setError("Add at least one line item."); return; }
    setError(null);
    start(async () => {
      const res = await markBillManuallyProcessed({
        billId,
        storeName: storeName.trim() || null,
        billDate: billDate || null,
        totalAmount: total ? Number(total) : null,
        lineItems: filtered.map((l) => ({
          item_name: l.item_name.trim(),
          quantity: l.quantity,
          unit: l.unit,
          unit_price: l.unit_price,
          line_total: l.line_total,
        })),
      });
      if (!res.ok) { setError(res.error.message); return; }
      router.refresh();
    });
  }

  return (
    <form className="space-y-4 px-4 py-4" onSubmit={submit}>
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <div>
          <Label htmlFor="me-store">Store</Label>
          <Input id="me-store" value={storeName} onChange={(e) => setStoreName(e.target.value)} maxLength={200} />
        </div>
        <div>
          <Label htmlFor="me-date">Date</Label>
          <Input id="me-date" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor="me-total">Total (SGD)</Label>
        <Input id="me-total" type="number" min="0" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Line items</legend>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_5rem_5rem_6rem_2rem] gap-2">
            <Input placeholder="Item" value={l.item_name} onChange={(e) => setLines(lines.map((x, idx) => idx === i ? { ...x, item_name: e.target.value } : x))} />
            <Input placeholder="Qty" type="number" value={l.quantity ?? ""} onChange={(e) => setLines(lines.map((x, idx) => idx === i ? { ...x, quantity: e.target.value ? Number(e.target.value) : null } : x))} />
            <Input placeholder="Unit" value={l.unit ?? ""} onChange={(e) => setLines(lines.map((x, idx) => idx === i ? { ...x, unit: e.target.value || null } : x))} />
            <Input placeholder="Line total" type="number" step="0.01" value={l.line_total ?? ""} onChange={(e) => setLines(lines.map((x, idx) => idx === i ? { ...x, line_total: e.target.value ? Number(e.target.value) : null } : x))} />
            <Button type="button" variant="ghost" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>×</Button>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => setLines([...lines, { item_name: "", quantity: null, unit: null, unit_price: null, line_total: null }])}>+ Add line</Button>
      </fieldset>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>Mark processed</Button>
    </form>
  );
}
