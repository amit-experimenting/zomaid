"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ingestBillLineItem, skipBillLineItem, unskipBillLineItem } from "@/app/bills/actions";

export type LineRow = {
  id: string;
  item_name: string;
  quantity: number;
  unit: string | null;
  inventory_ingested_at: string | null;
  inventory_ingestion_skipped: boolean;
  matched_inventory_item_id: string | null;
};

export type ExistingInvOption = { id: string; item_name: string; quantity: number; unit: string };

export function InventoryReviewQueue({
  pending,
  skipped,
  existingByName,
  canWrite,
}: {
  pending: LineRow[];
  skipped: LineRow[];
  existingByName: Record<string, ExistingInvOption>;
  canWrite: boolean;
}) {
  return (
    <>
      <section className="px-4 py-3">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Pending inventory matches ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <div className="text-sm text-muted-foreground">All lines reviewed.</div>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((line) => (
              <PendingRow key={line.id} line={line} match={existingByName[line.item_name.toLowerCase()] ?? null} disabled={!canWrite} />
            ))}
          </ul>
        )}
      </section>

      <section className="px-4 py-3">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Not kitchen supplies ({skipped.length})
        </h2>
        {skipped.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nothing skipped.</div>
        ) : (
          <ul className="flex flex-col gap-2">
            {skipped.map((line) => (
              <SkippedRow key={line.id} line={line} disabled={!canWrite} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function PendingRow({ line, match, disabled }: { line: LineRow; match: ExistingInvOption | null; disabled: boolean }) {
  const [target, setTarget] = useState<"match" | "new">(match ? "match" : "new");
  const [pendingTx, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const confirm = () => {
    setErr(null);
    start(async () => {
      const res = await ingestBillLineItem({
        line_item_id: line.id,
        inventory_id: target === "match" ? match?.id ?? null : null,
        quantity: line.quantity,
        unit: line.unit ?? "",
        new_item_name: target === "new" ? line.item_name : undefined,
      });
      if (!res.ok) setErr(res.error.message);
    });
  };
  const skip = () => {
    setErr(null);
    start(async () => {
      const res = await skipBillLineItem({ line_item_id: line.id });
      if (!res.ok) setErr(res.error.message);
    });
  };

  return (
    <li className="rounded border p-3">
      <div className="font-medium">{line.item_name}</div>
      <div className="text-xs text-muted-foreground">{line.quantity} {line.unit}</div>
      <div className="mt-2 flex flex-col gap-1 text-sm">
        {match && (
          <label className="flex items-center gap-2">
            <input type="radio" checked={target === "match"} onChange={() => setTarget("match")} />
            Add to: <span className="font-medium">{match.item_name}</span> ({match.quantity} {match.unit})
          </label>
        )}
        <label className="flex items-center gap-2">
          <input type="radio" checked={target === "new"} onChange={() => setTarget("new")} />
          New inventory item
        </label>
      </div>
      <div className="mt-2 flex gap-2">
        <Button onClick={confirm} disabled={disabled || pendingTx}>Confirm</Button>
        <Button onClick={skip} variant="secondary" disabled={disabled || pendingTx}>Skip</Button>
      </div>
      {err && <div className="mt-1 text-xs text-red-600">{err}</div>}
    </li>
  );
}

function SkippedRow({ line, disabled }: { line: LineRow; disabled: boolean }) {
  const [pendingTx, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const undo = () => {
    setErr(null);
    start(async () => {
      const res = await unskipBillLineItem({ line_item_id: line.id });
      if (!res.ok) setErr(res.error.message);
    });
  };

  return (
    <li className="flex items-center justify-between rounded border p-2 text-sm">
      <span>{line.item_name} <span className="text-xs text-muted-foreground">({line.quantity} {line.unit})</span></span>
      <span>
        <Button onClick={undo} variant="ghost" size="sm" disabled={disabled || pendingTx}>Undo skip</Button>
        {err && <span className="ml-2 text-xs text-red-600">{err}</span>}
      </span>
    </li>
  );
}
