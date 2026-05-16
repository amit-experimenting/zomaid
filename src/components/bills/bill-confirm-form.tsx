"use client";

// Shared bill-confirmation UI.
//
// Used by:
//   - /inventory/new "Upload bill" tab (sync scan → confirm → save)
//   - /scans/pending "Review & save" (queued scan succeeded → confirm → save)
//
// Pure controlled-input form: takes a ParsedBill snapshot + an optional
// attemptId (so the server action can stamp the bill_scan_attempts row
// as reviewed once a bill is created) and calls uploadBillFromScan on
// save. Caller decides the post-save navigation via onSaved.

import { useRef, useState, useTransition } from "react";
import {
  uploadBillFromScan,
  type UploadBillFromScanInput,
} from "@/app/bills/actions";
import { PendingButton } from "@/components/ui/pending-button";

const UNIT_OPTIONS = ["kg", "g", "l", "ml", "piece"] as const;
type Unit = (typeof UNIT_OPTIONS)[number];

export type ConfirmFormInitialItem = {
  item_name: string;
  quantity: number | null;
  unit: Unit | null;
  price: number | null;
};

export type ConfirmFormInitial = {
  store_name: string | null;
  bill_date: string | null;
  currency: string | null;
  total_amount: number | null;
  items: ConfirmFormInitialItem[];
  /** Storage path in bill-images bucket where the uploaded photo lives. */
  imageStoragePath?: string;
};

type Row = {
  id: number;
  name: string;
  quantity: string;
  unit: Unit | "";
  price: string;
  addToInventory: boolean;
};

export type BillConfirmFormProps = {
  initial: ConfirmFormInitial;
  /** When present, the server action stamps the matching bill_scan_attempts row. */
  attemptId?: string;
  /** Fired on successful save with the new bill ID. */
  onSaved: (billId: string) => void;
  /** Fired when the user discards. */
  onDiscard: () => void;
};

export function BillConfirmForm({
  initial,
  attemptId,
  onSaved,
  onDiscard,
}: BillConfirmFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [storeName, setStoreName] = useState(initial.store_name ?? "");
  const [billDate, setBillDate] = useState(initial.bill_date ?? "");
  const [currency, setCurrency] = useState(initial.currency ?? "");
  const [totalAmount, setTotalAmount] = useState(
    initial.total_amount != null ? String(initial.total_amount) : "",
  );
  // Stable IDs assigned at construction time — initial rows get 0..N-1,
  // anything added via "+ Add line item" gets nextIdRef.current++. The ref
  // is only read in event handlers, never during render.
  const nextIdRef = useRef(initial.items.length);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.items.map((it, i) => ({
      id: i,
      name: it.item_name,
      quantity: it.quantity != null ? String(it.quantity) : "",
      unit: it.unit ?? "",
      price: it.price != null ? String(it.price) : "",
      addToInventory: true,
    })),
  );
  const [saving, startSave] = useTransition();

  function updateRow(id: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function removeRow(id: number) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }
  function addBlankRow() {
    setRows((rs) => [
      ...rs,
      {
        id: nextIdRef.current++,
        name: "",
        quantity: "",
        unit: "",
        price: "",
        addToInventory: true,
      },
    ]);
  }

  function onSave() {
    setError(null);
    const trimmedStore = storeName.trim();
    if (trimmedStore.length === 0) {
      setError("Store name is required.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate)) {
      setError("Bill date is required (YYYY-MM-DD).");
      return;
    }
    const cur = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) {
      setError("Currency must be a 3-letter code (e.g. SGD, USD, INR).");
      return;
    }
    const cleanRows = rows.filter((r) => r.name.trim().length > 0);
    if (cleanRows.length === 0) {
      setError("Add at least one line item.");
      return;
    }
    const payload: UploadBillFromScanInput = {
      store_name: trimmedStore,
      bill_date: billDate,
      currency: cur,
      total_amount: totalAmount.trim() === "" ? null : Number(totalAmount),
      items: cleanRows.map((r) => ({
        item_name: r.name.trim(),
        quantity: r.quantity.trim() === "" ? null : Number(r.quantity),
        unit: r.unit === "" ? null : r.unit,
        price: r.price.trim() === "" ? null : Number(r.price),
        addToInventory: r.addToInventory,
      })),
      ...(attemptId ? { attemptId } : {}),
      ...(initial.imageStoragePath ? { imageStoragePath: initial.imageStoragePath } : {}),
    };
    if (payload.total_amount != null && !Number.isFinite(payload.total_amount)) {
      setError("Total amount must be a number.");
      return;
    }
    for (const it of payload.items) {
      if (it.quantity != null && (!Number.isFinite(it.quantity) || it.quantity <= 0)) {
        setError(`Quantity for "${it.item_name}" must be a positive number.`);
        return;
      }
      if (it.price != null && (!Number.isFinite(it.price) || it.price < 0)) {
        setError(`Price for "${it.item_name}" must be zero or more.`);
        return;
      }
    }

    startSave(async () => {
      const res = await uploadBillFromScan(payload);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      onSaved(res.data.billId);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded border border-destructive bg-destructive/10 px-2 py-1 text-sm text-destructive">
          {error}
        </p>
      )}

      <fieldset className="flex flex-col gap-2 rounded border p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Bill header
        </legend>
        <label className="flex flex-col gap-1">
          <span className="text-sm">Store name</span>
          <input
            type="text"
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            maxLength={200}
            className="rounded border px-2 py-1 text-sm"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm">Bill date</span>
            <input
              type="date"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
              className="rounded border px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm">Currency</span>
            <input
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              placeholder="SGD"
              className="rounded border px-2 py-1 text-sm uppercase"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-sm">Total amount</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={totalAmount}
            onChange={(e) => setTotalAmount(e.target.value)}
            placeholder="0.00"
            className="rounded border px-2 py-1 text-sm"
          />
        </label>
      </fieldset>

      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Line items
        </h2>
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No line items detected. Add at least one to save.
          </p>
        )}
        {rows.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[1fr_60px_60px_70px_24px_24px] items-center gap-1"
          >
            <input
              type="text"
              value={row.name}
              onChange={(e) => updateRow(row.id, { name: e.target.value })}
              placeholder="item name"
              maxLength={120}
              className="rounded border px-2 py-1 text-sm"
            />
            <input
              type="number"
              min="0"
              step="0.01"
              value={row.quantity}
              onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
              placeholder="qty"
              className="rounded border px-1 py-1 text-sm"
            />
            <select
              value={row.unit}
              onChange={(e) => updateRow(row.id, { unit: e.target.value as Unit | "" })}
              className="rounded border px-1 py-1 text-sm"
            >
              <option value="">—</option>
              {UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              value={row.price}
              onChange={(e) => updateRow(row.id, { price: e.target.value })}
              placeholder="price"
              className="rounded border px-1 py-1 text-sm"
            />
            <input
              type="checkbox"
              checked={row.addToInventory}
              onChange={(e) => updateRow(row.id, { addToInventory: e.target.checked })}
              aria-label="add to inventory"
              title="Add to inventory"
            />
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              aria-label="remove row"
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addBlankRow}
          className="self-start rounded border border-dashed px-3 py-1 text-sm text-muted-foreground hover:bg-muted"
        >
          + Add line item
        </button>
        <p className="text-xs text-muted-foreground">
          Check the box to add the item to your inventory at save time.
          Unchecked lines are still kept on the bill record.
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onDiscard}
          disabled={saving}
          className="rounded border px-3 py-1 text-sm text-muted-foreground hover:bg-muted"
        >
          Discard
        </button>
        <PendingButton
          type="button"
          pending={saving}
          pendingLabel="Saving…"
          onClick={onSave}
          disabled={saving || rows.length === 0}
        >
          Save bill
        </PendingButton>
      </div>
    </div>
  );
}
