"use client";

import { useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { createInventoryItemsBulk } from "@/app/inventory/actions";
import { PendingButton } from "@/components/ui/pending-button";

const UNIT_OPTIONS = ["kg", "g", "l", "ml", "piece"] as const;
type Unit = (typeof UNIT_OPTIONS)[number];

type ScanRow = {
  id: number;
  name: string;
  quantity: string;
  unit: Unit;
};

type ScanResponse =
  | { items: { item_name: string; quantity: number | null; unit: Unit | null }[] }
  | { error: string };

type Phase = "idle" | "compressing" | "scanning";

export function ScanReceiptForm() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const nextIdRef = useRef(0);

  function nextId() {
    return nextIdRef.current++;
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setError(null);
    setPhase("compressing");
    try {
      const compressed = await imageCompression(picked, {
        maxSizeMB: 1.5,
        maxWidthOrHeight: 2400,
        useWebWorker: true,
      });
      setFile(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't compress that image.");
      setFile(null);
    } finally {
      setPhase("idle");
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
      const res = await fetch("/api/inventory/scan", { method: "POST", body: fd });
      const body = (await res.json()) as ScanResponse;
      if (!res.ok || "error" in body) {
        const msg = "error" in body ? body.error : "Scan failed. Try again.";
        setError(msg);
        return;
      }
      if (body.items.length === 0) {
        setError("Couldn't find any items on that receipt.");
        return;
      }
      setRows(
        body.items.map((it) => ({
          id: nextId(),
          name: it.item_name,
          quantity: it.quantity != null ? String(it.quantity) : "",
          unit: it.unit ?? "kg",
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed. Try again.");
    } finally {
      setPhase("idle");
    }
  }

  function updateRow(id: number, patch: Partial<ScanRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: number) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  function addBlankRow() {
    setRows((rs) => [...rs, { id: nextId(), name: "", quantity: "", unit: "kg" }]);
  }

  const busy = phase !== "idle";

  return (
    <form action={createInventoryItemsBulk} className="flex flex-col gap-3 px-4 py-2">
      <div className="flex flex-col gap-2 rounded border border-dashed p-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Receipt photo</span>
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
          Scan receipt
        </PendingButton>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">
          Review every row before saving. Skip junk lines, fix units, and add anything the
          scan missed.
        </p>
      </div>

      {rows.map((row, i) => (
        <div
          key={row.id}
          className="grid grid-cols-[1fr_80px_80px_24px] items-center gap-2"
        >
          <input
            name={`custom_name_${i}`}
            type="text"
            maxLength={120}
            value={row.name}
            onChange={(e) => updateRow(row.id, { name: e.target.value })}
            placeholder="item name"
            className="rounded border px-2 py-1 text-sm"
          />
          <input
            name={`custom_qty_${i}`}
            type="number"
            min="0"
            step="0.01"
            value={row.quantity}
            onChange={(e) => updateRow(row.id, { quantity: e.target.value })}
            placeholder="0"
            className="rounded border px-2 py-1 text-sm"
          />
          <select
            name={`custom_unit_${i}`}
            value={row.unit}
            onChange={(e) => updateRow(row.id, { unit: e.target.value as Unit })}
            className="rounded border px-2 py-1 text-sm"
          >
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
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

      {rows.length > 0 && (
        <button
          type="button"
          onClick={addBlankRow}
          className="self-start rounded border border-dashed px-3 py-1 text-sm text-muted-foreground hover:bg-muted"
        >
          + Add another item
        </button>
      )}

      <PendingButton type="submit" disabled={rows.length === 0} className="mt-3">
        Save inventory
      </PendingButton>
    </form>
  );
}
