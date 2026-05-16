"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import imageCompression from "browser-image-compression";
import {
  uploadBillFromScan,
  type UploadBillFromScanInput,
} from "@/app/bills/actions";
import { PendingButton } from "@/components/ui/pending-button";

const UNIT_OPTIONS = ["kg", "g", "l", "ml", "piece"] as const;
type Unit = (typeof UNIT_OPTIONS)[number];

type ParsedItem = {
  item_name: string;
  quantity: number | null;
  unit: Unit | null;
  price: number | null;
};

type ParsedBill = {
  store_name: string | null;
  bill_date: string | null;
  currency: string | null;
  total_amount: number | null;
  items: ParsedItem[];
};

type ScanResponse =
  | { ok: true; data: ParsedBill }
  | { ok: false; error: { code: string; message: string } };

type Row = {
  id: number;
  name: string;
  quantity: string;
  // "" sentinel means "none" — the dropdown's first option, allowed at scan-time
  // but `uploadBillFromScan` will treat unit=null + quantity=null as a 0-piece
  // inventory row if addToInventory is checked. We preserve the user's intent.
  unit: Unit | "";
  price: string;
  addToInventory: boolean;
};

type Phase = "pick" | "compressing" | "scanning" | "confirm";

export function UploadBillForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Confirmation form state — populated after a successful scan.
  const [storeName, setStoreName] = useState("");
  const [billDate, setBillDate] = useState("");
  const [currency, setCurrency] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const nextIdRef = useRef(0);

  const [saving, startSave] = useTransition();

  function resetToPick() {
    setPhase("pick");
    setFile(null);
    setError(null);
    setStoreName("");
    setBillDate("");
    setCurrency("");
    setTotalAmount("");
    setRows([]);
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setError(null);
    setPhase("compressing");
    try {
      const compressed = await imageCompression(picked, {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
      });
      setFile(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't compress that image.");
      setFile(null);
    } finally {
      setPhase("pick");
    }
  }

  async function onScan() {
    if (!file) {
      setError("Pick a photo first.");
      return;
    }
    setError(null);
    setPhase("scanning");
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/bills/scan", { method: "POST", body: fd });
      const body = (await res.json()) as ScanResponse;
      if (!res.ok || body.ok === false) {
        const msg = body.ok === false ? body.error.message : "Scan failed. Try again.";
        setError(msg);
        setPhase("pick");
        return;
      }
      const d = body.data;
      setStoreName(d.store_name ?? "");
      setBillDate(d.bill_date ?? "");
      setCurrency(d.currency ?? "");
      setTotalAmount(d.total_amount != null ? String(d.total_amount) : "");
      setRows(
        d.items.map((it) => ({
          id: nextIdRef.current++,
          name: it.item_name,
          quantity: it.quantity != null ? String(it.quantity) : "",
          unit: it.unit ?? "",
          price: it.price != null ? String(it.price) : "",
          addToInventory: true,
        })),
      );
      setPhase("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed. Try again.");
      setPhase("pick");
    }
  }

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
    };
    // Surface NaN coercion failures before the server sees them.
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
      router.push(`/bills/${res.data.billId}`);
    });
  }

  if (phase !== "confirm") {
    const busy = phase === "compressing" || phase === "scanning";
    return (
      <div className="flex flex-col gap-3 px-4 py-2">
        <div className="flex flex-col gap-2 rounded border border-dashed p-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Bill photo</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={onFileChange}
              disabled={busy}
              className="text-sm"
            />
          </label>
          <PendingButton
            type="button"
            pending={busy}
            pendingLabel={phase === "compressing" ? "Compressing…" : "Scanning…"}
            onClick={onScan}
            disabled={!file || busy}
            className="self-start"
          >
            Scan bill
          </PendingButton>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <p className="text-xs text-muted-foreground">
            We read the bill, then show you the parsed result so you can edit
            before saving. The photo isn&apos;t stored — only the line items.
          </p>
        </div>
      </div>
    );
  }

  // phase === "confirm"
  return (
    <div className="flex flex-col gap-4 px-4 py-2">
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
          onClick={resetToPick}
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
