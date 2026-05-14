export type TransactionEntry = {
  id: string;
  delta: number;
  unit: string;
  reason: "onboarding" | "manual_adjust" | "cook_deduct" | "bill_ingest" | "undo";
  notes: string | null;
  created_at: string;
};

const REASON: Record<TransactionEntry["reason"], string> = {
  onboarding: "Onboarding",
  manual_adjust: "Manual",
  cook_deduct: "Cooked",
  bill_ingest: "Bill",
  undo: "Undo",
};

export function InventoryTransactionLog({ entries }: { entries: TransactionEntry[] }) {
  if (entries.length === 0) {
    return <div className="text-sm text-muted-foreground">No transactions yet.</div>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {entries.map((e) => (
        <li key={e.id} className="flex items-center justify-between border-b py-1 text-xs">
          <span className="flex items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5">{REASON[e.reason]}</span>
            {e.notes && <span className="text-muted-foreground">{e.notes}</span>}
          </span>
          <span className={e.delta >= 0 ? "text-emerald-600" : "text-red-600"}>
            {e.delta >= 0 ? "+" : ""}{e.delta} {e.unit}
          </span>
        </li>
      ))}
    </ul>
  );
}
