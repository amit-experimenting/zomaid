"use client";
import { useState, useTransition } from "react";
import { PendingButton } from "@/components/ui/pending-button";
import { adjustInventoryItem } from "@/app/inventory/actions";

export function InventoryAdjustForm({ itemId }: { itemId: string }) {
  const [delta, setDelta] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const submit = (sign: 1 | -1) => () => {
    const num = Number(delta);
    if (!Number.isFinite(num) || num <= 0) return;
    setErr(null);
    start(async () => {
      const res = await adjustInventoryItem({ id: itemId, delta: sign * num, notes });
      if (!res.ok) setErr(res.error.message);
      else { setDelta(""); setNotes(""); }
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded border p-3">
      <div className="text-sm font-medium">Adjust stock</div>
      <input
        value={delta}
        onChange={(e) => setDelta(e.target.value)}
        type="number"
        min="0"
        step="0.01"
        placeholder="Amount"
        className="rounded border px-2 py-1 text-sm"
      />
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Note (optional)"
        maxLength={500}
        className="rounded border px-2 py-1 text-sm"
      />
      <div className="flex gap-2">
        <PendingButton onClick={submit(1)} pending={pending} variant="secondary">Add</PendingButton>
        <PendingButton onClick={submit(-1)} pending={pending} variant="secondary">Subtract</PendingButton>
      </div>
      {err && <div className="text-xs text-red-600">{err}</div>}
    </div>
  );
}
