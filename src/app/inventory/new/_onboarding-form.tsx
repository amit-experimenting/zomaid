"use client";

import { useId, useRef, useState } from "react";
import { createInventoryItemsBulk, STARTER_ITEMS } from "@/app/inventory/actions";
import { Button } from "@/components/ui/button";

const UNIT_OPTIONS = ["kg", "g", "l", "ml", "piece"] as const;

type CustomRow = { id: number };

export function OnboardingInventoryForm() {
  const [customRows, setCustomRows] = useState<CustomRow[]>([]);
  const nextIdRef = useRef(0);

  function addRow() {
    setCustomRows((rows) => [...rows, { id: nextIdRef.current++ }]);
  }

  function removeRow(id: number) {
    setCustomRows((rows) => rows.filter((r) => r.id !== id));
  }

  return (
    <form action={createInventoryItemsBulk} className="flex flex-col gap-3 px-4 py-2">
      {STARTER_ITEMS.map((item) => (
        <div key={item.name} className="grid grid-cols-[1fr_80px_80px] items-center gap-2">
          <label htmlFor={`qty_${item.name}`} className="text-sm">
            {item.name}
          </label>
          <input
            id={`qty_${item.name}`}
            name={`qty_${item.name}`}
            type="number"
            min="0"
            step="0.01"
            className="rounded border px-2 py-1 text-sm"
            placeholder="0"
          />
          <select
            name={`unit_${item.name}`}
            className="rounded border px-2 py-1 text-sm"
            defaultValue={item.defaultUnit}
          >
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      ))}

      {customRows.map((row, i) => (
        <CustomRowFields key={row.id} index={i} onRemove={() => removeRow(row.id)} />
      ))}

      <button
        type="button"
        onClick={addRow}
        className="self-start rounded border border-dashed px-3 py-1 text-sm text-muted-foreground hover:bg-muted"
      >
        + Add another item
      </button>

      <Button type="submit" className="mt-3">
        Save inventory
      </Button>
    </form>
  );
}

function CustomRowFields({
  index,
  onRemove,
}: {
  index: number;
  onRemove: () => void;
}) {
  const nameId = useId();
  return (
    <div className="grid grid-cols-[1fr_80px_80px_24px] items-center gap-2">
      <input
        id={nameId}
        name={`custom_name_${index}`}
        type="text"
        maxLength={120}
        placeholder="item name"
        className="rounded border px-2 py-1 text-sm"
      />
      <input
        name={`custom_qty_${index}`}
        type="number"
        min="0"
        step="0.01"
        className="rounded border px-2 py-1 text-sm"
        placeholder="0"
      />
      <select
        name={`custom_unit_${index}`}
        className="rounded border px-2 py-1 text-sm"
        defaultValue="kg"
      >
        {UNIT_OPTIONS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onRemove}
        aria-label="remove row"
        className="text-muted-foreground hover:text-foreground"
      >
        ×
      </button>
    </div>
  );
}
