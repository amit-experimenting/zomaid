"use client";
import { useState } from "react";

export type Warning = { item_name: string; requested_qty: number; deducted_qty: number; unit: string; reason: string };

export function SlotWarningBadge({ warnings }: { warnings: Warning[] }) {
  const [open, setOpen] = useState(false);
  if (!warnings || warnings.length === 0) return null;
  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className="rounded bg-yellow-100 px-1.5 py-0.5 uppercase text-yellow-800"
        style={{ fontSize: 10 }}
      >
        ⚠️ {warnings.length}
      </button>
      {open && (
        <span
          className="absolute z-10 mt-1 w-64 rounded border bg-popover p-2 shadow"
          style={{ fontSize: 11 }}
        >
          {warnings.map((w, i) => (
            <span key={i} className="block">
              {w.item_name}: needed {w.requested_qty}{w.unit}, deducted {w.deducted_qty}{w.unit} ({w.reason})
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
